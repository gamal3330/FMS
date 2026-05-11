from datetime import datetime, timedelta, timezone
from ipaddress import ip_address
import re

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.enums import ApprovalAction, RequestStatus, RequestType, UserRole
from app.models.request import ApprovalStep, RequestApprovalStep, ServiceRequest
from app.models.settings import PortalSetting, RequestTypeField, RequestTypeSetting, RequestTypeVersion, SettingsGeneral, SpecializedSection, WorkflowTemplate, WorkflowTemplateStep
from app.models.user import Department, Role, ScreenPermission, User
from app.schemas.request_type_management import (
    ReorderPayload,
    RequestSubmitPayload,
    RequestTypeFieldPayload,
    RequestTypeFieldRead,
    RequestTypePayload,
    RequestTypeRead,
    WorkflowRead,
    WorkflowStepPayload,
    WorkflowStepRead,
)
from app.services.audit import write_audit
from app.services.messaging_settings_service import should_send_request_created_notification
from app.services.request_notifications import create_request_created_message
from app.services.workflow import next_request_number

router = APIRouter(prefix="/request-types", tags=["Request Type Management"])
version_router = APIRouter(prefix="/request-type-versions", tags=["Request Type Versions"])
request_management_router = APIRouter(prefix="/settings/request-management", tags=["Request Management"])

SCREEN_PERMISSION_ORDER = {
    "no_access": 0,
    "view": 1,
    "create": 2,
    "edit": 3,
    "delete": 4,
    "export": 5,
    "manage": 6,
}


def request_types_screen_level(db: Session, user: User) -> str:
    if user.role in {UserRole.SUPER_ADMIN, UserRole.DEPARTMENT_MANAGER}:
        return "manage"

    user_permission = db.scalar(
        select(ScreenPermission).where(
            ScreenPermission.user_id == user.id,
            ScreenPermission.role_id.is_(None),
            ScreenPermission.screen_code == "request_types",
        )
    )
    if user_permission:
        return user_permission.permission_level or "no_access"

    role = db.get(Role, user.role_id) if user.role_id else None
    if not role:
        role = db.scalar(select(Role).where(or_(Role.code == str(user.role), Role.name == str(user.role))))
    if role:
        role_permission = db.scalar(
            select(ScreenPermission).where(
                ScreenPermission.role_id == role.id,
                ScreenPermission.user_id.is_(None),
                ScreenPermission.screen_code == "request_types",
            )
        )
        if role_permission:
            return role_permission.permission_level or "no_access"

    setting = db.scalar(select(PortalSetting).where(PortalSetting.category == "screen_permissions", PortalSetting.setting_key == str(user.id)))
    if setting and isinstance(setting.setting_value, dict) and "request_types" in setting.setting_value.get("screens", []):
        return "view"
    return "no_access"


