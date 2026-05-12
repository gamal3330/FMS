from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse, StreamingResponse
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_user
from app.core.config import get_settings
from app.db.session import get_db
from app.models.audit import AuditLog
from app.models.enums import ApprovalAction, Priority, RequestStatus, RequestType, UserRole
from app.models.message import InternalMessage, InternalMessageRecipient
from app.models.request import ApprovalStep, Attachment, RequestApprovalStep, RequestComment, ServiceRequest
from app.models.settings import PortalSetting, RequestTypeField, RequestTypeSetting, SettingsGeneral, SpecializedSection
from app.models.user import Department, Role, ScreenPermission, User, UserDelegation
from app.schemas.message import InternalMessageRead
from app.schemas.request import ApprovalDecision, ApprovalStepRead, AttachmentRead, CommentCreate, ServiceRequestCreate, ServiceRequestRead, ServiceRequestUpdate
from app.services.audit import write_audit
from app.services.pdf_fonts import register_arabic_pdf_font, rtl_text
from app.services.pdf_template import (
    draw_cover_header,
    draw_field_box,
    draw_footer,
    draw_page_header,
    draw_section_header,
    format_pdf_datetime,
    pdf_theme,
)
from app.services.request_notifications import create_request_workflow_message
from app.services.messaging_settings_service import should_send_request_created_notification
from app.services.workflow import (
    DEPARTMENT_SPECIALIST_STEP,
    IMPLEMENTATION_STEP_ROLES,
    advance_workflow,
    create_approval_steps,
    next_request_number,
    reset_workflow_for_resubmission,
    step_can_reject,
    step_can_return_for_edit,
    user_can_act as workflow_user_can_act,
    workflow_snapshot_step,
)
from app.api.v1.request_type_management import (
    active_version_for_usage,
    create_snapshot_steps,
    create_snapshot_steps_from_version,
    form_schema_snapshot,
    request_type_has_active_workflow,
    request_type_snapshot,
    resolve_assigned_user_id,
    sla_due_from_request_type_config,
    validate_form_data,
    version_is_ready,
)
from app.api.v1.messages import can_access_message, load_message_settings, message_read

router = APIRouter(prefix="/requests", tags=["Service Requests"])
approvals_router = APIRouter(prefix="/approvals", tags=["Approvals"])
settings = get_settings()

STATUS_LABELS = {
    "draft": "مسودة",
    "submitted": "مرسل",
    "pending_approval": "بانتظار الموافقة",
    "approved": "معتمد",
    "rejected": "مرفوض",
    "in_implementation": "قيد التنفيذ",
    "completed": "مكتمل",
    "closed": "مغلق",
    "cancelled": "ملغي",
}
PRIORITY_LABELS = {"low": "منخفضة", "medium": "متوسطة", "high": "عالية", "critical": "حرجة"}
ACTION_LABELS = {"pending": "بانتظار الإجراء", "approved": "تمت الموافقة", "rejected": "تم الرفض", "returned_for_edit": "أعيد للتعديل", "skipped": "تم التجاوز"}
ROLE_LABELS = {
    "direct_manager": "المدير المباشر",
    "department_manager": "مدير الإدارة",
    "department_specialist": "مختص الإدارة",
    "specific_department_manager": "مدير إدارة",
    "information_security": "أمن المعلومات (مرحلة قديمة)",
    "administration_manager": "مدير إدارة",
    "it_staff": "مختص تنفيذ",
    "executive_management": "الإدارة التنفيذية",
    "implementation_engineer": "مختص تنفيذ",
    "implementation": "مختص تنفيذ",
    "execution": "مختص تنفيذ",
    "specific_role": "دور محدد",
    "specific_user": "مستخدم محدد",
}
MESSAGE_DEFAULT_ROLES = {
    UserRole.EMPLOYEE,
    UserRole.DIRECT_MANAGER,
    UserRole.IT_STAFF,
    UserRole.DEPARTMENT_MANAGER,
    UserRole.INFOSEC,
    UserRole.EXECUTIVE,
    UserRole.SUPER_ADMIN,
}

SCREEN_PERMISSION_ORDER = {
    "no_access": 0,
    "view": 1,
    "create": 2,
    "edit": 3,
    "delete": 4,
    "export": 5,
    "manage": 6,
}
FIELD_LABELS = {
    "source_ip": "عنوان المصدر",
    "destination_ip": "عنوان الوجهة",
    "destination_port": "منفذ الوجهة",
    "nat_port": "منفذ NAT",
    "asset_tag": "رقم الجهاز",
    "current_location": "الموقع الحالي",
    "new_location": "الموقع الجديد",
    "assigned_section": "القسم المختص",
    "administrative_section": "القسم المختص",
    "assigned_section_label": "القسم المختص",
    "administrative_section_label": "القسم المختص",
    "request_type_code": "رمز نوع الطلب",
    "request_type_label": "نوع الطلب",
    "reason": "المبرر",
    "issue_description": "وصف المشكلة",
}
PDF_HIDDEN_FORM_KEYS = {
    "request_type_code",
    "request_type_label",
    "assigned_section",
    "administrative_section",
    "assigned_section_label",
    "administrative_section_label",
}

ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "image/jpeg",
    "image/png",
    "image/webp",
}
SECTION_KEYWORDS = {
    "servers": ["server", "servers", "srv", "سيرفر", "خوادم"],
    "networks": ["network", "networks", "net", "شبكة", "شبكات"],
    "support": ["support", "helpdesk", "دعم", "فني"],
    "development": ["development", "software", "dev", "تطوير", "برامج"],
}


def user_administrative_section(user: User) -> str | None:
    if user.administrative_section:
        return user.administrative_section
    department = user.department
    if not department:
        return None
    text = f"{department.name_ar or ''} {department.name_en or ''} {department.code or ''}".lower()
    for section, keywords in SECTION_KEYWORDS.items():
        if any(keyword.lower() in text for keyword in keywords):
            return section
    return None


def request_matches_it_staff_section(service_request: ServiceRequest, user: User) -> bool:
    form_data = service_request.form_data or {}
    request_section = form_data.get("assigned_section") or form_data.get("administrative_section")
    staff_section = user_administrative_section(user)
    return bool(staff_section and request_section == staff_section)


def unassigned_it_staff_can_cover_request(db: Session, service_request: ServiceRequest, user: User) -> bool:
    if user.role != UserRole.IT_STAFF or user_administrative_section(user):
        return False
    form_data = service_request.form_data or {}
    request_section = form_data.get("assigned_section") or form_data.get("administrative_section")
    if not request_section:
        return False
    section_staff_count = db.scalar(
        select(func.count())
        .select_from(User)
        .where(User.role == UserRole.IT_STAFF, User.is_active == True, User.administrative_section == request_section)
    ) or 0
    return section_staff_count == 0


def active_approval_delegators(db: Session, user: User) -> list[User]:
    now = datetime.now(timezone.utc)
    return db.scalars(
        select(User)
        .join(UserDelegation, UserDelegation.delegator_user_id == User.id)
        .where(
            UserDelegation.delegate_user_id == user.id,
            UserDelegation.is_active == True,
            UserDelegation.delegation_scope.in_(["approvals_only", "all_allowed_actions"]),
            UserDelegation.start_date <= now,
            UserDelegation.end_date >= now,
            User.is_active == True,
        )
    ).all()


def delegated_approval_filter(db: Session, current_user: User):
    delegators = active_approval_delegators(db, current_user)
    if not delegators:
        return None
    filters = []
    direct_manager_ids = [user.id for user in delegators if user.role == UserRole.DIRECT_MANAGER]
    if direct_manager_ids:
        team_members = select(User.id).where(User.manager_id.in_(direct_manager_ids))
        direct_manager_pending = select(ApprovalStep.request_id).where(ApprovalStep.role == UserRole.DIRECT_MANAGER, ApprovalStep.action == ApprovalAction.PENDING)
        filters.append(and_(ServiceRequest.requester_id.in_(team_members), ServiceRequest.id.in_(direct_manager_pending)))
    department_manager_ids = [user.id for user in delegators if user.role == UserRole.DEPARTMENT_MANAGER]
    if department_manager_ids:
        managed_departments = select(Department.id).where(Department.manager_id.in_(department_manager_ids), Department.is_active == True)
        manager_pending = select(ApprovalStep.request_id).where(ApprovalStep.role == UserRole.DEPARTMENT_MANAGER, ApprovalStep.action == ApprovalAction.PENDING)
        filters.append(and_(ServiceRequest.department_id.in_(managed_departments), ServiceRequest.id.in_(manager_pending)))
    delegated_roles = [user.role for user in delegators if user.role not in {UserRole.DIRECT_MANAGER, UserRole.DEPARTMENT_MANAGER}]
    if delegated_roles:
        delegated_pending = select(ApprovalStep.request_id).where(ApprovalStep.role.in_(delegated_roles), ApprovalStep.action == ApprovalAction.PENDING)
        filters.append(ServiceRequest.id.in_(delegated_pending))
    return or_(*filters) if filters else None


