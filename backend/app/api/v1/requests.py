from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_user
from app.core.config import get_settings
from app.db.session import get_db
from app.models.enums import ApprovalAction, RequestStatus, RequestType, UserRole
from app.models.request import ApprovalStep, Attachment, RequestComment, ServiceRequest
from app.models.settings import RequestTypeField, RequestTypeSetting
from app.models.user import User
from app.schemas.request import ApprovalDecision, AttachmentRead, CommentCreate, ServiceRequestCreate, ServiceRequestRead, ServiceRequestUpdate
from app.services.audit import write_audit
from app.services.workflow import IMPLEMENTATION_STEP_ROLES, advance_workflow, create_approval_steps, next_request_number
from app.api.v1.request_type_management import create_snapshot_steps, validate_form_data

router = APIRouter(prefix="/requests", tags=["Service Requests"])
settings = get_settings()

ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
}
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
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


def request_query():
    return select(ServiceRequest).options(
        selectinload(ServiceRequest.requester),
        selectinload(ServiceRequest.department),
        selectinload(ServiceRequest.approvals),
        selectinload(ServiceRequest.comments),
        selectinload(ServiceRequest.attachments),
    )


def ensure_request_access(service_request: ServiceRequest, current_user: User, db: Session | None = None) -> None:
    if current_user.role in {UserRole.SUPER_ADMIN, UserRole.IT_MANAGER}:
        return
    if service_request.requester_id == current_user.id:
        return
    if current_user.role == UserRole.DIRECT_MANAGER and service_request.requester and service_request.requester.manager_id == current_user.id:
        return
    if current_user.role != UserRole.IT_STAFF and any(step.role == current_user.role for step in service_request.approvals):
        return
    if current_user.role == UserRole.IT_STAFF and any(step.role in IMPLEMENTATION_STEP_ROLES for step in service_request.approvals):
        if request_matches_it_staff_section(service_request, current_user) or (db and unassigned_it_staff_can_cover_request(db, service_request, current_user)):
            return
    if current_user.role == UserRole.IT_STAFF and any(step.role == UserRole.IT_STAFF for step in service_request.approvals):
        if request_matches_it_staff_section(service_request, current_user):
            return
    raise HTTPException(status_code=403, detail="Insufficient permissions")


def scoped_requests_stmt(stmt, current_user: User):
    if current_user.role in {UserRole.SUPER_ADMIN, UserRole.IT_MANAGER}:
        return stmt

    own_request = ServiceRequest.requester_id == current_user.id

    if current_user.role == UserRole.EMPLOYEE:
        return stmt.where(own_request)

    if current_user.role == UserRole.DIRECT_MANAGER:
        team_members = select(User.id).where(User.manager_id == current_user.id)
        return stmt.where(or_(own_request, ServiceRequest.requester_id.in_(team_members)))

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
            return stmt.where(
                or_(
                    own_request,
                    and_(
                        ServiceRequest.id.in_(approval_requests),
                        request_section == staff_section,
                    ),
                )
            )
        section_has_staff = (
            select(func.count())
            .select_from(User)
            .where(User.role == UserRole.IT_STAFF, User.is_active == True, User.administrative_section == request_section)
            .correlate(ServiceRequest)
            .scalar_subquery()
        )
        return stmt.where(or_(own_request, and_(ServiceRequest.id.in_(approval_requests), request_section.is_not(None), section_has_staff == 0)))

    if current_user.role in {UserRole.INFOSEC, UserRole.EXECUTIVE, UserRole.IT_STAFF}:
        return stmt.where(or_(own_request, ServiceRequest.id.in_(approval_requests)))

    return stmt.where(own_request)


@router.get("", response_model=list[ServiceRequestRead])
def list_requests(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    status_filter: RequestStatus | None = Query(default=None, alias="status"),
    request_type: RequestType | None = None,
):
    stmt = request_query().order_by(ServiceRequest.created_at.desc())
    stmt = scoped_requests_stmt(stmt, current_user)
    if status_filter:
        stmt = stmt.where(ServiceRequest.status == status_filter)
    if request_type:
        stmt = stmt.where(ServiceRequest.request_type == request_type)
    return db.scalars(stmt).all()


@router.post("", response_model=ServiceRequestRead, status_code=status.HTTP_201_CREATED)
def create_request(payload: ServiceRequestCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    request_type_record = db.get(RequestTypeSetting, payload.request_type_id) if payload.request_type_id else None
    if payload.request_type_id:
        if not request_type_record or not request_type_record.is_active:
            raise HTTPException(status_code=404, detail="Request type not available")
        fields = db.scalars(select(RequestTypeField).where(RequestTypeField.request_type_id == payload.request_type_id, RequestTypeField.is_active == True)).all()
        validate_form_data(fields, payload.form_data)
    service_request = ServiceRequest(
        request_number=next_request_number(db),
        title=payload.title,
        request_type=payload.request_type,
        request_type_id=payload.request_type_id,
        priority=payload.priority,
        requester_id=current_user.id,
        department_id=current_user.department_id,
        form_data=payload.form_data,
        business_justification=payload.business_justification,
    )
    db.add(service_request)
    db.flush()
    if request_type_record:
        create_snapshot_steps(db, service_request, request_type_record.id)
        service_request.status = RequestStatus.PENDING_APPROVAL
    else:
        create_approval_steps(db, service_request)
    write_audit(db, "request_created", "service_request", actor=current_user, entity_id=str(service_request.id))
    db.commit()
    return db.scalar(request_query().where(ServiceRequest.id == service_request.id))


@router.get("/{request_id}", response_model=ServiceRequestRead)
def get_request(request_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service_request = db.scalar(request_query().where(ServiceRequest.id == request_id))
    if not service_request:
        raise HTTPException(status_code=404, detail="Request not found")
    ensure_request_access(service_request, current_user, db)
    return service_request


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
    return db.scalar(request_query().where(ServiceRequest.id == request_id))


@router.post("/{request_id}/approval", response_model=ServiceRequestRead)
def decide(request_id: int, payload: ApprovalDecision, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if payload.action not in {ApprovalAction.APPROVED, ApprovalAction.REJECTED}:
        raise HTTPException(status_code=400, detail="Approval action must be approved or rejected")
    service_request = db.scalar(request_query().where(ServiceRequest.id == request_id))
    if not service_request:
        raise HTTPException(status_code=404, detail="Request not found")
    try:
        advance_workflow(db, service_request, current_user, payload.action, payload.note)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    write_audit(db, f"request_{payload.action}", "service_request", actor=current_user, entity_id=str(service_request.id))
    db.commit()
    return db.scalar(request_query().where(ServiceRequest.id == request_id))


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
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="File type is not allowed")

    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    extension = Path(file.filename or "attachment").suffix.lower()
    stored_name = f"{uuid4().hex}{extension}"
    destination = upload_dir / stored_name

    size = 0
    with destination.open("wb") as buffer:
        while chunk := file.file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_UPLOAD_BYTES:
                buffer.close()
                destination.unlink(missing_ok=True)
                raise HTTPException(status_code=400, detail="File exceeds maximum size")
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