def require_request_types_view(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> User:
    if SCREEN_PERMISSION_ORDER.get(request_types_screen_level(db, current_user), 0) < SCREEN_PERMISSION_ORDER["view"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="لا تملك صلاحية عرض إدارة أنواع الطلبات")
    return current_user


def require_request_types_manage(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> User:
    if SCREEN_PERMISSION_ORDER.get(request_types_screen_level(db, current_user), 0) < SCREEN_PERMISSION_ORDER["manage"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="لا تملك صلاحية إدارة أنواع الطلبات")
    return current_user


view_actor = Depends(require_request_types_view)
manage_actor = Depends(require_request_types_manage)

WORKFLOW_STEP_LABELS = {
    "direct_manager": "المدير المباشر",
    "department_manager": "مدير الإدارة المختصة",
    "department_specialist": "مختص الإدارة المختصة",
    "specific_department_manager": "مدير إدارة محددة",
    "information_security": "أمن المعلومات (مرحلة قديمة)",
    "administration_manager": "مدير إدارة",
    "it_staff": "مختص تنفيذ",
    "executive_management": "الإدارة التنفيذية",
    "implementation_engineer": "مختص تنفيذ",
    "implementation": "مختص تنفيذ",
    "execution": "مختص تنفيذ",
    "specific_role": "دور محدد",
    "specific_user": "مستخدم محدد",
    "close_request": "إغلاق الطلب",
}


def workflow_step_display(step_type: str | None, step_name_ar: str | None = None, step_name_en: str | None = None) -> str:
    return WORKFLOW_STEP_LABELS.get(step_type or "", step_name_ar or step_name_en or step_type or "")


def is_hidden_workflow_role(role: Role | None) -> bool:
    if not role:
        return False
    code = str(role.code or role.name or "")
    return code == "information_security" or code.startswith("information_security_copy")


def require_department_manager(db: Session, department_id: int | None, step_label: str = "مرحلة الموافقة") -> int:
    if not department_id:
        raise HTTPException(status_code=422, detail=f"يجب تحديد الإدارة في {step_label}")
    department = db.get(Department, department_id)
    if not department or not department.is_active:
        raise HTTPException(status_code=422, detail=f"الإدارة المحددة في {step_label} غير موجودة أو غير نشطة")
    if not department.manager_id:
        raise HTTPException(status_code=422, detail=f"الإدارة المحددة في {step_label} لا يوجد لها مدير")
    manager = db.get(User, department.manager_id)
    if not manager or not manager.is_active:
        raise HTTPException(status_code=422, detail=f"مدير الإدارة المحددة في {step_label} غير نشط")
    return department.manager_id


def workflow_summary(db: Session, request_type_id: int) -> str:
    template = db.scalar(select(WorkflowTemplate).where(WorkflowTemplate.request_type_id == request_type_id, WorkflowTemplate.is_active == True))
    if not template:
        return "No workflow"
    steps = db.scalars(select(WorkflowTemplateStep).where(WorkflowTemplateStep.workflow_template_id == template.id).order_by(WorkflowTemplateStep.sort_order)).all()
    return " -> ".join(workflow_step_display(step.step_type, step.step_name_ar, step.step_name_en) for step in steps) or "No steps"


def request_type_has_active_workflow(db: Session, request_type_id: int) -> bool:
    steps_count = db.scalar(
        select(func.count())
        .select_from(WorkflowTemplateStep)
        .join(WorkflowTemplate, WorkflowTemplateStep.workflow_template_id == WorkflowTemplate.id)
        .where(
            WorkflowTemplate.request_type_id == request_type_id,
            WorkflowTemplate.is_active == True,
            WorkflowTemplateStep.is_active == True,
        )
    ) or 0
    return steps_count > 0


def workflow_snapshot(db: Session, request_type_id: int) -> list[dict]:
    template = db.scalar(select(WorkflowTemplate).where(WorkflowTemplate.request_type_id == request_type_id, WorkflowTemplate.is_active == True))
    if not template:
        return []
    steps = db.scalars(
        select(WorkflowTemplateStep)
        .where(WorkflowTemplateStep.workflow_template_id == template.id, WorkflowTemplateStep.is_active == True)
        .order_by(WorkflowTemplateStep.sort_order)
    ).all()
    return [
        {
            "step_name_ar": step.step_name_ar,
            "step_name_en": step.step_name_en,
            "step_type": step.step_type,
            "approver_role_id": step.approver_role_id,
            "approver_user_id": step.approver_user_id,
            "target_department_id": step.target_department_id,
            "is_mandatory": step.is_mandatory,
            "can_reject": step.can_reject,
            "can_return_for_edit": step.can_return_for_edit,
            "return_to_step_order": step.return_to_step_order,
            "sla_hours": step.sla_hours,
            "escalation_user_id": step.escalation_user_id,
            "sort_order": step.sort_order,
            "is_active": step.is_active,
        }
        for step in steps
    ]


def build_version_snapshot(db: Session, request_type: RequestTypeSetting) -> dict:
    fields = db.scalars(
        select(RequestTypeField)
        .where(RequestTypeField.request_type_id == request_type.id, RequestTypeField.is_active == True)
        .order_by(RequestTypeField.sort_order)
    ).all()
    return {
        "request_type": request_type_snapshot(request_type),
        "fields": form_schema_snapshot(fields),
        "workflow": workflow_snapshot(db, request_type.id),
    }


def ensure_active_request_type_version(db: Session, request_type: RequestTypeSetting, actor: User | None = None) -> RequestTypeVersion:
    active = db.scalar(
        select(RequestTypeVersion)
        .where(RequestTypeVersion.request_type_id == request_type.id, RequestTypeVersion.status == "active")
        .order_by(RequestTypeVersion.version_number.desc())
    )
    if active:
        return active
    version_number = request_type.current_version_number or 1
    active = RequestTypeVersion(
        request_type_id=request_type.id,
        version_number=version_number,
        status="active",
        change_summary="Initial published version",
        snapshot_json=build_version_snapshot(db, request_type),
        created_by_id=actor.id if actor else None,
        activated_at=datetime.now(timezone.utc),
    )
    db.add(active)
    db.flush()
    return active


def hydrate_active_version_request_type_snapshot(db: Session, request_type: RequestTypeSetting, version: RequestTypeVersion) -> RequestTypeVersion:
    snapshot = dict(version.snapshot_json or {})
    request_type_snapshot_data = dict(snapshot.get("request_type") or {})
    current_snapshot = request_type_snapshot(request_type)
    changed = False

    for key, value in current_snapshot.items():
        current_value = request_type_snapshot_data.get(key)
        if key not in request_type_snapshot_data:
            request_type_snapshot_data[key] = value
            changed = True
        elif current_value in (None, "") and value not in (None, ""):
            request_type_snapshot_data[key] = value
            changed = True

    if changed:
        snapshot["request_type"] = request_type_snapshot_data
        version.snapshot_json = snapshot
        db.flush()
    return version


def upsert_draft_request_type_version(db: Session, request_type: RequestTypeSetting, actor: User | None = None, reason: str = "configuration_changed") -> RequestTypeVersion:
    active = ensure_active_request_type_version(db, request_type, actor)
    draft = db.scalar(
        select(RequestTypeVersion).where(RequestTypeVersion.request_type_id == request_type.id, RequestTypeVersion.status == "draft")
    )
    if not draft:
        draft = RequestTypeVersion(
            request_type_id=request_type.id,
            version_number=active.version_number + 1,
            status="draft",
            created_by_id=actor.id if actor else None,
        )
        db.add(draft)
    draft.change_summary = reason
    snapshot = build_version_snapshot(db, request_type)
    snapshot.setdefault("request_type", {})["version_number"] = draft.version_number
    draft.snapshot_json = snapshot
    db.flush()
    write_audit(
        db,
        "request_type_draft_version_updated",
        "request_type_versions",
        actor=actor,
        entity_id=str(draft.id),
        metadata={"request_type_id": request_type.id, "version": draft.version_number, "reason": reason},
    )
    return draft


def bump_request_type_version(db: Session, request_type_id: int, actor: User | None = None, reason: str = "configuration_changed") -> int:
    request_type = db.get(RequestTypeSetting, request_type_id)
    if not request_type:
        raise HTTPException(status_code=404, detail="Request type not found")
    return upsert_draft_request_type_version(db, request_type, actor, reason).version_number


def request_type_snapshot(request_type: RequestTypeSetting) -> dict:
    return {
        "id": request_type.id,
        "code": request_type.code,
        "name_ar": request_type.name_ar,
        "name_en": request_type.name_en,
        "category": request_type.category,
        "description": request_type.description,
        "icon": request_type.icon,
        "is_active": request_type.is_active,
        "assigned_section": request_type.assigned_section,
        "assigned_department_id": request_type.assigned_department_id,
        "auto_assign_strategy": request_type.auto_assign_strategy or "none",
        "requires_attachment": request_type.requires_attachment,
        "allow_multiple_attachments": request_type.allow_multiple_attachments,
        "max_attachments": request_type.max_attachments or (5 if request_type.allow_multiple_attachments else 1),
        "max_file_size_mb": request_type.max_file_size_mb or 10,
        "allowed_extensions_json": request_type.allowed_extensions_json or ["pdf", "png", "jpg", "jpeg"],
        "default_priority": request_type.default_priority,
        "sla_response_hours": request_type.sla_response_hours,
        "sla_resolution_hours": request_type.sla_resolution_hours,
        "version_number": request_type.current_version_number or 1,
    }


def form_schema_snapshot(fields: list[RequestTypeField]) -> list[dict]:
    return [
        {
            "field_name": field.field_name,
            "label_ar": field.label_ar,
            "label_en": field.label_en,
            "field_type": field.field_type,
            "is_required": field.is_required,
            "placeholder": field.placeholder,
            "help_text": field.help_text,
            "validation_rules": field.validation_rules or {},
            "options": field.options or [],
            "sort_order": field.sort_order,
            "is_active": field.is_active,
        }
        for field in sorted(fields, key=lambda item: item.sort_order)
        if field.is_active
    ]


@request_management_router.get("/overview")
def request_management_overview(db: Session = Depends(get_db), _: User = view_actor):
    items = db.scalars(select(RequestTypeSetting)).all()
    type_ids = [item.id for item in items]
    workflow_ids = set()
    if type_ids:
        workflow_ids = {
            row.request_type_id
            for row in db.execute(
                select(WorkflowTemplate.request_type_id)
                .join(WorkflowTemplateStep, WorkflowTemplateStep.workflow_template_id == WorkflowTemplate.id)
                .where(
                    WorkflowTemplate.request_type_id.in_(type_ids),
                    WorkflowTemplate.is_active == True,
                    WorkflowTemplateStep.is_active == True,
                )
                .group_by(WorkflowTemplate.request_type_id)
            ).all()
            if row.request_type_id is not None
        }
    by_category: dict[str, int] = {}
    by_section: dict[str, int] = {}
    for item in items:
        by_category[item.category or "general"] = by_category.get(item.category or "general", 0) + 1
        section = item.assigned_section or "غير محدد"
        by_section[section] = by_section.get(section, 0) + 1
    return {
        "total_request_types": len(items),
        "active_request_types": len([item for item in items if item.is_active]),
        "inactive_request_types": len([item for item in items if not item.is_active]),
        "missing_workflow": len([item for item in items if item.id not in workflow_ids]),
        "missing_specialized_section": len([item for item in items if not item.assigned_section and not item.assigned_department_id]),
        "requires_attachment": len([item for item in items if item.requires_attachment]),
        "has_sla": len([item for item in items if (item.sla_response_hours or 0) > 0 or (item.sla_resolution_hours or 0) > 0]),
        "last_updated_at": max((item.updated_at for item in items if item.updated_at), default=None),
        "by_category": [{"label": key, "value": value} for key, value in sorted(by_category.items())],
        "by_section": [{"label": key, "value": value} for key, value in sorted(by_section.items())],
        "by_status": [
            {"label": "نشط", "value": len([item for item in items if item.is_active])},
            {"label": "متوقف", "value": len([item for item in items if not item.is_active])},
        ],
    }


def request_type_read(item: RequestTypeSetting, fields_count: int = 0, workflow_text: str = "No workflow") -> RequestTypeRead:
    return RequestTypeRead(
        id=item.id,
        name_ar=item.name_ar,
        name_en=item.name_en,
        code=item.code,
        category=item.category,
        assigned_section=item.assigned_section,
        assigned_department_id=item.assigned_department_id,
        auto_assign_strategy=item.auto_assign_strategy or "none",
        description=item.description,
        icon=item.icon,
        is_active=item.is_active,
        requires_attachment=item.requires_attachment,
        allow_multiple_attachments=item.allow_multiple_attachments,
        max_attachments=item.max_attachments or (5 if item.allow_multiple_attachments else 1),
        max_file_size_mb=item.max_file_size_mb or 10,
        allowed_extensions_json=item.allowed_extensions_json or ["pdf", "png", "jpg", "jpeg"],
        default_priority=item.default_priority,
        sla_response_hours=item.sla_response_hours,
        sla_resolution_hours=item.sla_resolution_hours,
        current_version_number=item.current_version_number or 1,
        created_at=item.created_at,
        updated_at=item.updated_at,
        fields_count=fields_count,
        workflow_summary=workflow_text,
    )


def request_type_read_from_version(item: RequestTypeSetting, version: RequestTypeVersion) -> RequestTypeRead:
    snapshot = version.snapshot_json or {}
    request_type = snapshot.get("request_type") or {}
    fields = snapshot.get("fields") or []
    workflow = snapshot.get("workflow") or []
    workflow_text = " -> ".join(
        workflow_step_display(step.get("step_type"), step.get("step_name_ar"), step.get("step_name_en"))
        for step in workflow
        if step.get("is_active", True)
    ) or "No workflow"
    return RequestTypeRead(
        id=item.id,
        name_ar=request_type.get("name_ar") or item.name_ar,
        name_en=request_type.get("name_en") or item.name_en,
        code=request_type.get("code") or item.code,
        category=request_type.get("category") or item.category,
        assigned_section=request_type.get("assigned_section"),
        assigned_department_id=request_type.get("assigned_department_id"),
        auto_assign_strategy=request_type.get("auto_assign_strategy") or item.auto_assign_strategy or "none",
        description=request_type.get("description") or item.description,
        icon=item.icon,
        is_active=item.is_active,
        requires_attachment=bool(request_type.get("requires_attachment", item.requires_attachment)),
        allow_multiple_attachments=bool(request_type.get("allow_multiple_attachments", item.allow_multiple_attachments)),
        max_attachments=request_type.get("max_attachments") or item.max_attachments or (5 if item.allow_multiple_attachments else 1),
        max_file_size_mb=request_type.get("max_file_size_mb") or item.max_file_size_mb or 10,
        allowed_extensions_json=request_type.get("allowed_extensions_json") or item.allowed_extensions_json or ["pdf", "png", "jpg", "jpeg"],
        default_priority=request_type.get("default_priority") or item.default_priority,
        sla_response_hours=request_type.get("sla_response_hours") or item.sla_response_hours,
        sla_resolution_hours=request_type.get("sla_resolution_hours") or item.sla_resolution_hours,
        current_version_number=version.version_number,
        created_at=item.created_at,
        updated_at=item.updated_at,
        fields_count=len([field for field in fields if field.get("is_active", True)]),
        workflow_summary=workflow_text,
    )


def version_is_ready(version: RequestTypeVersion) -> bool:
    snapshot = version.snapshot_json or {}
    request_type = snapshot.get("request_type") or {}
    workflow = snapshot.get("workflow") or []
    has_route = bool(request_type.get("assigned_section") or request_type.get("assigned_department_id"))
    has_workflow = bool([step for step in workflow if step.get("is_active", True)])
    return has_route and has_workflow


def active_version_for_usage(db: Session, item: RequestTypeSetting) -> RequestTypeVersion:
    version = ensure_active_request_type_version(db, item)
    version = hydrate_active_version_request_type_snapshot(db, item, version)
    if item.current_version_number != version.version_number:
        item.current_version_number = version.version_number
        db.flush()
    return version


def validate_version_publishable(db: Session, version: RequestTypeVersion) -> None:
    validation = build_version_validation(db, version)
    if not validation["can_publish"]:
        raise HTTPException(status_code=409, detail=validation["errors"][0] if validation["errors"] else "لا يمكن نشر النسخة قبل معالجة الأخطاء")


def build_version_validation(db: Session | None, version: RequestTypeVersion) -> dict:
    snapshot = version.snapshot_json or {}
    request_type = snapshot.get("request_type") or {}
    fields = [field for field in snapshot.get("fields") or [] if field.get("is_active", True)]
    workflow = [step for step in snapshot.get("workflow") or [] if step.get("is_active", True)]
    checks: list[dict] = []

    def add_check(code: str, label: str, status_value: str, message: str) -> None:
        checks.append({"code": code, "label": label, "status": status_value, "message": message})

    basic_missing = [key for key in ("name_ar", "name_en", "code") if not request_type.get(key)]
    add_check(
        "basic_info",
        "البيانات الأساسية",
        "failed" if basic_missing else "passed",
        "بيانات نوع الطلب الأساسية مكتملة." if not basic_missing else "توجد بيانات أساسية ناقصة في نوع الطلب.",
    )

    has_route = bool(request_type.get("assigned_section") or request_type.get("assigned_department_id"))
    add_check(
        "routing",
        "القسم المختص",
        "passed" if has_route else "failed",
        "تم تحديد القسم المختص أو الإدارة المسؤولة." if has_route else "يجب تحديد القسم المختص قبل النشر.",
    )

    add_check(
        "fields",
        "حقول النموذج",
        "passed" if fields else "warning",
        f"النموذج يحتوي على {len(fields)} حقل نشط." if fields else "لا توجد حقول نشطة في النموذج؛ يمكن النشر لكن النموذج سيكون محدوداً.",
    )

    field_names = [field.get("field_name") for field in fields if field.get("field_name")]
    duplicate_fields = sorted({name for name in field_names if field_names.count(name) > 1})
    add_check(
        "field_uniqueness",
        "معرفات الحقول",
        "failed" if duplicate_fields else "passed",
        f"معرفات الحقول مكررة: {', '.join(duplicate_fields)}" if duplicate_fields else "معرفات الحقول غير مكررة.",
    )

    select_without_options = [
        field.get("label_ar") or field.get("field_name")
        for field in fields
        if field.get("field_type") in {"select", "multi_select"} and not field.get("options")
    ]
    add_check(
        "field_options",
        "خيارات الحقول",
        "failed" if select_without_options else "passed",
        f"حقول الاختيار التالية بدون خيارات: {', '.join(select_without_options)}" if select_without_options else "حقول الاختيار تحتوي على خيارات صالحة.",
    )

    add_check(
        "workflow",
        "مسار الموافقات",
        "passed" if workflow else "failed",
        f"مسار الموافقات يحتوي على {len(workflow)} مرحلة نشطة." if workflow else "يجب إضافة مرحلة موافقة واحدة على الأقل.",
    )

    invalid_steps: list[str] = []
    inactive_step_refs: list[str] = []
    for step in workflow:
        step_type = step.get("step_type")
        if step_type == "specific_user" and not step.get("approver_user_id"):
            invalid_steps.append(step.get("step_name_ar") or step.get("step_name_en") or "مرحلة بدون اسم")
        if step_type == "specific_role" and not step.get("approver_role_id"):
            invalid_steps.append(step.get("step_name_ar") or step.get("step_name_en") or "مرحلة بدون اسم")
        if step_type == "specific_department_manager" and not step.get("target_department_id"):
            invalid_steps.append(step.get("step_name_ar") or step.get("step_name_en") or "مرحلة بدون اسم")
        if db and step.get("approver_user_id"):
            user = db.get(User, step.get("approver_user_id"))
            if not user or not user.is_active:
                inactive_step_refs.append(step.get("step_name_ar") or step.get("step_name_en") or "مرحلة بدون اسم")
        if db and step.get("approver_role_id"):
            role = db.get(Role, step.get("approver_role_id"))
            if not role or not role.is_active:
                inactive_step_refs.append(step.get("step_name_ar") or step.get("step_name_en") or "مرحلة بدون اسم")
        if db and step.get("target_department_id"):
            department = db.get(Department, step.get("target_department_id"))
            manager = db.get(User, department.manager_id) if department and department.manager_id else None
            if not department or not department.is_active or not manager or not manager.is_active:
                inactive_step_refs.append(step.get("step_name_ar") or step.get("step_name_en") or "مرحلة بدون اسم")

    add_check(
        "workflow_approvers",
        "مراجعو المراحل",
        "failed" if invalid_steps else "passed",
        f"مراحل تحتاج تحديد مستخدم أو دور أو إدارة: {', '.join(invalid_steps)}" if invalid_steps else "كل مراحل الموافقة تحتوي على قاعدة اعتماد صالحة.",
    )
    add_check(
        "active_approvers",
        "حالة المستخدمين والأدوار",
        "failed" if inactive_step_refs else "passed",
        f"مراحل مرتبطة بمستخدم أو دور أو إدارة غير جاهزة: {', '.join(inactive_step_refs)}" if inactive_step_refs else "المستخدمون والأدوار والإدارات المرتبطة بالمسار نشطة.",
    )

    sla_response = request_type.get("sla_response_hours")
    sla_resolution = request_type.get("sla_resolution_hours")

    def positive_number(value) -> bool:
        if value in (None, ""):
            return True
        try:
            return int(value) > 0
        except (TypeError, ValueError):
            return False

    sla_valid = all(positive_number(value) for value in [sla_response, sla_resolution])
    add_check(
        "sla",
        "الأولوية و SLA",
        "passed" if sla_valid else "failed",
        "إعدادات SLA صالحة." if sla_valid else "قيم SLA يجب أن تكون أرقاماً موجبة.",
    )

    max_attachments = request_type.get("max_attachments") or (5 if request_type.get("allow_multiple_attachments") else 1)
    max_file_size_mb = request_type.get("max_file_size_mb") or 10
    allowed_extensions = request_type.get("allowed_extensions_json") or ["pdf", "png", "jpg", "jpeg"]
    attachment_valid = True
    attachment_message = "قواعد المرفقات صالحة."
    try:
        max_attachments = int(max_attachments)
        max_file_size_mb = int(max_file_size_mb)
        if max_attachments < 1 or max_file_size_mb < 1:
            attachment_valid = False
    except (TypeError, ValueError):
        attachment_valid = False
    if not allowed_extensions:
        attachment_valid = False
    blocked_extensions = {"exe", "bat", "cmd", "ps1", "sh", "js", "vbs", "msi", "dll", "com", "scr"}
    blocked = sorted(set(str(item).lower().lstrip(".") for item in allowed_extensions).intersection(blocked_extensions))
    if blocked:
        attachment_valid = False
        attachment_message = f"امتدادات خطرة غير مسموحة: {', '.join(blocked)}"
    elif not attachment_valid:
        attachment_message = "قواعد المرفقات غير مكتملة أو تحتوي قيماً غير صحيحة."
    add_check("attachments", "قواعد المرفقات", "passed" if attachment_valid else "failed", attachment_message)

    errors = [item["message"] for item in checks if item["status"] == "failed"]
    warnings = [item["message"] for item in checks if item["status"] == "warning"]
    return {
        "version_id": version.id,
        "version_number": version.version_number,
        "version_status": version.status,
        "can_publish": not errors,
        "errors_count": len(errors),
        "warnings_count": len(warnings),
        "checks": checks,
        "errors": errors,
        "warnings": warnings,
        "preview": {
            "request_type_name": request_type.get("name_ar"),
            "request_type_code": request_type.get("code"),
            "fields_count": len(fields),
            "workflow_steps_count": len(workflow),
            "requires_attachment": bool(request_type.get("requires_attachment")),
            "assigned_section": request_type.get("assigned_section"),
            "assigned_department_id": request_type.get("assigned_department_id"),
            "default_priority": request_type.get("default_priority"),
        },
    }


def create_snapshot_steps_from_version(db: Session, service_request: ServiceRequest, workflow_steps: list[dict]) -> None:
    steps = [step for step in workflow_steps if step.get("is_active", True)]
    if not steps:
        raise HTTPException(status_code=409, detail="Workflow must have at least one approval step")
    now = datetime.now(timezone.utc)
    used_orders: set[int] = set()
    for index, step in enumerate(sorted(steps, key=lambda item: (item.get("sort_order") or 0, item.get("step_name_ar") or ""))):
        candidate_order = int(step.get("sort_order") or index + 1)
        sort_order = candidate_order if candidate_order > 0 and candidate_order not in used_orders else index + 1
        while sort_order in used_orders:
            sort_order += 1
        used_orders.add(sort_order)
        step_type = step.get("step_type") or "direct_manager"
        resolved_approver_user_id = step.get("approver_user_id")
        if step_type == "specific_department_manager":
            step_label = step.get("step_name_ar") or step.get("step_name_en") or f"مرحلة {sort_order}"
            resolved_approver_user_id = require_department_manager(db, step.get("target_department_id"), step_label)
            step["approver_user_id"] = resolved_approver_user_id
        db.add(
            RequestApprovalStep(
                request_id=service_request.id,
                step_name_ar=step.get("step_name_ar") or step.get("step_name_en") or f"مرحلة {sort_order}",
                step_name_en=step.get("step_name_en") or step.get("step_name_ar") or f"Step {sort_order}",
                step_type=step_type,
                approver_role_id=step.get("approver_role_id"),
                approver_user_id=resolved_approver_user_id,
                status="pending" if index == 0 else "waiting",
                sla_due_at=now + timedelta(hours=int(step.get("sla_hours") or 8)),
                sort_order=sort_order,
            )
        )
        db.add(
            ApprovalStep(
                request_id=service_request.id,
                step_order=sort_order,
                role=step_type,
                action=ApprovalAction.PENDING,
            )
        )


def read_request_type(db: Session, item: RequestTypeSetting) -> RequestTypeRead:
    fields_count = db.scalar(select(func.count()).select_from(RequestTypeField).where(RequestTypeField.request_type_id == item.id)) or 0
    return request_type_read(item, int(fields_count), workflow_summary(db, item.id))


def read_request_types_bulk(db: Session, items: list[RequestTypeSetting]) -> list[RequestTypeRead]:
    if not items:
        return []
    ids = [item.id for item in items]
    fields_counts = {
        row.request_type_id: int(row.count or 0)
        for row in db.execute(
            select(RequestTypeField.request_type_id, func.count(RequestTypeField.id).label("count"))
            .where(RequestTypeField.request_type_id.in_(ids))
            .group_by(RequestTypeField.request_type_id)
        ).all()
    }
    workflow_rows = db.execute(
        select(
            WorkflowTemplate.request_type_id,
            WorkflowTemplateStep.step_type,
            WorkflowTemplateStep.step_name_ar,
            WorkflowTemplateStep.step_name_en,
            WorkflowTemplateStep.sort_order,
        )
        .join(WorkflowTemplateStep, WorkflowTemplateStep.workflow_template_id == WorkflowTemplate.id)
        .where(
            WorkflowTemplate.request_type_id.in_(ids),
            WorkflowTemplate.is_active == True,
            WorkflowTemplateStep.is_active == True,
        )
        .order_by(WorkflowTemplate.request_type_id, WorkflowTemplateStep.sort_order)
    ).all()
    workflow_map: dict[int, list[str]] = {}
    for row in workflow_rows:
        workflow_map.setdefault(row.request_type_id, []).append(workflow_step_display(row.step_type, row.step_name_ar, row.step_name_en))

    return [
        request_type_read(
            item,
            fields_count=fields_counts.get(item.id, 0),
            workflow_text=" -> ".join(workflow_map.get(item.id, [])) or "No workflow",
        )
        for item in items
    ]


@router.get("", response_model=list[RequestTypeRead])
def list_request_types(
    db: Session = Depends(get_db),
    _: User = view_actor,
    search: str | None = None,
    status_filter: str | None = Query(default=None, alias="status"),
    category: str | None = None,
):
    stmt = select(RequestTypeSetting).order_by(RequestTypeSetting.name_ar)
    if search:
        stmt = stmt.where(
            RequestTypeSetting.name_ar.ilike(f"%{search}%")
            | RequestTypeSetting.name_en.ilike(f"%{search}%")
            | RequestTypeSetting.code.ilike(f"%{search}%")
        )
    if status_filter == "active":
        stmt = stmt.where(RequestTypeSetting.is_active == True)
    if status_filter == "inactive":
        stmt = stmt.where(RequestTypeSetting.is_active == False)
    if category:
        stmt = stmt.where(RequestTypeSetting.category == category)
    return read_request_types_bulk(db, db.scalars(stmt).all())


@router.get("/bootstrap")
def request_types_bootstrap(
    db: Session = Depends(get_db),
    _: User = view_actor,
    search: str | None = None,
    status_filter: str | None = Query(default=None, alias="status"),
):
    types = list_request_types(db=db, _=_, search=search, status_filter=status_filter)
    departments = db.scalars(select(Department).order_by(Department.name_ar)).all()
    sections = db.scalars(
        select(SpecializedSection)
        .where(SpecializedSection.is_active == True)
        .order_by(SpecializedSection.name_ar)
    ).all()
    return {
        "request_types": types,
        "departments": departments,
        "specialized_sections": sections,
    }


@router.get("/active", response_model=list[RequestTypeRead])
def list_active_request_types(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    items = db.scalars(
        select(RequestTypeSetting)
        .where(RequestTypeSetting.is_active == True)
        .order_by(RequestTypeSetting.name_ar)
    ).all()
    ready_types: list[RequestTypeRead] = []
    for item in items:
        version = active_version_for_usage(db, item)
        if version_is_ready(version):
            ready_types.append(request_type_read_from_version(item, version))
    db.commit()
    return ready_types


@router.get("/workflow-roles")
def list_workflow_roles(db: Session = Depends(get_db), _: User = view_actor):
    roles = db.scalars(select(Role).where(Role.is_active == True).order_by(Role.label_ar, Role.name_ar)).all()
    return [
        {
            "id": role.id,
            "code": role.code or role.name,
            "name_ar": role.name_ar or role.label_ar or role.name,
            "name_en": role.name_en or role.name,
            "is_system_role": role.is_system_role,
        }
        for role in roles
        if not is_hidden_workflow_role(role)
    ]


@router.get("/workflow-departments")
def list_workflow_departments(db: Session = Depends(get_db), _: User = view_actor):
    departments = db.scalars(select(Department).where(Department.is_active == True).order_by(Department.name_ar)).all()
    return [
        {
            "id": department.id,
            "code": department.code,
            "name_ar": department.name_ar,
            "name_en": department.name_en,
            "manager_id": department.manager_id,
        }
        for department in departments
    ]


@router.get("/{request_type_id}", response_model=RequestTypeRead)
def get_request_type(request_type_id: int, db: Session = Depends(get_db), _: User = view_actor):
    item = db.get(RequestTypeSetting, request_type_id)
    if not item:
        raise HTTPException(status_code=404, detail="Request type not found")
    return read_request_type(db, item)


@router.get("/{request_type_id}/versions")
def list_request_type_versions(request_type_id: int, db: Session = Depends(get_db), _: User = view_actor):
    item = db.get(RequestTypeSetting, request_type_id)
    if not item:
        raise HTTPException(status_code=404, detail="Request type not found")
    ensure_active_request_type_version(db, item)
    db.flush()
    versions = db.scalars(
        select(RequestTypeVersion)
        .where(RequestTypeVersion.request_type_id == request_type_id)
        .order_by(RequestTypeVersion.version_number.desc())
    ).all()
    response = {
        "request_type_id": item.id,
        "current_version_number": item.current_version_number or 1,
        "versions": [
            {
                "id": version.id,
                "version_number": version.version_number,
                "status": version.status,
                "requests_count": db.scalar(
                    select(func.count())
                    .select_from(ServiceRequest)
                    .where(
                        ServiceRequest.request_type_id == request_type_id,
                        or_(
                            ServiceRequest.request_type_version_id == version.id,
                            ServiceRequest.request_type_version_number == version.version_number,
                        ),
                    )
                )
                or 0,
                "change_summary": version.change_summary,
                "created_at": version.created_at,
                "activated_at": version.activated_at,
                "updated_at": version.activated_at or version.created_at,
                "is_ready": version_is_ready(version),
            }
            for version in versions
        ],
    }
    db.commit()
    return response


@router.post("/{request_type_id}/versions/validate-draft")
def validate_request_type_draft(request_type_id: int, db: Session = Depends(get_db), _: User = view_actor):
    item = db.get(RequestTypeSetting, request_type_id)
    if not item:
        raise HTTPException(status_code=404, detail="Request type not found")
    active = ensure_active_request_type_version(db, item)
    draft = db.scalar(
        select(RequestTypeVersion).where(
            RequestTypeVersion.request_type_id == request_type_id,
            RequestTypeVersion.status == "draft",
        )
    )
    version = draft or active
    response = build_version_validation(db, version)
    response["has_draft"] = bool(draft)
    db.commit()
    return response


@router.post("/{request_type_id}/versions/publish-draft")
def publish_request_type_draft(request_type_id: int, db: Session = Depends(get_db), actor: User = manage_actor):
    item = db.get(RequestTypeSetting, request_type_id)
    if not item:
        raise HTTPException(status_code=404, detail="Request type not found")
    ensure_active_request_type_version(db, item, actor)
    draft = db.scalar(
        select(RequestTypeVersion).where(
            RequestTypeVersion.request_type_id == request_type_id,
            RequestTypeVersion.status == "draft",
        )
    )
    if not draft:
        draft = upsert_draft_request_type_version(db, item, actor, "publish_current_configuration")
    validate_version_publishable(db, draft)
    for version in db.scalars(
        select(RequestTypeVersion).where(
            RequestTypeVersion.request_type_id == request_type_id,
            RequestTypeVersion.status == "active",
        )
    ).all():
        version.status = "archived"
    draft.status = "active"
    draft.activated_at = datetime.now(timezone.utc)
    item.current_version_number = draft.version_number
    snapshot = draft.snapshot_json or {}
    snapshot.setdefault("request_type", {})["version_number"] = draft.version_number
    draft.snapshot_json = snapshot
    write_audit(
        db,
        "request_type_version_activated",
        "request_type_versions",
        actor=actor,
        entity_id=str(draft.id),
        metadata={"request_type_id": request_type_id, "version": draft.version_number},
    )
    db.commit()
    return {"message": "تم نشر النسخة", "request_type_id": request_type_id, "version_number": draft.version_number}


@version_router.post("/{version_id}/validate")
def validate_request_type_version(version_id: int, db: Session = Depends(get_db), _: User = view_actor):
    version = db.get(RequestTypeVersion, version_id)
    if not version:
        raise HTTPException(status_code=404, detail="Request type version not found")
    return build_version_validation(db, version)


def normalized_request_type_payload(db: Session, payload: RequestTypePayload) -> dict:
    data = payload.model_dump()
    data["allowed_extensions_json"] = sorted({str(item).strip().lower().lstrip(".") for item in data.get("allowed_extensions_json", []) if str(item).strip()})
    if not data["allow_multiple_attachments"]:
        data["max_attachments"] = 1
    general = db.scalar(select(SettingsGeneral).limit(1))
    global_max_mb = int(general.upload_max_file_size_mb or 10) if general else 10
    if data["max_file_size_mb"] > global_max_mb:
        raise HTTPException(status_code=422, detail=f"لا يمكن أن يتجاوز حجم المرفق لهذا النوع الحد الأقصى العام للمرفقات وهو {global_max_mb} MB.")
    return data


@router.post("", response_model=RequestTypeRead, status_code=status.HTTP_201_CREATED)
def create_request_type(payload: RequestTypePayload, db: Session = Depends(get_db), actor: User = manage_actor):
    if db.scalar(select(RequestTypeSetting).where(RequestTypeSetting.code == payload.code)):
        raise HTTPException(status_code=409, detail="رمز نوع الطلب مستخدم من قبل")
    if payload.assigned_department_id and not db.get(Department, payload.assigned_department_id):
        raise HTTPException(status_code=404, detail="Assigned department not found")
    data = normalized_request_type_payload(db, payload)
    item = RequestTypeSetting(**data, request_type=payload.code, label_ar=payload.name_ar, is_enabled=payload.is_active, require_attachment=payload.requires_attachment)
    db.add(item)
    db.flush()
    write_audit(db, "request_type_created", "request_types", actor=actor, entity_id=str(item.id), metadata={"code": item.code})
    db.commit()
    db.refresh(item)
    return read_request_type(db, item)


@router.put("/{request_type_id}", response_model=RequestTypeRead)
def update_request_type(request_type_id: int, payload: RequestTypePayload, db: Session = Depends(get_db), actor: User = manage_actor):
    item = db.get(RequestTypeSetting, request_type_id)
    if not item:
        raise HTTPException(status_code=404, detail="Request type not found")
    duplicate = db.scalar(select(RequestTypeSetting).where(RequestTypeSetting.code == payload.code, RequestTypeSetting.id != request_type_id))
    if duplicate:
        raise HTTPException(status_code=409, detail="رمز نوع الطلب مستخدم من قبل")
    if payload.assigned_department_id and not db.get(Department, payload.assigned_department_id):
        raise HTTPException(status_code=404, detail="Assigned department not found")
    data = normalized_request_type_payload(db, payload)
    for field, value in data.items():
        setattr(item, field, value)
    item.request_type = payload.code
    item.label_ar = payload.name_ar
    item.is_enabled = payload.is_active
    item.require_attachment = payload.requires_attachment
    bump_request_type_version(db, item.id, actor, "basic_info_updated")
    write_audit(db, "request_type_updated", "request_types", actor=actor, entity_id=str(item.id), metadata={"code": item.code})
    db.commit()
    db.refresh(item)
    return read_request_type(db, item)


@router.delete("/{request_type_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_request_type(request_type_id: int, db: Session = Depends(get_db), actor: User = manage_actor):
    item = db.get(RequestTypeSetting, request_type_id)
    if not item:
        raise HTTPException(status_code=404, detail="Request type not found")
    existing_requests = db.scalar(select(func.count()).select_from(ServiceRequest).where(ServiceRequest.request_type_id == request_type_id)) or 0
    if existing_requests:
        raise HTTPException(status_code=409, detail="Cannot delete request type with existing requests; disable it instead")
    db.delete(item)
    write_audit(db, "request_type_deleted", "request_types", actor=actor, entity_id=str(request_type_id))
    db.commit()


@router.patch("/{request_type_id}/status", response_model=RequestTypeRead)
def update_request_type_status(request_type_id: int, payload: dict, db: Session = Depends(get_db), actor: User = manage_actor):
    item = db.get(RequestTypeSetting, request_type_id)
    if not item:
        raise HTTPException(status_code=404, detail="Request type not found")
    if payload.get("is_active") is True:
        if not request_type_has_active_workflow(db, request_type_id):
            raise HTTPException(status_code=409, detail="Workflow must have at least one approval step before activating request type")
        if not item.assigned_section and not item.assigned_department_id:
            raise HTTPException(status_code=409, detail="يجب تحديد القسم المختص قبل تفعيل نوع الطلب")
    item.is_active = bool(payload.get("is_active"))
    item.is_enabled = item.is_active
    write_audit(db, "request_type_status_changed", "request_types", actor=actor, entity_id=str(item.id), metadata={"is_active": item.is_active})
    db.commit()
    db.refresh(item)
    return read_request_type(db, item)


@router.get("/{request_type_id}/fields", response_model=list[RequestTypeFieldRead])
def list_fields(request_type_id: int, db: Session = Depends(get_db), _: User = view_actor):
    return db.scalars(select(RequestTypeField).where(RequestTypeField.request_type_id == request_type_id).order_by(RequestTypeField.sort_order)).all()


@router.post("/{request_type_id}/fields", response_model=RequestTypeFieldRead, status_code=status.HTTP_201_CREATED)
def create_field(request_type_id: int, payload: RequestTypeFieldPayload, db: Session = Depends(get_db), actor: User = manage_actor):
    if not db.get(RequestTypeSetting, request_type_id):
        raise HTTPException(status_code=404, detail="Request type not found")
    if db.scalar(select(RequestTypeField).where(RequestTypeField.request_type_id == request_type_id, RequestTypeField.field_name == payload.field_name)):
        raise HTTPException(status_code=409, detail="Field name must be unique per request type")
    item = RequestTypeField(request_type_id=request_type_id, **payload.model_dump())
    db.add(item)
    db.flush()
    bump_request_type_version(db, request_type_id, actor, "field_created")
    write_audit(db, "request_type_field_created", "request_type_fields", actor=actor, entity_id=str(item.id))
    db.commit()
    db.refresh(item)
    return item


@router.put("/fields/{field_id}", response_model=RequestTypeFieldRead)
def update_field(field_id: int, payload: RequestTypeFieldPayload, db: Session = Depends(get_db), actor: User = manage_actor):
    item = db.get(RequestTypeField, field_id)
    if not item:
        raise HTTPException(status_code=404, detail="Field not found")
    duplicate = db.scalar(select(RequestTypeField).where(RequestTypeField.request_type_id == item.request_type_id, RequestTypeField.field_name == payload.field_name, RequestTypeField.id != field_id))
    if duplicate:
        raise HTTPException(status_code=409, detail="Field name must be unique per request type")
    for field, value in payload.model_dump().items():
        setattr(item, field, value)
    bump_request_type_version(db, item.request_type_id, actor, "field_updated")
    write_audit(db, "request_type_field_updated", "request_type_fields", actor=actor, entity_id=str(item.id))
    db.commit()
    db.refresh(item)
    return item


@router.delete("/fields/{field_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_field(field_id: int, db: Session = Depends(get_db), actor: User = manage_actor):
    item = db.get(RequestTypeField, field_id)
    if not item:
        raise HTTPException(status_code=404, detail="Field not found")
    request_type_id = item.request_type_id
    db.delete(item)
    bump_request_type_version(db, request_type_id, actor, "field_deleted")
    write_audit(db, "request_type_field_deleted", "request_type_fields", actor=actor, entity_id=str(field_id))
    db.commit()


@router.post("/{request_type_id}/fields/reorder", response_model=list[RequestTypeFieldRead])
def reorder_fields(request_type_id: int, payload: ReorderPayload, db: Session = Depends(get_db), actor: User = manage_actor):
    for index, field_id in enumerate(payload.ids, start=1):
        item = db.get(RequestTypeField, field_id)
        if item and item.request_type_id == request_type_id:
            item.sort_order = index
    bump_request_type_version(db, request_type_id, actor, "fields_reordered")
    write_audit(db, "request_type_fields_reordered", "request_types", actor=actor, entity_id=str(request_type_id))
    db.commit()
    return db.scalars(select(RequestTypeField).where(RequestTypeField.request_type_id == request_type_id).order_by(RequestTypeField.sort_order)).all()


def get_or_create_template(db: Session, request_type_id: int) -> WorkflowTemplate:
    template = db.scalar(select(WorkflowTemplate).where(WorkflowTemplate.request_type_id == request_type_id, WorkflowTemplate.is_active == True))
    if not template:
        request_type = db.get(RequestTypeSetting, request_type_id)
        if not request_type:
            raise HTTPException(status_code=404, detail="Request type not found")
        template = WorkflowTemplate(request_type_id=request_type_id, request_type=request_type.code, name=f"{request_type.name_en} Workflow", is_active=True)
        db.add(template)
        db.flush()
    return template


def validate_return_target(db: Session, template: WorkflowTemplate, payload: WorkflowStepPayload, step_id: int | None = None) -> None:
    if not payload.can_return_for_edit:
        payload.return_to_step_order = None
        return
    if payload.return_to_step_order is None:
        return
    if payload.return_to_step_order >= payload.sort_order:
        raise HTTPException(status_code=422, detail="Return target must be a previous workflow step")
    target = db.scalar(
        select(WorkflowTemplateStep).where(
            WorkflowTemplateStep.workflow_template_id == template.id,
            WorkflowTemplateStep.sort_order == payload.return_to_step_order,
            WorkflowTemplateStep.is_active == True,
        )
    )
    if not target or (step_id and target.id == step_id):
        raise HTTPException(status_code=422, detail="Return target step is not available")


def validate_workflow_step_reference(db: Session, payload: WorkflowStepPayload) -> None:
    step_label = payload.step_name_ar or payload.step_name_en or "مرحلة الموافقة"
    if payload.step_type == "specific_role":
        if not payload.approver_role_id:
            raise HTTPException(status_code=422, detail="يجب تحديد الدور لهذه المرحلة")
        role = db.get(Role, payload.approver_role_id)
        if not role or not role.is_active:
            raise HTTPException(status_code=422, detail="الدور المحدد غير موجود أو غير نشط")
        payload.approver_user_id = None
        payload.target_department_id = None
        return
    if payload.step_type == "specific_user":
        if not payload.approver_user_id:
            raise HTTPException(status_code=422, detail="يجب تحديد المستخدم لهذه المرحلة")
        user = db.get(User, payload.approver_user_id)
        if not user or not user.is_active:
            raise HTTPException(status_code=422, detail="المستخدم المحدد غير موجود أو غير نشط")
        payload.approver_role_id = None
        payload.target_department_id = None
        return
    if payload.step_type == "specific_department_manager":
        require_department_manager(db, payload.target_department_id, step_label)
        payload.approver_role_id = None
        payload.approver_user_id = None
        return
    payload.approver_role_id = None
    payload.approver_user_id = None
    payload.target_department_id = None


@router.get("/{request_type_id}/workflow", response_model=WorkflowRead)
def get_workflow(request_type_id: int, db: Session = Depends(get_db), _: User = view_actor):
    template = get_or_create_template(db, request_type_id)
    steps = db.scalars(select(WorkflowTemplateStep).where(WorkflowTemplateStep.workflow_template_id == template.id).order_by(WorkflowTemplateStep.sort_order)).all()
    db.commit()
    return WorkflowRead(id=template.id, request_type_id=template.request_type_id, name=template.name, is_active=template.is_active, steps=steps)


@router.post("/{request_type_id}/workflow/steps", response_model=WorkflowStepRead, status_code=status.HTTP_201_CREATED)
def create_workflow_step(request_type_id: int, payload: WorkflowStepPayload, db: Session = Depends(get_db), actor: User = manage_actor):
    template = get_or_create_template(db, request_type_id)
    validate_return_target(db, template, payload)
    validate_workflow_step_reference(db, payload)
    item = WorkflowTemplateStep(workflow_template_id=template.id, **payload.model_dump())
    db.add(item)
    db.flush()
    bump_request_type_version(db, request_type_id, actor, "workflow_step_created")
    write_audit(db, "workflow_template_step_created", "workflow_template_steps", actor=actor, entity_id=str(item.id))
    db.commit()
    db.refresh(item)
    return item


@router.put("/workflow-steps/{step_id}", response_model=WorkflowStepRead)
def update_workflow_step(step_id: int, payload: WorkflowStepPayload, db: Session = Depends(get_db), actor: User = manage_actor):
    item = db.get(WorkflowTemplateStep, step_id)
    if not item:
        raise HTTPException(status_code=404, detail="Workflow step not found")
    template = db.get(WorkflowTemplate, item.workflow_template_id)
    validate_return_target(db, template, payload, step_id)
    validate_workflow_step_reference(db, payload)
    for field, value in payload.model_dump().items():
        setattr(item, field, value)
    if template.request_type_id:
        bump_request_type_version(db, template.request_type_id, actor, "workflow_step_updated")
    write_audit(db, "workflow_template_step_updated", "workflow_template_steps", actor=actor, entity_id=str(item.id))
    db.commit()
    db.refresh(item)
    return item


@router.delete("/workflow-steps/{step_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workflow_step(step_id: int, db: Session = Depends(get_db), actor: User = manage_actor):
    item = db.get(WorkflowTemplateStep, step_id)
    if not item:
        raise HTTPException(status_code=404, detail="Workflow step not found")
    template_id = item.workflow_template_id
    template = db.get(WorkflowTemplate, template_id)
    deleted_order = item.sort_order
    db.delete(item)
    db.flush()
    remaining_steps = db.scalars(
        select(WorkflowTemplateStep)
        .where(WorkflowTemplateStep.workflow_template_id == template_id)
        .order_by(WorkflowTemplateStep.sort_order, WorkflowTemplateStep.id)
    ).all()
    order_map = {step.sort_order: index for index, step in enumerate(remaining_steps, start=1)}
    for index, step in enumerate(remaining_steps, start=1):
        if step.return_to_step_order == deleted_order:
            step.return_to_step_order = None
        elif step.return_to_step_order in order_map:
            step.return_to_step_order = order_map[step.return_to_step_order]
        step.sort_order = index
    if template and template.request_type_id:
        bump_request_type_version(db, template.request_type_id, actor, "workflow_step_deleted")
    write_audit(db, "workflow_template_step_deleted", "workflow_template_steps", actor=actor, entity_id=str(step_id))
    db.commit()


@router.post("/{request_type_id}/workflow/reorder", response_model=WorkflowRead)
def reorder_workflow(request_type_id: int, payload: ReorderPayload, db: Session = Depends(get_db), actor: User = manage_actor):
    template = get_or_create_template(db, request_type_id)
    for index, step_id in enumerate(payload.ids, start=1):
        step = db.get(WorkflowTemplateStep, step_id)
        if step and step.workflow_template_id == template.id:
            step.sort_order = index
    steps = db.scalars(select(WorkflowTemplateStep).where(WorkflowTemplateStep.workflow_template_id == template.id)).all()
    active_orders = {step.sort_order for step in steps if step.is_active}
    for step in steps:
        if step.return_to_step_order and (step.return_to_step_order >= step.sort_order or step.return_to_step_order not in active_orders):
            step.return_to_step_order = None
    if template.request_type_id:
        bump_request_type_version(db, template.request_type_id, actor, "workflow_reordered")
    write_audit(db, "workflow_template_reordered", "workflow_templates", actor=actor, entity_id=str(template.id))
    db.commit()
    return get_workflow(request_type_id, db, actor)


@router.get("/{request_type_id}/workflow/preview")
def preview_workflow(request_type_id: int, db: Session = Depends(get_db), _: User = view_actor):
    template = get_or_create_template(db, request_type_id)
    steps = db.scalars(select(WorkflowTemplateStep).where(WorkflowTemplateStep.workflow_template_id == template.id, WorkflowTemplateStep.is_active == True).order_by(WorkflowTemplateStep.sort_order)).all()
    return {
        "steps": [
            {
                "order": step.sort_order,
                "name_ar": step.step_name_ar,
                "name_en": step.step_name_en,
                "type": step.step_type,
                "target_department_id": step.target_department_id,
                "sla_hours": step.sla_hours,
            }
            for step in steps
        ]
    }


@router.get("/{request_type_id}/form-schema")
def form_schema(request_type_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    request_type = db.get(RequestTypeSetting, request_type_id)
    if not request_type or not request_type.is_active:
        raise HTTPException(status_code=404, detail="Request type not available")
    version = active_version_for_usage(db, request_type)
    if not version_is_ready(version):
        raise HTTPException(status_code=409, detail="نوع الطلب غير جاهز للنشر أو الاستخدام")
    snapshot = version.snapshot_json or {}
    return {
        "request_type": request_type_read_from_version(request_type, version),
        "version_number": version.version_number,
        "fields": snapshot.get("fields") or [],
    }


def _field_attr(field, name: str, default=None):
    if isinstance(field, dict):
        return field.get(name, default)
    return getattr(field, name, default)


def validate_form_data(fields: list, form_data: dict) -> None:
    email_re = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    phone_re = re.compile(r"^[0-9+()\-\s]{5,20}$")
    mac_re = re.compile(r"^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$")
    for field in fields:
        field_name = _field_attr(field, "field_name")
        label = _field_attr(field, "label_ar") or field_name
        field_type = _field_attr(field, "field_type")
        options = _field_attr(field, "options", []) or []
        value = form_data.get(field_name)
        if _field_attr(field, "is_required", False) and (value is None or value == "" or (isinstance(value, list) and len(value) == 0)):
            raise HTTPException(status_code=422, detail=f"الحقل {label} مطلوب")
        if value in (None, ""):
            continue
        if field_type in {"select", "multi_select", "checkbox"} and options:
            values = value if isinstance(value, list) else [value]
            invalid = [item for item in values if item not in options]
            if invalid:
                raise HTTPException(status_code=422, detail=f"قيمة الحقل {label} غير صحيحة")
        if field_type == "email" and not email_re.match(str(value)):
            raise HTTPException(status_code=422, detail=f"صيغة البريد الإلكتروني في الحقل {label} غير صحيحة")
        if field_type == "phone" and not phone_re.match(str(value)):
            raise HTTPException(status_code=422, detail=f"صيغة رقم الهاتف في الحقل {label} غير صحيحة")
        if field_type == "ip_address":
            try:
                ip_address(str(value))
            except ValueError as exc:
                raise HTTPException(status_code=422, detail=f"صيغة عنوان IP في الحقل {label} غير صحيحة") from exc
        if field_type == "mac_address" and not mac_re.match(str(value)):
            raise HTTPException(status_code=422, detail=f"صيغة عنوان MAC في الحقل {label} غير صحيحة")


def create_snapshot_steps(db: Session, service_request: ServiceRequest, request_type_id: int) -> None:
    template = db.scalar(select(WorkflowTemplate).where(WorkflowTemplate.request_type_id == request_type_id, WorkflowTemplate.is_active == True))
    if not template:
        raise HTTPException(status_code=409, detail="Workflow template is missing")
    steps = db.scalars(select(WorkflowTemplateStep).where(WorkflowTemplateStep.workflow_template_id == template.id, WorkflowTemplateStep.is_active == True).order_by(WorkflowTemplateStep.sort_order)).all()
    if not steps:
        raise HTTPException(status_code=409, detail="Workflow must have at least one approval step")
    now = datetime.now(timezone.utc)
    for index, step in enumerate(steps):
        resolved_approver_user_id = step.approver_user_id
        if step.step_type == "specific_department_manager":
            resolved_approver_user_id = require_department_manager(db, step.target_department_id, step.step_name_ar or step.step_name_en)
        db.add(
            RequestApprovalStep(
                request_id=service_request.id,
                step_name_ar=step.step_name_ar,
                step_name_en=step.step_name_en,
                step_type=step.step_type,
                approver_role_id=step.approver_role_id,
                approver_user_id=resolved_approver_user_id,
                status="pending" if index == 0 else "waiting",
                sla_due_at=now + timedelta(hours=step.sla_hours),
                sort_order=step.sort_order,
            )
        )
        db.add(
            ApprovalStep(
                request_id=service_request.id,
                step_order=step.sort_order,
                role=step.step_type,
                action=ApprovalAction.PENDING,
            )
        )


REQUEST_TYPE_CODE_MAP = {
    "EMAIL": RequestType.EMAIL,
    "DOMAIN": RequestType.DOMAIN,
    "VPN": RequestType.VPN,
    "INTERNET": RequestType.INTERNET,
    "DATA_COPY": RequestType.DATA_COPY,
    "NETWORK": RequestType.NETWORK,
    "COMPUTER_MOVE": RequestType.COMPUTER_MOVE,
    "SUPPORT": RequestType.SUPPORT,
}

SECTION_LABELS = {
    "networks": "قسم الشبكات",
    "servers": "قسم السيرفرات",
    "support": "قسم الدعم الفني",
    "development": "وحدة تطوير البرامج",
}


def section_label(db: Session, code: str | None) -> str:
    if not code:
        return ""
    section = db.scalar(select(SpecializedSection).where(SpecializedSection.code == code))
    return section.name_ar if section else SECTION_LABELS.get(code, "")


def section_department_id(db: Session, code: str | None) -> int | None:
    if not code:
        return None
    section = db.scalar(select(SpecializedSection).where(SpecializedSection.code == code))
    return section.department_id if section else None


def sla_due_from_request_type_config(request_type_config: dict) -> datetime | None:
    hours = request_type_config.get("sla_resolution_hours") or request_type_config.get("sla_response_hours")
    if hours in (None, ""):
        return None
    try:
        hours_value = int(hours)
    except (TypeError, ValueError):
        return None
    if hours_value <= 0:
        return None
    return datetime.now(timezone.utc) + timedelta(hours=hours_value)


OPEN_REQUEST_STATUSES = [
    RequestStatus.SUBMITTED,
    RequestStatus.PENDING_APPROVAL,
    RequestStatus.RETURNED_FOR_EDIT,
    RequestStatus.APPROVED,
    RequestStatus.IN_IMPLEMENTATION,
]


def resolve_assigned_user_id(db: Session, request_type_config: dict, assigned_section: str | None) -> int | None:
    strategy = request_type_config.get("auto_assign_strategy") or "none"
    if strategy == "none":
        return None

    def section_user_stmt(*roles: UserRole):
        stmt = select(User).where(User.is_active == True, User.role.in_(list(roles)))
        if assigned_section:
            stmt = stmt.where(User.administrative_section == assigned_section)
        return stmt.order_by(User.id)

    if strategy == "section_manager":
        manager = db.scalar(section_user_stmt(UserRole.DEPARTMENT_MANAGER).limit(1))
        if manager:
            return manager.id
        fallback_manager = db.scalar(select(User).where(User.is_active == True, User.role == UserRole.DEPARTMENT_MANAGER).order_by(User.id).limit(1))
        return fallback_manager.id if fallback_manager else None

    candidates = db.scalars(section_user_stmt(UserRole.IT_STAFF)).all()
    if not candidates:
        candidates = db.scalars(select(User).where(User.is_active == True, User.role == UserRole.IT_STAFF).order_by(User.id)).all()
    if not candidates:
        return None

    def open_count(user: User) -> int:
        return db.scalar(
            select(func.count())
            .select_from(ServiceRequest)
            .where(ServiceRequest.assigned_to_id == user.id, ServiceRequest.status.in_(OPEN_REQUEST_STATUSES))
        ) or 0

    if strategy == "round_robin":
        candidate_ids = [user.id for user in candidates]
        last_assigned_id = db.scalar(
            select(ServiceRequest.assigned_to_id)
            .where(ServiceRequest.assigned_to_id.in_(candidate_ids))
            .order_by(ServiceRequest.created_at.desc(), ServiceRequest.id.desc())
            .limit(1)
        )
        if last_assigned_id in candidate_ids:
            return candidate_ids[(candidate_ids.index(last_assigned_id) + 1) % len(candidate_ids)]
        return candidate_ids[0]

    if strategy == "least_open_requests":
        return min(candidates, key=lambda user: (open_count(user), user.id)).id
    return candidates[0].id


requests_router = APIRouter(prefix="/requests", tags=["Dynamic Request Submission"])


@requests_router.post("/dynamic", status_code=status.HTTP_201_CREATED)
def submit_dynamic_request(payload: RequestSubmitPayload, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    request_type = db.get(RequestTypeSetting, payload.request_type_id)
    if not request_type or not request_type.is_active:
        raise HTTPException(status_code=404, detail="Request type not available")
    active_version = active_version_for_usage(db, request_type)
    if not version_is_ready(active_version):
        raise HTTPException(status_code=409, detail="نوع الطلب غير جاهز للاستخدام")
    version_snapshot = active_version.snapshot_json or {}
    request_type_config = version_snapshot.get("request_type") or {}
    workflow_steps = [dict(step) for step in (version_snapshot.get("workflow") or [])]
    fields = [dict(field) for field in (version_snapshot.get("fields") or [])]
    assigned_section = request_type_config.get("assigned_section") or payload.form_data.get("assigned_section") or payload.form_data.get("administrative_section")
    assigned_department_id = request_type_config.get("assigned_department_id")
    if not assigned_department_id:
        assigned_department_id = section_department_id(db, assigned_section)
    assigned_to_id = resolve_assigned_user_id(db, request_type_config, assigned_section)
    if not assigned_section and not assigned_department_id:
        raise HTTPException(status_code=409, detail="نوع الطلب غير مرتبط بقسم مختص")
    if not workflow_steps:
        raise HTTPException(status_code=409, detail="نوع الطلب لا يحتوي على مسار موافقات فعال")
    attachments_enabled = bool(request_type_config.get("requires_attachment") or request_type_config.get("allow_multiple_attachments"))
    if not attachments_enabled and payload.attachment_count > 0:
        raise HTTPException(status_code=422, detail="المرفقات غير مفعلة لهذا النوع من الطلبات")
    if request_type_config.get("requires_attachment") and payload.attachment_count <= 0:
        raise HTTPException(status_code=422, detail="هذا النوع من الطلبات يتطلب إرفاق ملف قبل الإرسال")
    max_attachments = int(request_type_config.get("max_attachments") or (5 if request_type_config.get("allow_multiple_attachments") else 1))
    if payload.attachment_count > max_attachments:
        raise HTTPException(status_code=422, detail=f"عدد المرفقات أكبر من الحد المسموح لهذا النوع ({max_attachments})")
    validate_form_data(fields, payload.form_data)
    priority = payload.priority or request_type_config.get("default_priority") or request_type.default_priority
    form_data = {
        **payload.form_data,
        "request_type_code": request_type_config.get("code") or request_type.code,
        "request_type_label": request_type_config.get("name_ar") or request_type.name_ar,
        "administrative_section": assigned_section,
        "administrative_section_label": section_label(db, assigned_section),
        "assigned_section": assigned_section,
        "assigned_section_label": section_label(db, assigned_section),
        "assigned_department_id": assigned_department_id,
    }
    service_request = ServiceRequest(
        request_number=next_request_number(db),
        title=payload.title,
        request_type=REQUEST_TYPE_CODE_MAP.get(request_type.code, RequestType.SUPPORT),
        request_type_id=request_type.id,
        request_type_version_id=active_version.id,
        request_type_version_number=active_version.version_number,
        requester_id=current_user.id,
        assigned_to_id=assigned_to_id,
        department_id=assigned_department_id or current_user.department_id,
        status=RequestStatus.PENDING_APPROVAL,
        priority=priority,
        form_data=form_data,
        request_type_snapshot={**request_type_config, "assigned_department_id": assigned_department_id, "workflow": workflow_steps},
        form_schema_snapshot=fields,
        business_justification=payload.business_justification,
        sla_due_at=sla_due_from_request_type_config(request_type_config),
    )
    db.add(service_request)
    db.flush()
    create_snapshot_steps_from_version(db, service_request, workflow_steps)
    if should_send_request_created_notification(db, payload.send_notification):
        create_request_created_message(db, service_request, current_user)
    write_audit(db, "dynamic_request_created", "service_request", actor=current_user, entity_id=str(service_request.id), metadata={"request_type_id": request_type.id})
    db.commit()
    return {"id": service_request.id, "request_number": service_request.request_number}