def approval_visibility_conditions(db: Session, current_user: User, *, include_role: bool = True):
    conditions = []
    if include_role and current_user.role != UserRole.DEPARTMENT_MANAGER:
        role_pending = select(ApprovalStep.request_id).where(ApprovalStep.role == str(current_user.role))
        conditions.append(ServiceRequest.id.in_(role_pending))

    specific_user_requests = select(RequestApprovalStep.request_id).where(RequestApprovalStep.approver_user_id == current_user.id)
    conditions.append(ServiceRequest.id.in_(specific_user_requests))

    if current_user.role_id:
        specific_role_requests = select(RequestApprovalStep.request_id).where(RequestApprovalStep.approver_role_id == current_user.role_id)
        if current_user.role == UserRole.DEPARTMENT_MANAGER:
            managed_departments = select(Department.id).where(Department.manager_id == current_user.id, Department.is_active == True)
            conditions.append(and_(ServiceRequest.department_id.in_(managed_departments), ServiceRequest.id.in_(specific_role_requests)))
        else:
            conditions.append(ServiceRequest.id.in_(specific_role_requests))

    managed_departments = select(Department.id).where(Department.manager_id == current_user.id, Department.is_active == True)
    department_manager_requests = select(ApprovalStep.request_id).where(ApprovalStep.role == "department_manager")
    conditions.append(and_(ServiceRequest.department_id.in_(managed_departments), ServiceRequest.id.in_(department_manager_requests)))

    if current_user.department_id:
        department_specialist_requests = select(ApprovalStep.request_id).where(ApprovalStep.role == DEPARTMENT_SPECIALIST_STEP)
        conditions.append(and_(ServiceRequest.department_id == current_user.department_id, ServiceRequest.id.in_(department_specialist_requests)))

    return conditions


def user_has_messages_screen(db: Session, user: User) -> bool:
    setting = db.scalar(select(PortalSetting).where(PortalSetting.category == "screen_permissions", PortalSetting.setting_key == str(user.id)))
    if not setting:
        return user.role in MESSAGE_DEFAULT_ROLES
    value = setting.setting_value if isinstance(setting.setting_value, dict) else {}
    screens = value.get("screens", [])
    if not isinstance(screens, list):
        return False
    if "messages_permission_initialized" not in value and user.role in MESSAGE_DEFAULT_ROLES:
        return True
    return "messages" in screens


def first_request_notification_recipients(db: Session, service_request: ServiceRequest, actor: User) -> list[User]:
    first_snapshot = next((step for step in sorted(service_request.approval_snapshots or [], key=lambda item: item.sort_order) if step.status == "pending"), None)
    if not first_snapshot:
        first_snapshot = db.scalar(
            select(RequestApprovalStep)
            .where(RequestApprovalStep.request_id == service_request.id, RequestApprovalStep.status == "pending")
            .order_by(RequestApprovalStep.sort_order)
            .limit(1)
        )
    first_approval = next((step for step in sorted(service_request.approvals or [], key=lambda item: item.step_order) if step.action == ApprovalAction.PENDING), None)
    if not first_approval:
        first_approval = db.scalar(
            select(ApprovalStep)
            .where(ApprovalStep.request_id == service_request.id, ApprovalStep.action == ApprovalAction.PENDING)
            .order_by(ApprovalStep.step_order)
            .limit(1)
        )
    recipient_ids: set[int] = set()

    if first_snapshot and first_snapshot.approver_user_id:
        recipient_ids.add(first_snapshot.approver_user_id)

    role_value = str(first_snapshot.step_type if first_snapshot else first_approval.role if first_approval else "")
    if role_value == UserRole.DIRECT_MANAGER.value:
        manager_id = actor.manager_id or (service_request.requester.manager_id if service_request.requester else None)
        if manager_id:
            recipient_ids.add(manager_id)
    elif role_value == "department_manager":
        department = service_request.department or (db.get(Department, service_request.department_id) if service_request.department_id else None)
        if department and department.manager_id:
            recipient_ids.add(department.manager_id)
    elif role_value == DEPARTMENT_SPECIALIST_STEP:
        department = service_request.department or (db.get(Department, service_request.department_id) if service_request.department_id else None)
        if department:
            stmt = select(User).where(User.is_active == True, User.department_id == department.id)
            if department.manager_id:
                stmt = stmt.where(User.id != department.manager_id)
            recipient_ids.update(user.id for user in db.scalars(stmt).all())
    elif role_value == "specific_role" and first_snapshot and first_snapshot.approver_role_id:
        role = db.get(Role, first_snapshot.approver_role_id)
        if role and role.code == UserRole.DEPARTMENT_MANAGER.value:
            department = service_request.department or (db.get(Department, service_request.department_id) if service_request.department_id else None)
            if department and department.manager_id:
                recipient_ids.add(department.manager_id)
        elif role and role.code:
            stmt = select(User).where(User.is_active == True, or_(User.role_id == role.id, User.role == role.code))
            recipient_ids.update(user.id for user in db.scalars(stmt).all())
        else:
            stmt = select(User).where(User.is_active == True)
            stmt = stmt.where(User.role_id == first_snapshot.approver_role_id)
            recipient_ids.update(user.id for user in db.scalars(stmt).all())
    elif role_value in {"specific_user", "specific_role"}:
        pass
    elif role_value in IMPLEMENTATION_STEP_ROLES:
        form_data = service_request.form_data or {}
        request_section = form_data.get("assigned_section") or form_data.get("administrative_section")
        stmt = select(User).where(User.is_active == True, User.role == UserRole.IT_STAFF)
        if request_section:
            stmt = stmt.where(User.administrative_section == request_section)
        recipient_ids.update(user.id for user in db.scalars(stmt).all())
    elif role_value:
        try:
            role = UserRole(role_value)
            recipient_ids.update(user.id for user in db.scalars(select(User).where(User.is_active == True, User.role == role)).all())
        except ValueError:
            pass

    if not recipient_ids and actor.manager_id:
        recipient_ids.add(actor.manager_id)

    recipient_ids.discard(actor.id)
    if not recipient_ids:
        return []
    users = db.scalars(select(User).where(User.id.in_(sorted(recipient_ids)), User.is_active == True)).all()
    return [user for user in users if user_has_messages_screen(db, user)]


def create_request_created_message(db: Session, service_request: ServiceRequest, actor: User) -> None:
    existing = db.scalar(
        select(InternalMessage.id)
        .where(
            InternalMessage.related_request_id == service_request.id,
            InternalMessage.message_type == "notification",
            InternalMessage.subject == f"إشعار بطلب جديد: {service_request.request_number}",
        )
        .limit(1)
    )
    if existing:
        return
    recipients = first_request_notification_recipients(db, service_request, actor)
    if not recipients:
        return
    form_data = service_request.form_data or {}
    request_type_label = form_data.get("request_type_label") or str(service_request.request_type)
    priority = PRIORITY_LABELS.get(str(service_request.priority), str(service_request.priority or "-"))
    status_label = STATUS_LABELS.get(str(service_request.status), str(service_request.status or "-"))
    body = "\n".join(
        [
            "تم إنشاء طلب جديد ويحتاج إلى المتابعة.",
            "",
            f"رقم الطلب: {service_request.request_number}",
            f"عنوان الطلب: {service_request.title}",
            f"نوع الطلب: {request_type_label}",
            f"الأولوية: {priority}",
            f"الحالة: {status_label}",
            f"مقدم الطلب: {actor.full_name_ar or actor.email}",
            "",
            f"مبرر الطلب: {service_request.business_justification or '-'}",
        ]
    )
    message = InternalMessage(
        sender_id=actor.id,
        message_type="notification",
        subject=f"إشعار بطلب جديد: {service_request.request_number}",
        body=body,
        related_request_id=service_request.id,
    )
    db.add(message)
    db.flush()
    message.thread_id = message.id
    for recipient in recipients:
        db.add(InternalMessageRecipient(message_id=message.id, recipient_id=recipient.id))


def request_query():
    return select(ServiceRequest).options(
        selectinload(ServiceRequest.requester).selectinload(User.department),
        selectinload(ServiceRequest.assigned_to),
        selectinload(ServiceRequest.department),
        selectinload(ServiceRequest.approvals).selectinload(ApprovalStep.approver),
        selectinload(ServiceRequest.comments),
        selectinload(ServiceRequest.attachments),
    )


def requests_screen_level(db: Session, user: User) -> str:
    if user.role == UserRole.SUPER_ADMIN:
        return "manage"

    user_permission = db.scalar(
        select(ScreenPermission).where(
            ScreenPermission.user_id == user.id,
            ScreenPermission.role_id.is_(None),
            ScreenPermission.screen_code == "requests",
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
                ScreenPermission.screen_code == "requests",
            )
        )
        if role_permission:
            return role_permission.permission_level or "no_access"

    setting = db.scalar(select(PortalSetting).where(PortalSetting.category == "screen_permissions", PortalSetting.setting_key == str(user.id)))
    if setting and isinstance(setting.setting_value, dict) and "requests" in setting.setting_value.get("screens", []):
        return "view"
    return "no_access"


