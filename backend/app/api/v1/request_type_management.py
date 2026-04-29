from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models.enums import ApprovalAction, RequestStatus, RequestType, UserRole
from app.models.request import ApprovalStep, RequestApprovalStep, ServiceRequest
from app.models.settings import RequestTypeField, RequestTypeSetting, SpecializedSection, WorkflowTemplate, WorkflowTemplateStep
from app.models.user import Department, User
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
from app.services.workflow import next_request_number

router = APIRouter(prefix="/request-types", tags=["Request Type Management"])
admin_actor = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.IT_MANAGER))


def workflow_summary(db: Session, request_type_id: int) -> str:
    template = db.scalar(select(WorkflowTemplate).where(WorkflowTemplate.request_type_id == request_type_id, WorkflowTemplate.is_active == True))
    if not template:
        return "No workflow"
    steps = db.scalars(select(WorkflowTemplateStep).where(WorkflowTemplateStep.workflow_template_id == template.id).order_by(WorkflowTemplateStep.sort_order)).all()
    return " -> ".join(step.step_name_en for step in steps) or "No steps"


def read_request_type(db: Session, item: RequestTypeSetting) -> RequestTypeRead:
    fields_count = db.scalar(select(func.count()).select_from(RequestTypeField).where(RequestTypeField.request_type_id == item.id)) or 0
    return RequestTypeRead(
        id=item.id,
        name_ar=item.name_ar,
        name_en=item.name_en,
        code=item.code,
        category=item.category,
        assigned_section=item.assigned_section,
        assigned_department_id=item.assigned_department_id,
        description=item.description,
        icon=item.icon,
        is_active=item.is_active,
        requires_attachment=item.requires_attachment,
        allow_multiple_attachments=item.allow_multiple_attachments,
        default_priority=item.default_priority,
        sla_response_hours=item.sla_response_hours,
        sla_resolution_hours=item.sla_resolution_hours,
        created_at=item.created_at,
        updated_at=item.updated_at,
        fields_count=fields_count,
        workflow_summary=workflow_summary(db, item.id),
    )