def can_view_all_requests(db: Session | None, user: User) -> bool:
    if user.role == UserRole.SUPER_ADMIN:
        return True
    if not db:
        return False
    return SCREEN_PERMISSION_ORDER.get(requests_screen_level(db, user), 0) >= SCREEN_PERMISSION_ORDER["manage"]


def ensure_request_access(service_request: ServiceRequest, current_user: User, db: Session | None = None) -> None:
    if can_view_all_requests(db, current_user):
        return
    if service_request.requester_id == current_user.id:
        return
    if current_user.role == UserRole.DIRECT_MANAGER and service_request.requester and service_request.requester.manager_id == current_user.id:
        return
    if current_user.role == UserRole.DEPARTMENT_MANAGER and service_request.department and service_request.department.manager_id == current_user.id:
        return
    if db:
        pending_step = next((step for step in sorted(service_request.approvals or [], key=lambda item: item.step_order) if step.action == ApprovalAction.PENDING), None)
        if pending_step and workflow_user_can_act(db, service_request, current_user, pending_step):
            return
    if current_user.role not in {UserRole.IT_STAFF, UserRole.DEPARTMENT_MANAGER} and any(step.role == current_user.role for step in service_request.approvals):
        return
    if current_user.role == UserRole.IT_STAFF and any(step.role in IMPLEMENTATION_STEP_ROLES for step in service_request.approvals):
        if request_matches_it_staff_section(service_request, current_user) or (db and unassigned_it_staff_can_cover_request(db, service_request, current_user)):
            return
    if current_user.role == UserRole.IT_STAFF and any(step.role == UserRole.IT_STAFF for step in service_request.approvals):
        if request_matches_it_staff_section(service_request, current_user):
            return
    if db:
        pending_step = next((step for step in sorted(service_request.approvals or [], key=lambda item: item.step_order) if step.action == ApprovalAction.PENDING), None)
        if pending_step:
            for delegator in active_approval_delegators(db, current_user):
                if str(pending_step.role) != str(delegator.role):
                    continue
                if delegator.role == UserRole.DIRECT_MANAGER:
                    if service_request.requester and service_request.requester.manager_id == delegator.id:
                        return
                else:
                    return
    raise HTTPException(status_code=403, detail="Insufficient permissions")


def can_view_request_linked_message(message: InternalMessage, service_request: ServiceRequest, current_user: User, message_settings: dict) -> bool:
    if can_access_message(message, current_user):
        return True
    if service_request.requester_id == current_user.id:
        return bool(message_settings.get("allow_request_owner_to_view_messages", False))
    if current_user.role == UserRole.SUPER_ADMIN:
        return bool(message_settings.get("allow_approvers_to_view_request_messages", True))
    if current_user.role == UserRole.DIRECT_MANAGER and service_request.requester and service_request.requester.manager_id == current_user.id:
        return bool(message_settings.get("allow_approvers_to_view_request_messages", True))
    if current_user.role != UserRole.DEPARTMENT_MANAGER and any(step.role == current_user.role for step in service_request.approvals or []):
        return bool(message_settings.get("allow_approvers_to_view_request_messages", True))
    approval_roles = {str(step.role) for step in service_request.approvals or []}
    if UserRole.DEPARTMENT_MANAGER.value in approval_roles and service_request.department and service_request.department.manager_id == current_user.id:
        return bool(message_settings.get("allow_approvers_to_view_request_messages", True))
    if "department_manager" in approval_roles and service_request.department and service_request.department.manager_id == current_user.id:
        return bool(message_settings.get("allow_approvers_to_view_request_messages", True))
    if DEPARTMENT_SPECIALIST_STEP in approval_roles and service_request.department_id and current_user.department_id == service_request.department_id:
        return bool(message_settings.get("allow_approvers_to_view_request_messages", True))
    return False


def _workflow_section_name(db: Session, service_request: ServiceRequest) -> str:
    form_data = service_request.form_data or {}
    snapshot = service_request.request_type_snapshot or {}
    section_code = form_data.get("assigned_section") or form_data.get("administrative_section") or snapshot.get("assigned_section")
    section_label = (
        form_data.get("assigned_section_label")
        or form_data.get("administrative_section_label")
        or snapshot.get("specialized_section_name")
        or snapshot.get("assigned_section_label")
    )
    if section_label:
        return str(section_label)
    if section_code:
        section = db.scalar(select(SpecializedSection).where(SpecializedSection.code == str(section_code)))
        if section:
            return section.name_ar
    return ""


def _workflow_department_name(db: Session, service_request: ServiceRequest) -> str:
    form_data = service_request.form_data or {}
    snapshot = service_request.request_type_snapshot or {}
    department_name = form_data.get("assigned_department_name") or snapshot.get("assigned_department_name")
    if department_name:
        return str(department_name)
    department_id = form_data.get("assigned_department_id") or snapshot.get("assigned_department_id")
    if department_id:
        try:
            department = db.get(Department, int(department_id))
        except (TypeError, ValueError):
            department = None
        if department:
            return department.name_ar
    section_code = form_data.get("assigned_section") or form_data.get("administrative_section") or snapshot.get("assigned_section")
    if section_code:
        section = db.scalar(select(SpecializedSection).where(SpecializedSection.code == str(section_code)))
        if section and section.department_id:
            department = db.get(Department, section.department_id)
            if department:
                return department.name_ar
    if service_request.department:
        return service_request.department.name_ar
    return _workflow_section_name(db, service_request)


def _target_department_name(db: Session, target_department_id: object) -> str:
    if not target_department_id:
        return ""
    try:
        department = db.get(Department, int(target_department_id))
    except (TypeError, ValueError):
        return ""
    return department.name_ar if department else ""


def _target_department_display_name(db: Session, snapshot_step: dict) -> str:
    target_name = snapshot_step.get("target_department_name")
    if target_name:
        return str(target_name)
    return _target_department_name(db, snapshot_step.get("target_department_id"))


def _target_role_name(db: Session, role_id: object) -> str:
    if not role_id:
        return ""
    try:
        role = db.get(Role, int(role_id))
    except (TypeError, ValueError):
        return ""
    return role.name_ar if role else ""


def _target_user_name(db: Session, user_id: object) -> str:
    if not user_id:
        return ""
    try:
        user = db.get(User, int(user_id))
    except (TypeError, ValueError):
        return ""
    return user.full_name_ar if user else ""


def approval_step_display_label(db: Session, service_request: ServiceRequest, step: ApprovalStep) -> str:
    role_value = str(step.role or "")
    snapshot_step = workflow_snapshot_step(service_request, step) or {}
    department_name = _workflow_department_name(db, service_request)
    section_name = _workflow_section_name(db, service_request)

    if role_value == UserRole.DIRECT_MANAGER.value:
        return "المدير المباشر"
    if role_value == "department_manager":
        return f"مدير {department_name}" if department_name else ROLE_LABELS[role_value]
    if role_value == DEPARTMENT_SPECIALIST_STEP:
        return f"مختص {section_name or department_name}" if (section_name or department_name) else ROLE_LABELS[role_value]
    if role_value in IMPLEMENTATION_STEP_ROLES:
        return f"مختص {section_name or department_name}" if (section_name or department_name) else ROLE_LABELS.get(role_value, "مختص تنفيذ")
    if role_value == "specific_department_manager":
        target_name = _target_department_display_name(db, snapshot_step)
        return f"مدير {target_name}" if target_name else ROLE_LABELS[role_value]
    if role_value == "specific_role":
        role_name = _target_role_name(db, snapshot_step.get("approver_role_id"))
        return role_name or ROLE_LABELS[role_value]
    if role_value == "specific_user":
        user_name = _target_user_name(db, snapshot_step.get("approver_user_id"))
        return user_name or ROLE_LABELS[role_value]
    if role_value == UserRole.DEPARTMENT_MANAGER.value:
        return f"مدير {department_name}" if department_name else ROLE_LABELS.get(role_value, "مدير إدارة")
    if role_value == UserRole.IT_STAFF.value:
        return f"مختص {section_name or department_name}" if (section_name or department_name) else ROLE_LABELS.get(role_value, "مختص تنفيذ")
    return ROLE_LABELS.get(role_value, role_value or "مرحلة موافقة")


def enrich_approval_steps(db: Session, service_request: ServiceRequest | None, current_user: User | None = None) -> ServiceRequest | None:
    if not service_request:
        return service_request
    for step in service_request.approvals or []:
        step.can_reject = step.action == ApprovalAction.PENDING and step_can_reject(db, service_request, step)
        step.can_return_for_edit = step.action == ApprovalAction.PENDING and step_can_return_for_edit(db, service_request, step)
        step.can_act = bool(current_user and step.action == ApprovalAction.PENDING and workflow_user_can_act(db, service_request, current_user, step))
        step.display_label = approval_step_display_label(db, service_request, step)
    return service_request


def enrich_request_list(db: Session, requests: list[ServiceRequest], current_user: User | None = None) -> list[ServiceRequest]:
    for service_request in requests:
        enrich_approval_steps(db, service_request, current_user)
    return requests


def request_status_history(service_request: ServiceRequest) -> list[dict]:
    rows: list[dict] = [
        {
            "event": "created",
            "label": "تم إنشاء الطلب",
            "status": str(service_request.status),
            "actor_name": service_request.requester.full_name_ar if service_request.requester else None,
            "changed_at": service_request.created_at,
            "comment": service_request.business_justification,
        }
    ]
    for step in sorted(service_request.approvals or [], key=lambda item: item.step_order):
        if step.action == ApprovalAction.PENDING and not step.acted_at:
            rows.append(
                {
                    "event": "pending",
                    "label": f"بانتظار {ROLE_LABELS.get(str(step.role), str(step.role))}",
                    "status": "pending",
                    "actor_name": None,
                    "changed_at": None,
                    "comment": None,
                }
            )
            continue
        rows.append(
            {
                "event": str(step.action),
                "label": f"{ROLE_LABELS.get(str(step.role), str(step.role))}: {ACTION_LABELS.get(str(step.action), str(step.action))}",
                "status": str(step.action),
                "actor_name": step.approver.full_name_ar if step.approver else None,
                "changed_at": step.acted_at,
                "comment": step.note,
            }
        )
    return rows


def attachment_rules_from_snapshot(snapshot: dict, request_type_record: RequestTypeSetting | None = None) -> dict:
    requires_attachment = (
        bool(snapshot.get("requires_attachment"))
        if "requires_attachment" in snapshot
        else bool(request_type_record.requires_attachment) if request_type_record else False
    )
    allow_multiple = (
        bool(snapshot.get("allow_multiple_attachments"))
        if "allow_multiple_attachments" in snapshot
        else bool(request_type_record.allow_multiple_attachments) if request_type_record else False
    )
    attachments_enabled = requires_attachment or allow_multiple
    max_attachments = snapshot.get("max_attachments") or (request_type_record.max_attachments if request_type_record else None) or (5 if allow_multiple else 1)
    max_file_size_mb = snapshot.get("max_file_size_mb") or (request_type_record.max_file_size_mb if request_type_record else None) or 10
    allowed_extensions = snapshot.get("allowed_extensions_json") or (request_type_record.allowed_extensions_json if request_type_record else None) or ["pdf", "png", "jpg", "jpeg"]
    allowed_extensions = sorted({str(item).strip().lower().lstrip(".") for item in allowed_extensions if str(item).strip()})
    return {
        "attachments_enabled": attachments_enabled,
        "requires_attachment": requires_attachment,
        "allow_multiple_attachments": allow_multiple,
        "max_attachments": int(max_attachments),
        "max_file_size_mb": int(max_file_size_mb),
        "allowed_extensions": allowed_extensions,
    }


def attachment_extension(filename: str | None) -> str:
    return Path(filename or "").suffix.lower().lstrip(".")


def register_pdf_font() -> str:
    return register_arabic_pdf_font()


def rtl(text: object) -> str:
    return rtl_text(text)


def label(value: object, labels: dict[str, str]) -> str:
    return labels.get(str(value or ""), str(value or ""))


def pdf_form_pairs(form_data: dict) -> list[tuple[str, object]]:
    pairs: list[tuple[str, object]] = []
    seen_labels = {"نوع الطلب", "القسم المختص"}
    for key, value in form_data.items():
        if key in PDF_HIDDEN_FORM_KEYS or value in (None, ""):
            continue
        field_label = FIELD_LABELS.get(key, key.replace("_", " "))
        if field_label in seen_labels:
            continue
        seen_labels.add(field_label)
        pairs.append((field_label, value))
    return pairs