@router.get("", response_model=list[RequestTypeRead])
def list_request_types(
    db: Session = Depends(get_db),
    _: User = admin_actor,
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
    return [read_request_type(db, item) for item in db.scalars(stmt).all()]


@router.get("/active", response_model=list[RequestTypeRead])
def list_active_request_types(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    items = db.scalars(
        select(RequestTypeSetting)
        .where(RequestTypeSetting.is_active == True)
        .order_by(RequestTypeSetting.name_ar)
    ).all()
    return [read_request_type(db, item) for item in items]


@router.get("/{request_type_id}", response_model=RequestTypeRead)
def get_request_type(request_type_id: int, db: Session = Depends(get_db), _: User = admin_actor):
    item = db.get(RequestTypeSetting, request_type_id)
    if not item:
        raise HTTPException(status_code=404, detail="Request type not found")
    return read_request_type(db, item)


@router.post("", response_model=RequestTypeRead, status_code=status.HTTP_201_CREATED)
def create_request_type(payload: RequestTypePayload, db: Session = Depends(get_db), actor: User = admin_actor):
    if db.scalar(select(RequestTypeSetting).where(RequestTypeSetting.code == payload.code)):
        raise HTTPException(status_code=409, detail="رمز نوع الطلب مستخدم من قبل")
    if payload.assigned_department_id and not db.get(Department, payload.assigned_department_id):
        raise HTTPException(status_code=404, detail="Assigned department not found")
    item = RequestTypeSetting(**payload.model_dump(), request_type=payload.code, label_ar=payload.name_ar, is_enabled=payload.is_active, require_attachment=payload.requires_attachment)
    db.add(item)
    db.flush()
    write_audit(db, "request_type_created", "request_types", actor=actor, entity_id=str(item.id), metadata={"code": item.code})
    db.commit()
    db.refresh(item)
    return read_request_type(db, item)


@router.put("/{request_type_id}", response_model=RequestTypeRead)
def update_request_type(request_type_id: int, payload: RequestTypePayload, db: Session = Depends(get_db), actor: User = admin_actor):
    item = db.get(RequestTypeSetting, request_type_id)
    if not item:
        raise HTTPException(status_code=404, detail="Request type not found")
    duplicate = db.scalar(select(RequestTypeSetting).where(RequestTypeSetting.code == payload.code, RequestTypeSetting.id != request_type_id))
    if duplicate:
        raise HTTPException(status_code=409, detail="رمز نوع الطلب مستخدم من قبل")
    if payload.assigned_department_id and not db.get(Department, payload.assigned_department_id):
        raise HTTPException(status_code=404, detail="Assigned department not found")
    for field, value in payload.model_dump().items():
        setattr(item, field, value)
    item.request_type = payload.code
    item.label_ar = payload.name_ar
    item.is_enabled = payload.is_active
    item.require_attachment = payload.requires_attachment
    write_audit(db, "request_type_updated", "request_types", actor=actor, entity_id=str(item.id), metadata={"code": item.code})
    db.commit()
    db.refresh(item)
    return read_request_type(db, item)


@router.delete("/{request_type_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_request_type(request_type_id: int, db: Session = Depends(get_db), actor: User = admin_actor):
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
def update_request_type_status(request_type_id: int, payload: dict, db: Session = Depends(get_db), actor: User = admin_actor):
    item = db.get(RequestTypeSetting, request_type_id)
    if not item:
        raise HTTPException(status_code=404, detail="Request type not found")
    if payload.get("is_active") is True:
        steps_count = db.scalar(
            select(func.count())
            .select_from(WorkflowTemplateStep)
            .join(WorkflowTemplate, WorkflowTemplateStep.workflow_template_id == WorkflowTemplate.id)
            .where(WorkflowTemplate.request_type_id == request_type_id, WorkflowTemplateStep.is_active == True)
        ) or 0
        if steps_count == 0:
            raise HTTPException(status_code=409, detail="Workflow must have at least one approval step before activating request type")
    item.is_active = bool(payload.get("is_active"))
    item.is_enabled = item.is_active
    write_audit(db, "request_type_status_changed", "request_types", actor=actor, entity_id=str(item.id), metadata={"is_active": item.is_active})
    db.commit()
    db.refresh(item)
    return read_request_type(db, item)


@router.get("/{request_type_id}/fields", response_model=list[RequestTypeFieldRead])
def list_fields(request_type_id: int, db: Session = Depends(get_db), _: User = admin_actor):
    return db.scalars(select(RequestTypeField).where(RequestTypeField.request_type_id == request_type_id).order_by(RequestTypeField.sort_order)).all()


@router.post("/{request_type_id}/fields", response_model=RequestTypeFieldRead, status_code=status.HTTP_201_CREATED)
def create_field(request_type_id: int, payload: RequestTypeFieldPayload, db: Session = Depends(get_db), actor: User = admin_actor):
    if not db.get(RequestTypeSetting, request_type_id):
        raise HTTPException(status_code=404, detail="Request type not found")
    if db.scalar(select(RequestTypeField).where(RequestTypeField.request_type_id == request_type_id, RequestTypeField.field_name == payload.field_name)):
        raise HTTPException(status_code=409, detail="Field name must be unique per request type")
    item = RequestTypeField(request_type_id=request_type_id, **payload.model_dump())
    db.add(item)
    db.flush()
    write_audit(db, "request_type_field_created", "request_type_fields", actor=actor, entity_id=str(item.id))
    db.commit()
    db.refresh(item)
    return item


@router.put("/fields/{field_id}", response_model=RequestTypeFieldRead)
def update_field(field_id: int, payload: RequestTypeFieldPayload, db: Session = Depends(get_db), actor: User = admin_actor):
    item = db.get(RequestTypeField, field_id)
    if not item:
        raise HTTPException(status_code=404, detail="Field not found")
    duplicate = db.scalar(select(RequestTypeField).where(RequestTypeField.request_type_id == item.request_type_id, RequestTypeField.field_name == payload.field_name, RequestTypeField.id != field_id))
    if duplicate:
        raise HTTPException(status_code=409, detail="Field name must be unique per request type")
    for field, value in payload.model_dump().items():
        setattr(item, field, value)
    write_audit(db, "request_type_field_updated", "request_type_fields", actor=actor, entity_id=str(item.id))
    db.commit()
    db.refresh(item)
    return item


@router.delete("/fields/{field_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_field(field_id: int, db: Session = Depends(get_db), actor: User = admin_actor):
    item = db.get(RequestTypeField, field_id)
    if not item:
        raise HTTPException(status_code=404, detail="Field not found")
    db.delete(item)
    write_audit(db, "request_type_field_deleted", "request_type_fields", actor=actor, entity_id=str(field_id))
    db.commit()


@router.post("/{request_type_id}/fields/reorder", response_model=list[RequestTypeFieldRead])
def reorder_fields(request_type_id: int, payload: ReorderPayload, db: Session = Depends(get_db), actor: User = admin_actor):
    for index, field_id in enumerate(payload.ids, start=1):
        item = db.get(RequestTypeField, field_id)
        if item and item.request_type_id == request_type_id:
            item.sort_order = index
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


@router.get("/{request_type_id}/workflow", response_model=WorkflowRead)
def get_workflow(request_type_id: int, db: Session = Depends(get_db), _: User = admin_actor):
    template = get_or_create_template(db, request_type_id)
    steps = db.scalars(select(WorkflowTemplateStep).where(WorkflowTemplateStep.workflow_template_id == template.id).order_by(WorkflowTemplateStep.sort_order)).all()
    db.commit()
    return WorkflowRead(id=template.id, request_type_id=template.request_type_id, name=template.name, is_active=template.is_active, steps=steps)


@router.post("/{request_type_id}/workflow/steps", response_model=WorkflowStepRead, status_code=status.HTTP_201_CREATED)
def create_workflow_step(request_type_id: int, payload: WorkflowStepPayload, db: Session = Depends(get_db), actor: User = admin_actor):
    template = get_or_create_template(db, request_type_id)
    item = WorkflowTemplateStep(workflow_template_id=template.id, **payload.model_dump())
    db.add(item)
    db.flush()
    write_audit(db, "workflow_template_step_created", "workflow_template_steps", actor=actor, entity_id=str(item.id))
    db.commit()
    db.refresh(item)
    return item


@router.put("/workflow-steps/{step_id}", response_model=WorkflowStepRead)
def update_workflow_step(step_id: int, payload: WorkflowStepPayload, db: Session = Depends(get_db), actor: User = admin_actor):
    item = db.get(WorkflowTemplateStep, step_id)
    if not item:
        raise HTTPException(status_code=404, detail="Workflow step not found")
    for field, value in payload.model_dump().items():
        setattr(item, field, value)
    write_audit(db, "workflow_template_step_updated", "workflow_template_steps", actor=actor, entity_id=str(item.id))
    db.commit()
    db.refresh(item)
    return item


@router.delete("/workflow-steps/{step_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workflow_step(step_id: int, db: Session = Depends(get_db), actor: User = admin_actor):
    item = db.get(WorkflowTemplateStep, step_id)
    if not item:
        raise HTTPException(status_code=404, detail="Workflow step not found")
    active_snapshots = db.scalar(select(func.count()).select_from(RequestApprovalStep).where(RequestApprovalStep.step_name_en == item.step_name_en, RequestApprovalStep.status.in_(["pending", "waiting"]))) or 0
    if active_snapshots:
        raise HTTPException(status_code=409, detail="Cannot delete workflow step while active requests are using it")
    db.delete(item)
    write_audit(db, "workflow_template_step_deleted", "workflow_template_steps", actor=actor, entity_id=str(step_id))
    db.commit()


@router.post("/{request_type_id}/workflow/reorder", response_model=WorkflowRead)
def reorder_workflow(request_type_id: int, payload: ReorderPayload, db: Session = Depends(get_db), actor: User = admin_actor):
    template = get_or_create_template(db, request_type_id)
    for index, step_id in enumerate(payload.ids, start=1):
        step = db.get(WorkflowTemplateStep, step_id)
        if step and step.workflow_template_id == template.id:
            step.sort_order = index
    write_audit(db, "workflow_template_reordered", "workflow_templates", actor=actor, entity_id=str(template.id))
    db.commit()
    return get_workflow(request_type_id, db, actor)


@router.get("/{request_type_id}/workflow/preview")
def preview_workflow(request_type_id: int, db: Session = Depends(get_db), _: User = admin_actor):
    template = get_or_create_template(db, request_type_id)
    steps = db.scalars(select(WorkflowTemplateStep).where(WorkflowTemplateStep.workflow_template_id == template.id, WorkflowTemplateStep.is_active == True).order_by(WorkflowTemplateStep.sort_order)).all()
    return {"steps": [{"order": step.sort_order, "name_ar": step.step_name_ar, "name_en": step.step_name_en, "type": step.step_type, "sla_hours": step.sla_hours} for step in steps]}


@router.get("/{request_type_id}/form-schema")
def form_schema(request_type_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    request_type = db.get(RequestTypeSetting, request_type_id)
    if not request_type or not request_type.is_active:
        raise HTTPException(status_code=404, detail="Request type not available")
    fields = db.scalars(select(RequestTypeField).where(RequestTypeField.request_type_id == request_type_id, RequestTypeField.is_active == True).order_by(RequestTypeField.sort_order)).all()
    return {"request_type": read_request_type(db, request_type), "fields": fields}


def validate_form_data(fields: list[RequestTypeField], form_data: dict) -> None:
    for field in fields:
        value = form_data.get(field.field_name)
        if field.is_required and (value is None or value == ""):
            raise HTTPException(status_code=422, detail=f"{field.field_name} is required")


def create_snapshot_steps(db: Session, service_request: ServiceRequest, request_type_id: int) -> None:
    template = db.scalar(select(WorkflowTemplate).where(WorkflowTemplate.request_type_id == request_type_id, WorkflowTemplate.is_active == True))
    if not template:
        raise HTTPException(status_code=409, detail="Workflow template is missing")
    steps = db.scalars(select(WorkflowTemplateStep).where(WorkflowTemplateStep.workflow_template_id == template.id, WorkflowTemplateStep.is_active == True).order_by(WorkflowTemplateStep.sort_order)).all()
    if not steps:
        raise HTTPException(status_code=409, detail="Workflow must have at least one approval step")
    now = datetime.now(timezone.utc)
    for index, step in enumerate(steps):
        db.add(
            RequestApprovalStep(
                request_id=service_request.id,
                step_name_ar=step.step_name_ar,
                step_name_en=step.step_name_en,
                step_type=step.step_type,
                approver_role_id=step.approver_role_id,
                approver_user_id=step.approver_user_id,
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


requests_router = APIRouter(prefix="/requests", tags=["Dynamic Request Submission"])


@requests_router.post("/dynamic", status_code=status.HTTP_201_CREATED)
def submit_dynamic_request(payload: RequestSubmitPayload, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    request_type = db.get(RequestTypeSetting, payload.request_type_id)
    if not request_type or not request_type.is_active:
        raise HTTPException(status_code=404, detail="Request type not available")
    fields = db.scalars(select(RequestTypeField).where(RequestTypeField.request_type_id == payload.request_type_id, RequestTypeField.is_active == True)).all()
    validate_form_data(fields, payload.form_data)
    priority = payload.priority or request_type.default_priority
    assigned_section = request_type.assigned_section or payload.form_data.get("assigned_section") or payload.form_data.get("administrative_section")
    form_data = {
        **payload.form_data,
        "administrative_section": assigned_section,
        "administrative_section_label": section_label(db, assigned_section),
        "assigned_section": assigned_section,
        "assigned_section_label": section_label(db, assigned_section),
    }
    service_request = ServiceRequest(
        request_number=next_request_number(db),
        title=payload.title,
        request_type=REQUEST_TYPE_CODE_MAP.get(request_type.code, RequestType.SUPPORT),
        request_type_id=request_type.id,
        requester_id=current_user.id,
        department_id=request_type.assigned_department_id or current_user.department_id,
        status=RequestStatus.PENDING_APPROVAL,
        priority=priority,
        form_data=form_data,
        business_justification=payload.business_justification,
    )
    db.add(service_request)
    db.flush()
    create_snapshot_steps(db, service_request, request_type.id)
    write_audit(db, "dynamic_request_created", "service_request", actor=current_user, entity_id=str(service_request.id), metadata={"request_type_id": request_type.id})
    db.commit()
    return {"id": service_request.id, "request_number": service_request.request_number}