class RequestPdfBuilder:
    def __init__(self, service_request: ServiceRequest, actor: User, db: Session):
        self.request = service_request
        self.actor = actor
        self.db = db
        self.general = db.scalar(select(SettingsGeneral).limit(1))
        self.stream = BytesIO()
        self.pdf = canvas.Canvas(self.stream, pagesize=A4)
        self.font = register_pdf_font()
        self.theme = pdf_theme(self.general)
        self.tz = self.theme.timezone
        self.width, self.height = A4
        self.left = 36
        self.right = self.width - 36
        self.content_width = self.right - self.left
        self.brand_dark = self.theme.brand_dark
        self.brand_soft = self.theme.brand_soft
        self.y = self.height - 36
        self.pdf.setTitle(f"Request {service_request.request_number}")

    def page_break(self, needed: int = 70) -> None:
        if self.y < needed:
            self.footer()
            self.pdf.showPage()
            self.y = self.height - 36
            self.page_header()

    def text(self, value: object, x: float, y: float, size: int = 11) -> None:
        self.pdf.setFont(self.font, size)
        self.pdf.drawRightString(x, y, rtl(value))

    def centered_text(self, value: object, x: float, y: float, size: int = 10) -> None:
        self.pdf.setFont(self.font, size)
        self.pdf.drawCentredString(x, y, rtl(value))

    def muted_text(self, value: object, x: float, y: float, size: int = 10) -> None:
        self.pdf.setFillColorRGB(0.36, 0.42, 0.48)
        self.text(value, x, y, size)
        self.pdf.setFillColorRGB(0, 0, 0)

    def summary_item(self, title: str, value: object, x: float, y: float, width: float, value_size: int = 12) -> None:
        self.pdf.setFillColorRGB(0.45, 0.5, 0.58)
        self.text(title, x + width - 12, y - 24, 9)
        self.pdf.setFillColorRGB(0.06, 0.09, 0.16)
        self.text(str(value or "-")[:38], x + width - 12, y - 50, value_size)
        self.pdf.setFillColorRGB(0, 0, 0)

    def wrapped(self, value: object, x: float, y: float, max_chars: int = 78, size: int = 11, leading: int = 16, color: tuple[float, float, float] = (0.08, 0.12, 0.18)) -> float:
        words = str(value or "-").split()
        lines: list[str] = []
        current = ""
        for word in words:
            candidate = f"{current} {word}".strip()
            if len(candidate) > max_chars and current:
                lines.append(current)
                current = word
            else:
                current = candidate
        if current:
            lines.append(current)
        self.pdf.setFillColorRGB(*color)
        for line in lines or ["-"]:
            self.page_break(55)
            self.text(line, x, y, size)
            y -= leading
        self.pdf.setFillColorRGB(0, 0, 0)
        return y

    def page_header(self) -> None:
        self.y = draw_page_header(self.pdf, self.theme, self.font, str(self.request.request_number or ""))

    def footer(self) -> None:
        draw_footer(self.pdf, self.font, f"طُبع بواسطة: {self.actor.full_name_ar or self.actor.email}", self.left, self.right)

    def status_pill(self, value: str, x: float, y: float, width: float = 86) -> None:
        status = str(self.request.status or "")
        if status in {"rejected", "cancelled"}:
            fill = (0.99, 0.9, 0.9)
            text_color = (0.72, 0.11, 0.11)
        elif status in {"completed", "closed", "approved"}:
            fill = self.brand_soft
            text_color = self.brand_dark
        elif status in {"pending_approval", "in_implementation"}:
            fill = (1.0, 0.96, 0.82)
            text_color = (0.62, 0.36, 0.02)
        else:
            fill = (0.94, 0.96, 0.98)
            text_color = (0.24, 0.3, 0.38)
        self.pdf.setFillColorRGB(*fill)
        self.pdf.roundRect(x - width, y - 13, width, 24, 10, fill=1, stroke=0)
        self.pdf.setFillColorRGB(*text_color)
        self.centered_text(value, x - (width / 2), y - 4, 9)
        self.pdf.setFillColorRGB(0, 0, 0)

    def centered_muted_text(self, value: object, x: float, y: float, size: int = 8) -> None:
        self.pdf.setFillColorRGB(0.45, 0.5, 0.58)
        self.centered_text(value, x, y, size)
        self.pdf.setFillColorRGB(0, 0, 0)

    def centered_lines(self, value: object, x: float, y: float, max_chars: int = 14, max_lines: int = 2, size: int = 8, leading: int = 10, color: tuple[float, float, float] = (0.06, 0.09, 0.16)) -> int:
        words = str(value or "-").split()
        lines: list[str] = []
        current = ""
        for word in words:
            candidate = f"{current} {word}".strip()
            if len(candidate) > max_chars and current:
                lines.append(current)
                current = word
            else:
                current = candidate
        if current:
            lines.append(current)
        if len(lines) > max_lines:
            lines = lines[:max_lines]
            lines[-1] = f"{lines[-1][:max_chars - 1]}…"

        self.pdf.setFillColorRGB(*color)
        for index, line in enumerate(lines or ["-"]):
            self.centered_text(line, x, y - (index * leading), size)
        self.pdf.setFillColorRGB(0, 0, 0)
        return len(lines or ["-"])

    def header(self) -> None:
        form_data = self.request.form_data or {}
        request_type_title = form_data.get("request_type_label") or self.request.request_type or "طلب خدمة"
        printed_at = format_pdf_datetime(datetime.now(timezone.utc), self.tz)
        self.y = draw_cover_header(self.pdf, self.theme, self.font, f"نموذج {request_type_title}", f"تاريخ الطباعة: {printed_at}")
        self.pdf.setFillColorRGB(1, 1, 1)
        self.pdf.setStrokeColorRGB(0.88, 0.91, 0.94)
        self.pdf.roundRect(self.left, self.y - 80, self.content_width, 80, 7, fill=1, stroke=1)

        status_width = 124
        gap = 12
        item_width = (self.content_width - status_width - (gap * 2)) / 2
        number_x = self.right - item_width
        title_x = number_x - gap - item_width
        status_x = self.left

        self.summary_item("رقم الطلب", self.request.request_number, number_x, self.y, item_width, 15)
        self.summary_item("عنوان الطلب", self.request.title, title_x, self.y, item_width, 12)

        self.pdf.setStrokeColorRGB(0.9, 0.92, 0.95)
        self.pdf.line(title_x - (gap / 2), self.y - 64, title_x - (gap / 2), self.y - 16)
        self.pdf.line(number_x - (gap / 2), self.y - 64, number_x - (gap / 2), self.y - 16)

        self.centered_muted_text("الحالة", status_x + (status_width / 2), self.y - 24, 9)
        self.status_pill(label(self.request.status, STATUS_LABELS), status_x + status_width - 16, self.y - 52, 102)
        self.y -= 104

    def section(self, title: str) -> None:
        self.page_break(90)
        self.y = draw_section_header(self.pdf, self.theme, self.font, title, self.left, self.right, self.y)

    def pair(self, key: str, value: object) -> None:
        self.page_break(72)
        self.field_box(key, value, self.left, self.y, self.content_width)
        self.y -= 64

    def pairs(self, values: list[tuple[str, object]]) -> None:
        index = 0
        while index < len(values):
            first = values[index]
            second = values[index + 1] if index + 1 < len(values) else None
            self.page_break(72)
            row_top = self.y
            if second:
                gap = 12
                box_width = (self.content_width - gap) / 2
                self.field_box(first[0], first[1], self.right - box_width, row_top, box_width)
                self.field_box(second[0], second[1], self.left, row_top, box_width)
            else:
                self.field_box(first[0], first[1], self.left, row_top, self.content_width)
            self.y -= 64
            index += 2

    def field_box(self, key: str, value: object, x: float, y: float, width: float) -> None:
        draw_field_box(self.pdf, self.font, key, value, x, y, width)

    def note_box(self, title: str, value: object) -> None:
        self.page_break(110)
        self.pdf.setFillColorRGB(0.98, 0.99, 1)
        self.pdf.setStrokeColorRGB(0.88, 0.91, 0.94)
        self.pdf.roundRect(self.left, self.y - 92, self.content_width, 92, 6, fill=1, stroke=1)
        self.pdf.setFillColorRGB(*self.brand_dark)
        self.text(title, self.right - 14, self.y - 20, 11)
        self.y = self.wrapped(value, self.right - 14, self.y - 42, max_chars=86, size=10, leading=14)
        self.y -= 18

    def build(self) -> BytesIO:
        self.header()
        steps = sorted(self.request.approvals or [], key=lambda step: step.step_order)

        self.section("بيانات الطلب")
        form_data = self.request.form_data or {}
        values = [
            ("رقم الطلب", self.request.request_number),
            ("العنوان", self.request.title),
            ("مقدم الطلب", self.request.requester.full_name_ar if self.request.requester else "-"),
            ("الإدارة", self.request.department.name_ar if self.request.department else "-"),
            ("نوع الطلب", form_data.get("request_type_label") or self.request.request_type),
            ("الحالة", label(self.request.status, STATUS_LABELS)),
            ("الأولوية", label(self.request.priority, PRIORITY_LABELS)),
            ("تاريخ الإنشاء", format_pdf_datetime(self.request.created_at, self.tz)),
            ("القسم المختص", form_data.get("assigned_section_label") or form_data.get("administrative_section_label") or form_data.get("assigned_section") or "-"),
        ]
        values.extend(pdf_form_pairs(form_data))
        self.pairs(values)

        self.page_break(225)
        self.section("مسار الموافقات")
        self.draw_approval_circles(steps)
        self.note_box("مبرر العمل", self.request.business_justification or "لا يوجد مبرر مسجل.")

        self.footer()
        self.pdf.save()
        self.stream.seek(0)
        return self.stream

    def draw_approval_circles(self, steps: list[ApprovalStep]) -> None:
        self.page_break(175)
        if not steps:
            self.text("لا يوجد مسار موافقات مسجل.", self.right, self.y, 11)
            self.y -= 24
            return

        count = len(steps)
        start_x = self.right - 32
        end_x = self.left + 32
        gap = 0 if count == 1 else (start_x - end_x) / (count - 1)
        circle_y = self.y - 20

        if count > 1:
            self.pdf.setStrokeColorRGB(0.82, 0.86, 0.9)
            self.pdf.setLineWidth(2)
            self.pdf.line(end_x, circle_y, start_x, circle_y)

        for index, step in enumerate(steps):
            x = start_x - (gap * index)
            if step.action == ApprovalAction.APPROVED:
                fill = (0.05, 0.45, 0.26)
                text_color = (1, 1, 1)
                marker = "✓"
            elif step.action == ApprovalAction.REJECTED:
                fill = (0.76, 0.12, 0.16)
                text_color = (1, 1, 1)
                marker = "×"
            elif step.action == ApprovalAction.SKIPPED:
                fill = (0.58, 0.64, 0.72)
                text_color = (1, 1, 1)
                marker = "-"
            else:
                fill = (0.95, 0.97, 0.99)
                text_color = (0.18, 0.24, 0.32)
                marker = str(step.step_order)

            self.pdf.setFillColorRGB(*fill)
            self.pdf.setStrokeColorRGB(0.82, 0.86, 0.9)
            self.pdf.circle(x, circle_y, 14, fill=1, stroke=1)
            self.pdf.setFillColorRGB(*text_color)
            self.pdf.setFont(self.font, 10)
            self.pdf.drawCentredString(x, circle_y - 4, rtl(marker))
            self.pdf.setFillColorRGB(0, 0, 0)

            role = label(step.role, ROLE_LABELS)
            role_line_count = self.centered_lines(role, x, circle_y - 31, max_chars=16, max_lines=2, size=8, leading=10)
            action_y = circle_y - 45 - ((role_line_count - 1) * 10)
            self.centered_lines(label(step.action, ACTION_LABELS), x, action_y, max_chars=18, max_lines=1, size=7, color=(0.36, 0.42, 0.48))
            if step.acted_at or step.approver:
                approver_name = "-"
                if step.approver:
                    approver_name = step.approver.full_name_ar or step.approver.email or "-"
                self.centered_lines(f"بواسطة: {approver_name}", x, action_y - 14, max_chars=22, max_lines=1, size=6, color=(0.36, 0.42, 0.48))
                self.centered_lines(f"في: {format_pdf_datetime(step.acted_at, self.tz)}", x, action_y - 26, max_chars=22, max_lines=1, size=6, color=(0.36, 0.42, 0.48))

        self.y -= 120


def scoped_requests_stmt(stmt, current_user: User, db: Session | None = None):
    if can_view_all_requests(db, current_user):
        return stmt

    own_request = ServiceRequest.requester_id == current_user.id
    delegated_filter = delegated_approval_filter(db, current_user) if db else None
    dynamic_conditions = approval_visibility_conditions(db, current_user, include_role=current_user.role not in {UserRole.IT_STAFF, UserRole.DEPARTMENT_MANAGER}) if db else []

    if current_user.role == UserRole.EMPLOYEE:
        conditions = [own_request, *dynamic_conditions]
        if delegated_filter is not None:
            conditions.append(delegated_filter)
        return stmt.where(or_(*conditions))

    if current_user.role == UserRole.DIRECT_MANAGER:
        team_members = select(User.id).where(User.manager_id == current_user.id)
        conditions = [own_request, ServiceRequest.requester_id.in_(team_members), *dynamic_conditions]
        if delegated_filter is not None:
            conditions.append(delegated_filter)
        return stmt.where(or_(*conditions))

    approval_requests = select(ApprovalStep.request_id).where(ApprovalStep.role == current_user.role)

    if current_user.role == UserRole.IT_STAFF:
        it_staff_roles = [UserRole.IT_STAFF, *IMPLEMENTATION_STEP_ROLES]
        approval_requests = select(ApprovalStep.request_id).where(ApprovalStep.role.in_(it_staff_roles))
        staff_section = user_administrative_section(current_user)
        request_section = func.coalesce(
            ServiceRequest.form_data["assigned_section"].as_string(),
            ServiceRequest.form_data["administrative_section"].as_string(),
        )
        if staff_section:
            conditions = [own_request, *dynamic_conditions, and_(ServiceRequest.id.in_(approval_requests), request_section == staff_section)]
            if delegated_filter is not None:
                conditions.append(delegated_filter)
            return stmt.where(or_(*conditions))
        section_has_staff = (
            select(func.count())
            .select_from(User)
            .where(User.role == UserRole.IT_STAFF, User.is_active == True, User.administrative_section == request_section)
            .correlate(ServiceRequest)
            .scalar_subquery()
        )
        conditions = [own_request, *dynamic_conditions, and_(ServiceRequest.id.in_(approval_requests), request_section.is_not(None), section_has_staff == 0)]
        if delegated_filter is not None:
            conditions.append(delegated_filter)
        return stmt.where(or_(*conditions))

    if current_user.role == UserRole.DEPARTMENT_MANAGER:
        managed_departments = select(Department.id).where(Department.manager_id == current_user.id, Department.is_active == True)
        conditions = [own_request, *dynamic_conditions, ServiceRequest.department_id.in_(managed_departments)]
        if delegated_filter is not None:
            conditions.append(delegated_filter)
        return stmt.where(or_(*conditions))

    if current_user.role in {UserRole.INFOSEC, UserRole.EXECUTIVE, UserRole.IT_STAFF}:
        conditions = [own_request, *dynamic_conditions, ServiceRequest.id.in_(approval_requests)]
        if delegated_filter is not None:
            conditions.append(delegated_filter)
        return stmt.where(or_(*conditions))

    conditions = [own_request, *dynamic_conditions]
    if delegated_filter is not None:
        conditions.append(delegated_filter)
    return stmt.where(or_(*conditions))


@router.get("", response_model=list[ServiceRequestRead])
def list_requests(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    status_filter: RequestStatus | None = Query(default=None, alias="status"),
    request_type: RequestType | None = None,
    search: str | None = Query(default=None),
    page: int | None = Query(default=None, ge=1),
    per_page: int | None = Query(default=None, ge=1, le=100),
):
    stmt = request_query().order_by(ServiceRequest.created_at.desc())
    stmt = scoped_requests_stmt(stmt, current_user, db)
    if status_filter:
        stmt = stmt.where(ServiceRequest.status == status_filter)
    if request_type:
        stmt = stmt.where(ServiceRequest.request_type == request_type)
    if search:
        term = f"%{search.strip()}%"
        stmt = stmt.where(or_(ServiceRequest.request_number.ilike(term), ServiceRequest.title.ilike(term)))
    if page and per_page:
        stmt = stmt.offset((page - 1) * per_page).limit(per_page)
    return enrich_request_list(db, db.scalars(stmt).all(), current_user)


def pending_approval_step(service_request: ServiceRequest) -> ApprovalStep | None:
    return next(
        (step for step in sorted(service_request.approvals or [], key=lambda item: item.step_order) if step.action == ApprovalAction.PENDING),
        None,
    )


def approval_request_is_active(service_request: ServiceRequest) -> bool:
    return str(service_request.status) in {"pending_approval", "in_implementation", "approved"}


def approval_step_is_execution(step: ApprovalStep | None) -> bool:
    return bool(step and str(step.role) in IMPLEMENTATION_STEP_ROLES)


def approval_sla_status(service_request: ServiceRequest, now: datetime | None = None) -> str:
    if not service_request.sla_due_at:
        return "none"
    current_time = now or datetime.now(timezone.utc)
    if current_time.tzinfo is None:
        current_time = current_time.replace(tzinfo=timezone.utc)
    due_at = service_request.sla_due_at
    if due_at.tzinfo is None:
        due_at = due_at.replace(tzinfo=timezone.utc)
    if str(service_request.status) in {"closed", "completed", "rejected", "cancelled"}:
        closed_at = service_request.closed_at
        if closed_at and closed_at.tzinfo is None:
            closed_at = closed_at.replace(tzinfo=timezone.utc)
        return "met" if not closed_at or closed_at <= due_at else "breached"
    return "overdue" if due_at < current_time else "within"


def user_acted_on_request(service_request: ServiceRequest, current_user: User) -> bool:
    return any(step.approver_id == current_user.id and step.action != ApprovalAction.PENDING for step in service_request.approvals or [])


def approval_relevant_to_user(db: Session, service_request: ServiceRequest, current_user: User) -> bool:
    if can_view_all_requests(db, current_user):
        return True
    if service_request.requester_id == current_user.id:
        return True
    pending_step = pending_approval_step(service_request)
    if pending_step and workflow_user_can_act(db, service_request, current_user, pending_step):
        return True
    if user_acted_on_request(service_request, current_user):
        return True
    if service_request.status == RequestStatus.RETURNED_FOR_EDIT and service_request.requester_id == current_user.id:
        return True
    return False


def approval_tab_matches(db: Session, service_request: ServiceRequest, current_user: User, tab: str) -> bool:
    if tab == "all":
        return True
    pending_step = pending_approval_step(service_request)
    can_act = bool(pending_step and workflow_user_can_act(db, service_request, current_user, pending_step))
    is_execution = approval_step_is_execution(pending_step)
    now = datetime.now(timezone.utc)
    if tab == "tracking":
        return service_request.requester_id == current_user.id
    if tab == "execution":
        return can_act and is_execution
    if tab == "returned":
        return service_request.status == RequestStatus.RETURNED_FOR_EDIT
    if tab == "overdue":
        return approval_sla_status(service_request, now) == "overdue"
    if tab == "completed":
        return str(service_request.status) in {"closed", "completed", "rejected", "cancelled"} or user_acted_on_request(service_request, current_user)
    if tab == "history":
        return user_acted_on_request(service_request, current_user) or can_view_all_requests(db, current_user)
    return can_act and not is_execution


def approval_filtered_items(
    db: Session,
    current_user: User,
    *,
    tab: str = "mine",
    request_number: str | None = None,
    search: str | None = None,
    request_type_id: int | None = None,
    status_filter: RequestStatus | None = None,
    priority: Priority | None = None,
    department_id: int | None = None,
    specialized_section_id: int | None = None,
    current_step_type: str | None = None,
    requester_id: int | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    sla_status: str | None = None,
) -> list[ServiceRequest]:
    stmt = request_query().order_by(ServiceRequest.created_at.desc())
    stmt = scoped_requests_stmt(stmt, current_user, db)
    if request_number:
        stmt = stmt.where(ServiceRequest.request_number.ilike(f"%{request_number.strip()}%"))
    if request_type_id:
        stmt = stmt.where(ServiceRequest.request_type_id == request_type_id)
    if status_filter:
        stmt = stmt.where(ServiceRequest.status == status_filter)
    if priority:
        stmt = stmt.where(ServiceRequest.priority == priority)
    if department_id:
        stmt = stmt.where(ServiceRequest.department_id == department_id)
    if requester_id:
        stmt = stmt.where(ServiceRequest.requester_id == requester_id)
    if date_from:
        stmt = stmt.where(ServiceRequest.created_at >= date_from)
    if date_to:
        stmt = stmt.where(ServiceRequest.created_at <= date_to)
    if specialized_section_id:
        section = db.get(SpecializedSection, specialized_section_id)
        if section:
            request_section = func.coalesce(
                ServiceRequest.form_data["assigned_section"].as_string(),
                ServiceRequest.form_data["administrative_section"].as_string(),
            )
            stmt = stmt.where(request_section == section.code)

    items = enrich_request_list(db, db.scalars(stmt).all(), current_user)
    relevant = [item for item in items if approval_relevant_to_user(db, item, current_user)]
    if search:
        term = search.strip().lower()
        relevant = [
            item for item in relevant
            if any(
                term in str(value or "").lower()
                for value in (
                    item.request_number,
                    item.title,
                    item.requester.full_name_ar if item.requester else "",
                    item.requester.full_name_en if item.requester else "",
                    item.requester.email if item.requester else "",
                    item.department.name_ar if item.department else "",
                    (item.form_data or {}).get("assigned_section_label") or (item.form_data or {}).get("administrative_section_label") or "",
                )
            )
        ]
    if current_step_type:
        relevant = [item for item in relevant if pending_approval_step(item) and str(pending_approval_step(item).role) == current_step_type]
    if sla_status:
        relevant = [item for item in relevant if approval_sla_status(item) == sla_status]
    return [item for item in relevant if approval_tab_matches(db, item, current_user, tab)]


@approvals_router.get("/summary")
def approvals_summary(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    items = approval_filtered_items(db, current_user, tab="all")
    today = datetime.now(timezone.utc).date()
    def acted_today(service_request: ServiceRequest) -> bool:
        for step in service_request.approvals or []:
            if step.approver_id != current_user.id or not step.acted_at:
                continue
            acted_at = step.acted_at if step.acted_at.tzinfo else step.acted_at.replace(tzinfo=timezone.utc)
            if acted_at.date() == today:
                return True
        return False

    return {
        "waiting_my_approval": sum(1 for item in items if approval_tab_matches(db, item, current_user, "mine")),
        "tracking": sum(1 for item in items if approval_tab_matches(db, item, current_user, "tracking")),
        "waiting_execution": sum(1 for item in items if approval_tab_matches(db, item, current_user, "execution")),
        "returned_for_edit": sum(1 for item in items if approval_tab_matches(db, item, current_user, "returned")),
        "overdue": sum(1 for item in items if approval_tab_matches(db, item, current_user, "overdue")),
        "processed_today": sum(1 for item in items if acted_today(item)),
    }


@approvals_router.get("", response_model=list[ServiceRequestRead])
def list_approvals(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tab: str = Query(default="mine"),
    request_number: str | None = Query(default=None),
    search: str | None = Query(default=None),
    request_type_id: int | None = Query(default=None),
    status_filter: RequestStatus | None = Query(default=None, alias="status"),
    priority: Priority | None = Query(default=None),
    department_id: int | None = Query(default=None),
    specialized_section_id: int | None = Query(default=None),
    current_step_type: str | None = Query(default=None),
    requester_id: int | None = Query(default=None),
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    sla_status: str | None = Query(default=None),
    page: int | None = Query(default=None, ge=1),
    per_page: int | None = Query(default=None, ge=1, le=100),
):
    items = approval_filtered_items(
        db,
        current_user,
        tab=tab,
        request_number=request_number,
        search=search,
        request_type_id=request_type_id,
        status_filter=status_filter,
        priority=priority,
        department_id=department_id,
        specialized_section_id=specialized_section_id,
        current_step_type=current_step_type,
        requester_id=requester_id,
        date_from=date_from,
        date_to=date_to,
        sla_status=sla_status,
    )
    if page and per_page:
        start = (page - 1) * per_page
        return items[start : start + per_page]
    return items


@approvals_router.get("/{request_id}", response_model=ServiceRequestRead)
def get_approval_request(request_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service_request = db.scalar(request_query().where(ServiceRequest.id == request_id))
    if not service_request:
        raise HTTPException(status_code=404, detail="Request not found")
    ensure_request_access(service_request, current_user, db)
    if not approval_relevant_to_user(db, service_request, current_user):
        raise HTTPException(status_code=403, detail="لا تملك صلاحية عرض هذا الطلب في شاشة الموافقات")
    write_audit(db, "approval_viewed", "service_request", actor=current_user, entity_id=str(service_request.id))
    db.commit()
    return enrich_approval_steps(db, service_request, current_user)


@router.post("", response_model=ServiceRequestRead, status_code=status.HTTP_201_CREATED)
def create_request(payload: ServiceRequestCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role == UserRole.EMPLOYEE and not current_user.manager_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="حسابك غير مرتبط بمدير مباشر. يرجى التواصل مع مدير النظام لربطك بمدير إدارة مباشر قبل رفع الطلب.",
        )
    request_type_record = db.get(RequestTypeSetting, payload.request_type_id) if payload.request_type_id else None
    fields: list[RequestTypeField] | list[dict] = []
    request_type_version = None
    request_type_config: dict = {}
    workflow_steps: list[dict] = []
    if payload.request_type_id:
        if not request_type_record or not request_type_record.is_active:
            raise HTTPException(status_code=404, detail="Request type not available")
        request_type_version = active_version_for_usage(db, request_type_record)
        if not version_is_ready(request_type_version):
            raise HTTPException(status_code=409, detail="نوع الطلب غير جاهز للاستخدام")
        version_snapshot = request_type_version.snapshot_json or {}
        request_type_config = version_snapshot.get("request_type") or {}
        workflow_steps = version_snapshot.get("workflow") or []
        fields = version_snapshot.get("fields") or []
        if not request_type_config.get("assigned_section") and not request_type_config.get("assigned_department_id"):
            raise HTTPException(status_code=409, detail="نوع الطلب غير مرتبط بقسم مختص")
        if not workflow_steps:
            raise HTTPException(status_code=409, detail="نوع الطلب لا يحتوي على مسار موافقات فعال")
        rules = attachment_rules_from_snapshot(request_type_config, request_type_record)
        if not rules["attachments_enabled"] and payload.attachment_count > 0:
            raise HTTPException(status_code=422, detail="المرفقات غير مفعلة لهذا النوع من الطلبات")
        if rules["requires_attachment"] and payload.attachment_count <= 0:
            raise HTTPException(status_code=422, detail="هذا النوع من الطلبات يتطلب إرفاق ملف قبل الإرسال")
        if payload.attachment_count > rules["max_attachments"]:
            raise HTTPException(status_code=422, detail=f"عدد المرفقات أكبر من الحد المسموح لهذا النوع ({rules['max_attachments']})")
        validate_form_data(fields, payload.form_data)
    assigned_section = request_type_config.get("assigned_section") if request_type_record else None
    assigned_to_id = resolve_assigned_user_id(db, request_type_config, assigned_section) if request_type_record else None
    service_request = ServiceRequest(
        request_number=next_request_number(db),
        title=payload.title,
        request_type=payload.request_type,
        request_type_id=payload.request_type_id,
        request_type_version_id=request_type_version.id if request_type_version else None,
        request_type_version_number=request_type_version.version_number if request_type_version else 1,
        priority=payload.priority,
        requester_id=current_user.id,
        assigned_to_id=assigned_to_id,
        department_id=(request_type_config.get("assigned_department_id") if request_type_record else None) or current_user.department_id,
        form_data=payload.form_data,
        request_type_snapshot={**request_type_config, "workflow": workflow_steps} if request_type_record else {},
        form_schema_snapshot=fields if request_type_record else [],
        business_justification=payload.business_justification,
        sla_due_at=sla_due_from_request_type_config(request_type_config) if request_type_record else None,
    )
    db.add(service_request)
    db.flush()
    if request_type_record:
        create_snapshot_steps_from_version(db, service_request, workflow_steps)
        service_request.status = RequestStatus.PENDING_APPROVAL
    else:
        create_approval_steps(db, service_request)
    if should_send_request_created_notification(db, payload.send_notification):
        create_request_created_message(db, service_request, current_user)
    write_audit(db, "request_created", "service_request", actor=current_user, entity_id=str(service_request.id))
    db.commit()
    return enrich_approval_steps(db, db.scalar(request_query().where(ServiceRequest.id == service_request.id)), current_user)


@router.get("/{request_id}", response_model=ServiceRequestRead)
def get_request(request_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service_request = db.scalar(request_query().where(ServiceRequest.id == request_id))
    if not service_request:
        raise HTTPException(status_code=404, detail="Request not found")
    ensure_request_access(service_request, current_user, db)
    return enrich_approval_steps(db, service_request, current_user)


@router.get("/{request_id}/messages", response_model=list[InternalMessageRead])
def get_request_messages(request_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    message_settings = load_message_settings(db)
    if not message_settings.get("enable_linked_requests", True) or not message_settings.get("show_messages_tab_in_request_details", True):
        raise HTTPException(status_code=403, detail="عرض المراسلات المرتبطة بالطلبات غير مفعل من إعدادات المراسلات")
    service_request = db.scalar(request_query().where(ServiceRequest.id == request_id))
    if not service_request:
        raise HTTPException(status_code=404, detail="Request not found")
    ensure_request_access(service_request, current_user, db)
    stmt = (
        select(InternalMessage)
        .options(
            selectinload(InternalMessage.sender),
            selectinload(InternalMessage.recipients).selectinload(InternalMessageRecipient.recipient),
            selectinload(InternalMessage.attachments),
            selectinload(InternalMessage.related_request),
        )
        .where(InternalMessage.related_request_id == service_request.id, InternalMessage.is_draft == False)
        .order_by(InternalMessage.created_at.desc())
    )
    return [message_read(message, current_user) for message in db.scalars(stmt.limit(100)).all() if can_view_request_linked_message(message, service_request, current_user, message_settings)]


@router.get("/{request_id}/status-history")
def get_request_status_history(request_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service_request = db.scalar(request_query().where(ServiceRequest.id == request_id))
    if not service_request:
        raise HTTPException(status_code=404, detail="Request not found")
    ensure_request_access(service_request, current_user, db)
    return request_status_history(service_request)


@router.get("/{request_id}/audit-logs")
def get_request_audit_logs(request_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service_request = db.scalar(request_query().where(ServiceRequest.id == request_id))
    if not service_request:
        raise HTTPException(status_code=404, detail="Request not found")
    ensure_request_access(service_request, current_user, db)
    logs = db.scalars(
        select(AuditLog)
        .options(selectinload(AuditLog.actor))
        .where(AuditLog.entity_type == "service_request", AuditLog.entity_id == str(request_id))
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(50)
    ).all()
    return [
        {
            "id": log.id,
            "action": log.action,
            "actor_name": log.actor.full_name_ar if log.actor else None,
            "created_at": log.created_at,
            "ip_address": log.ip_address,
            "metadata": log.metadata_json or {},
        }
        for log in logs
    ]


@router.get("/{request_id}/approval-history", response_model=list[ApprovalStepRead])
def get_request_approval_history(request_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service_request = db.scalar(request_query().where(ServiceRequest.id == request_id))
    if not service_request:
        raise HTTPException(status_code=404, detail="Request not found")
    ensure_request_access(service_request, current_user, db)
    enriched = enrich_approval_steps(db, service_request, current_user)
    return sorted(enriched.approvals or [], key=lambda step: step.step_order)


@router.get("/{request_id}/workflow-snapshot", response_model=list[ApprovalStepRead])
def get_request_workflow_snapshot(request_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service_request = db.scalar(request_query().where(ServiceRequest.id == request_id))
    if not service_request:
        raise HTTPException(status_code=404, detail="Request not found")
    ensure_request_access(service_request, current_user, db)
    enriched = enrich_approval_steps(db, service_request, current_user)
    return sorted(enriched.approvals or [], key=lambda step: step.step_order)


@router.get("/{request_id}/print.pdf")
def print_request_pdf(request_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service_request = db.scalar(request_query().where(ServiceRequest.id == request_id))
    if not service_request:
        raise HTTPException(status_code=404, detail="Request not found")
    ensure_request_access(service_request, current_user, db)
    stream = RequestPdfBuilder(service_request, current_user, db).build()
    write_audit(db, "request_printed_pdf", "service_request", actor=current_user, entity_id=str(service_request.id))
    db.commit()
    filename = f"{service_request.request_number or request_id}.pdf"
    return StreamingResponse(
        stream,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.patch("/{request_id}", response_model=ServiceRequestRead)
def update_request(request_id: int, payload: ServiceRequestUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service_request = db.scalar(request_query().where(ServiceRequest.id == request_id))
    if not service_request:
        raise HTTPException(status_code=404, detail="Request not found")
    if service_request.requester_id != current_user.id and current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Only requester or admin can edit")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(service_request, field, value)
    write_audit(db, "request_edited", "service_request", actor=current_user, entity_id=str(service_request.id))
    db.commit()
    return enrich_approval_steps(db, db.scalar(request_query().where(ServiceRequest.id == request_id)), current_user)


@router.post("/{request_id}/resubmit", response_model=ServiceRequestRead)
def resubmit_request(request_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service_request = db.scalar(request_query().where(ServiceRequest.id == request_id))
    if not service_request:
        raise HTTPException(status_code=404, detail="Request not found")
    if service_request.requester_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only requester can resubmit")
    if service_request.status != RequestStatus.RETURNED_FOR_EDIT:
        raise HTTPException(status_code=400, detail="Only returned requests can be resubmitted")
    if service_request.request_type_id:
        fields = service_request.form_schema_snapshot or db.scalars(
            select(RequestTypeField).where(RequestTypeField.request_type_id == service_request.request_type_id, RequestTypeField.is_active == True)
        ).all()
        validate_form_data(fields, service_request.form_data or {})
    reset_workflow_for_resubmission(service_request)
    write_audit(db, "request_resubmitted", "service_request", actor=current_user, entity_id=str(service_request.id))
    db.commit()
    return enrich_approval_steps(db, db.scalar(request_query().where(ServiceRequest.id == request_id)), current_user)


@router.post("/{request_id}/approval", response_model=ServiceRequestRead)
def decide(request_id: int, payload: ApprovalDecision, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if payload.action not in {ApprovalAction.APPROVED, ApprovalAction.REJECTED, ApprovalAction.RETURNED_FOR_EDIT}:
        raise HTTPException(status_code=400, detail="Approval action must be approved, rejected, or returned_for_edit")
    service_request = db.scalar(request_query().where(ServiceRequest.id == request_id))
    if not service_request:
        raise HTTPException(status_code=404, detail="Request not found")
    try:
        advance_workflow(db, service_request, current_user, payload.action, payload.note)
        db.flush()
        create_request_workflow_message(db, service_request, current_user, payload.action, payload.note)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    write_audit(db, f"request_{payload.action}", "service_request", actor=current_user, entity_id=str(service_request.id))
    db.commit()
    return enrich_approval_steps(db, db.scalar(request_query().where(ServiceRequest.id == request_id)), current_user)


@router.post("/{request_id}/comments")
def add_comment(request_id: int, payload: CommentCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service_request = db.get(ServiceRequest, request_id)
    if not service_request:
        raise HTTPException(status_code=404, detail="Request not found")
    ensure_request_access(service_request, current_user, db)
    comment = RequestComment(request_id=request_id, author_id=current_user.id, body=payload.body, is_internal=payload.is_internal)
    db.add(comment)
    write_audit(db, "comment_added", "service_request", actor=current_user, entity_id=str(request_id))
    db.commit()
    return {"id": comment.id, "message": "Comment added"}


@router.post("/{request_id}/attachments", response_model=AttachmentRead, status_code=status.HTTP_201_CREATED)
def upload_attachment(
    request_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service_request = db.get(ServiceRequest, request_id)
    if not service_request:
        raise HTTPException(status_code=404, detail="Request not found")
    ensure_request_access(service_request, current_user, db)
    request_type_record = db.get(RequestTypeSetting, service_request.request_type_id) if service_request.request_type_id else None
    snapshot = service_request.request_type_snapshot or {}
    rules = attachment_rules_from_snapshot(snapshot, request_type_record)
    if not rules["attachments_enabled"]:
        raise HTTPException(status_code=409, detail="المرفقات غير مفعلة لهذا النوع من الطلبات")
    current_count = db.scalar(select(func.count()).select_from(Attachment).where(Attachment.request_id == request_id)) or 0
    if not rules["allow_multiple_attachments"] and current_count >= 1:
        raise HTTPException(status_code=409, detail="هذا النوع من الطلبات لا يسمح بأكثر من مرفق واحد")
    if current_count >= rules["max_attachments"]:
        raise HTTPException(status_code=409, detail=f"وصل الطلب إلى الحد الأقصى للمرفقات ({rules['max_attachments']})")
    extension = attachment_extension(file.filename)
    if not extension or extension not in rules["allowed_extensions"]:
        raise HTTPException(status_code=400, detail=f"امتداد الملف غير مسموح. الامتدادات المسموحة: {', '.join(rules['allowed_extensions'])}")
    if file.content_type and file.content_type != "application/octet-stream" and file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="File type is not allowed")

    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    suffix = Path(file.filename or "attachment").suffix.lower()
    stored_name = f"{uuid4().hex}{suffix}"
    destination = upload_dir / stored_name

    size = 0
    general = db.scalar(select(SettingsGeneral).limit(1))
    global_max_mb = int(general.upload_max_file_size_mb or 10) if general else 10
    max_upload_bytes = min(rules["max_file_size_mb"], global_max_mb) * 1024 * 1024
    with destination.open("wb") as buffer:
        while chunk := file.file.read(1024 * 1024):
            size += len(chunk)
            if size > max_upload_bytes:
                buffer.close()
                destination.unlink(missing_ok=True)
                raise HTTPException(status_code=400, detail=f"حجم الملف يتجاوز الحد المسموح ({max_upload_bytes // (1024 * 1024)} MB)")
            buffer.write(chunk)

    attachment = Attachment(
        request_id=request_id,
        uploaded_by_id=current_user.id,
        original_name=file.filename or stored_name,
        stored_name=stored_name,
        content_type=file.content_type or "application/octet-stream",
        size_bytes=size,
    )
    db.add(attachment)
    db.flush()
    write_audit(db, "attachment_uploaded", "service_request", actor=current_user, entity_id=str(request_id), metadata={"attachment_id": attachment.id})
    db.commit()
    db.refresh(attachment)
    return attachment


@router.get("/{request_id}/attachments", response_model=list[AttachmentRead])
def list_attachments(request_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service_request = db.get(ServiceRequest, request_id)
    if not service_request:
        raise HTTPException(status_code=404, detail="Request not found")
    ensure_request_access(service_request, current_user, db)
    return db.scalars(select(Attachment).where(Attachment.request_id == request_id).order_by(Attachment.created_at.desc())).all()


@router.get("/{request_id}/attachments/{attachment_id}/download")
def download_attachment(request_id: int, attachment_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service_request = db.get(ServiceRequest, request_id)
    if not service_request:
        raise HTTPException(status_code=404, detail="Request not found")
    ensure_request_access(service_request, current_user, db)
    attachment = db.scalar(select(Attachment).where(Attachment.id == attachment_id, Attachment.request_id == request_id))
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    path = Path(settings.upload_dir) / attachment.stored_name
    if not path.exists():
        raise HTTPException(status_code=404, detail="Stored file not found")
    write_audit(db, "attachment_downloaded", "service_request", actor=current_user, entity_id=str(request_id), metadata={"attachment_id": attachment.id})
    db.commit()
    return FileResponse(path, media_type=attachment.content_type, filename=attachment.original_name)
