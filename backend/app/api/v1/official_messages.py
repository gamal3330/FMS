from datetime import datetime, timezone
from pathlib import Path
import re
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.message import (
    InternalMessage,
    InternalMessageRecipient,
    OfficialLetterheadTemplate,
    OfficialMessageDocument,
    OfficialMessageSettings,
    OfficialStamp,
    UserSignature,
)
from app.models.request import ServiceRequest
from app.models.user import User
from app.services.audit import write_audit
from app.services.official_messages import (
    OFFICIAL_IMAGE_SUBDIR,
    can_manage_official_assets,
    default_letterhead,
    ensure_official_message_runtime,
    generate_official_document,
    has_action_permission,
    official_asset_dir,
    official_document_path,
    seed_default_official_settings,
)

letterheads_router = APIRouter(prefix="/settings/official-letterheads", tags=["Official Letterheads"])
signatures_router = APIRouter(prefix="/signatures", tags=["Official Signatures"])
settings_signatures_router = APIRouter(prefix="/settings/signatures", tags=["Official Signatures"])
stamps_router = APIRouter(prefix="/settings/official-stamps", tags=["Official Stamps"])
official_messages_router = APIRouter(prefix="/messages", tags=["Official Messages"])
official_settings_router = APIRouter(prefix="/settings/official-messages", tags=["Official Messages"])

ALLOWED_IMAGE_EXTENSIONS = {"png", "jpg", "jpeg"}
MAX_OFFICIAL_IMAGE_BYTES = 5 * 1024 * 1024
MAX_OFFICIAL_TEMPLATE_BYTES = 15 * 1024 * 1024


class LetterheadTemplateRead(BaseModel):
    id: int
    name_ar: str
    name_en: str | None = None
    code: str
    logo_path: str | None = None
    template_pdf_path: str | None = None
    header_html: str | None = None
    footer_html: str | None = None
    primary_color: str = "#0f5132"
    secondary_color: str = "#9bd84e"
    show_page_number: bool = True
    show_confidentiality_label: bool = True
    is_default: bool = False
    is_active: bool = True

    model_config = {"from_attributes": True}


class LetterheadTemplatePayload(BaseModel):
    name_ar: str = Field(min_length=2, max_length=160)
    name_en: str | None = Field(default=None, max_length=160)
    code: str | None = Field(default=None, max_length=80)
    logo_path: str | None = Field(default=None, max_length=500)
    header_html: str | None = None
    footer_html: str | None = None
    primary_color: str = Field(default="#0f5132", max_length=20)
    secondary_color: str = Field(default="#9bd84e", max_length=20)
    show_page_number: bool = True
    show_confidentiality_label: bool = True
    is_default: bool = False
    is_active: bool = True


class OfficialMessageSettingsRead(BaseModel):
    default_letterhead_template_id: int | None = None
    enable_official_letterhead: bool = True
    official_message_requires_approval: bool = False
    allow_unverified_signature: bool = False
    allow_signature_upload_by_user: bool = True
    include_official_messages_in_request_pdf: bool = True

    model_config = {"from_attributes": True}


class OfficialMessageSettingsPayload(BaseModel):
    default_letterhead_template_id: int | None = None
    enable_official_letterhead: bool = True
    official_message_requires_approval: bool = False
    allow_unverified_signature: bool = False
    allow_signature_upload_by_user: bool = True
    include_official_messages_in_request_pdf: bool = True


class UserSignatureRead(BaseModel):
    id: int
    user_id: int
    signature_label: str | None = None
    is_verified: bool = False
    is_active: bool = True
    uploaded_at: datetime

    model_config = {"from_attributes": True}


class OfficialStampRead(BaseModel):
    id: int
    name_ar: str
    code: str
    allowed_roles_json: list[str] = Field(default_factory=list)
    is_active: bool = True

    model_config = {"from_attributes": True}


class OfficialStampPayload(BaseModel):
    name_ar: str = Field(min_length=2, max_length=160)
    code: str | None = Field(default=None, max_length=80)
    allowed_roles_json: list[str] = Field(default_factory=list)
    is_active: bool = True


class OfficialPDFOptions(BaseModel):
    letterhead_template_id: int | None = None
    official_reference_number: str | None = Field(default=None, max_length=80)
    correspondence_type: str | None = Field(default=None, max_length=120)
    include_signature: bool = False
    signature_id: int | None = None
    include_stamp: bool = False
    stamp_id: int | None = None
    include_in_request_pdf: bool = False
    show_sender_department: bool = True
    show_recipients: bool = True
    show_generated_by: bool = True
    show_generated_at: bool = True


class OfficialPreviewPayload(OfficialPDFOptions):
    recipient_ids: list[int] = Field(default_factory=list)
    related_request_id: int | str | None = None
    subject: str = Field(min_length=2, max_length=180)
    body: str = Field(min_length=1)


class LetterheadPreviewPayload(BaseModel):
    subject: str = Field(default="معاينة الترويسة الرسمية", max_length=180)
    body: str = Field(default="هذا نص تجريبي لمعاينة قالب الترويسة الرسمية.")


def require_manage(user: User) -> None:
    if not can_manage_official_assets(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="لا تملك صلاحية إدارة الترويسات الرسمية")


def handle_permission_error(error: Exception) -> None:
    if isinstance(error, PermissionError):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(error) or "لا تملك صلاحية تنفيذ هذا الإجراء")
    if isinstance(error, ValueError):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error))
    raise error


def save_official_image(file: UploadFile) -> str:
    filename = file.filename or "image.png"
    extension = Path(filename).suffix.lower().lstrip(".")
    if extension not in ALLOWED_IMAGE_EXTENSIONS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="يسمح برفع صور PNG أو JPG فقط")
    content = file.file.read()
    if len(content) > MAX_OFFICIAL_IMAGE_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="حجم الصورة أكبر من الحد المسموح 5MB")
    stored = f"{uuid4().hex}.{extension}"
    destination = official_asset_dir() / stored
    destination.write_bytes(content)
    return f"{OFFICIAL_IMAGE_SUBDIR}/{stored}"


def save_official_template_pdf(file: UploadFile) -> str:
    filename = file.filename or "letterhead.pdf"
    extension = Path(filename).suffix.lower().lstrip(".")
    if extension != "pdf":
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="يسمح برفع قالب PDF فقط")
    content = file.file.read()
    if len(content) > MAX_OFFICIAL_TEMPLATE_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="حجم قالب الترويسة أكبر من الحد المسموح 15MB")
    if not content.startswith(b"%PDF"):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="الملف المرفوع ليس PDF صالحاً")
    stored = f"{uuid4().hex}.pdf"
    destination = official_asset_dir() / stored
    destination.write_bytes(content)
    return f"{OFFICIAL_IMAGE_SUBDIR}/{stored}"


def normalize_asset_code(value: str | None, prefix: str) -> str:
    raw = str(value or "").strip().lower()
    raw = re.sub(r"[\s\-]+", "_", raw)
    raw = re.sub(r"[^a-z0-9_]", "", raw)
    raw = re.sub(r"_+", "_", raw).strip("_")
    if not raw:
        raw = f"{prefix}_{uuid4().hex[:8]}"
    if not raw[0].isalpha():
        raw = f"{prefix}_{raw}"
    return raw[:80].rstrip("_") or f"{prefix}_{uuid4().hex[:8]}"


def unique_asset_code(db: Session, model, code: str, exclude_id: int | None = None) -> str:
    base = code[:80].rstrip("_") or uuid4().hex[:8]
    candidate = base
    suffix = 2
    while True:
        stmt = select(model.id).where(model.code == candidate)
        if exclude_id is not None:
            stmt = stmt.where(model.id != exclude_id)
        if db.scalar(stmt) is None:
            return candidate
        tail = f"_{suffix}"
        candidate = f"{base[:80 - len(tail)]}{tail}"
        suffix += 1


def letterhead_payload_data(db: Session, payload: LetterheadTemplatePayload, template_id: int | None = None) -> dict:
    data = payload.model_dump()
    code_source = payload.code or payload.name_en or payload.name_ar
    data["code"] = unique_asset_code(db, OfficialLetterheadTemplate, normalize_asset_code(code_source, "letterhead"), template_id)
    return data


def stamp_payload_data(db: Session, payload: OfficialStampPayload, stamp_id: int | None = None) -> dict:
    data = payload.model_dump()
    code_source = payload.code or payload.name_ar
    data["code"] = unique_asset_code(db, OfficialStamp, normalize_asset_code(code_source, "stamp"), stamp_id)
    return data


def can_access_message(message: InternalMessage, user: User) -> bool:
    if message.sender_id == user.id:
        return not bool(message.is_sender_deleted)
    return any(recipient.recipient_id == user.id and not recipient.is_deleted for recipient in message.recipients)


def load_message_for_official_pdf(db: Session, message_id: int, user: User) -> InternalMessage:
    ensure_official_message_runtime(db)
    message = db.scalar(
        select(InternalMessage)
        .options(
            selectinload(InternalMessage.sender).selectinload(User.department),
            selectinload(InternalMessage.recipients).selectinload(InternalMessageRecipient.recipient),
            selectinload(InternalMessage.related_request),
            selectinload(InternalMessage.official_documents),
        )
        .where(InternalMessage.id == message_id)
    )
    if not message or not can_access_message(message, user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    return message


@letterheads_router.get("", response_model=list[LetterheadTemplateRead])
def list_letterheads(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ensure_official_message_runtime(db)
    return db.scalars(select(OfficialLetterheadTemplate).order_by(OfficialLetterheadTemplate.is_default.desc(), OfficialLetterheadTemplate.id)).all()


@letterheads_router.post("", response_model=LetterheadTemplateRead, status_code=status.HTTP_201_CREATED)
def create_letterhead(payload: LetterheadTemplatePayload, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_manage(current_user)
    ensure_official_message_runtime(db)
    if payload.is_default:
        for item in db.scalars(select(OfficialLetterheadTemplate).where(OfficialLetterheadTemplate.is_default == True)).all():
            item.is_default = False
    data = letterhead_payload_data(db, payload)
    template = OfficialLetterheadTemplate(**data, created_by=current_user.id)
    db.add(template)
    write_audit(db, "official_letterhead_created", "official_letterhead", actor=current_user, metadata={"code": template.code})
    db.commit()
    db.refresh(template)
    return template


@letterheads_router.put("/{template_id}", response_model=LetterheadTemplateRead)
def update_letterhead(template_id: int, payload: LetterheadTemplatePayload, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_manage(current_user)
    ensure_official_message_runtime(db)
    template = db.get(OfficialLetterheadTemplate, template_id)
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="قالب الترويسة غير موجود")
    if payload.is_default:
        for item in db.scalars(select(OfficialLetterheadTemplate).where(OfficialLetterheadTemplate.id != template_id, OfficialLetterheadTemplate.is_default == True)).all():
            item.is_default = False
    for key, value in letterhead_payload_data(db, payload, template_id).items():
        setattr(template, key, value)
    write_audit(db, "official_letterhead_updated", "official_letterhead", actor=current_user, entity_id=str(template.id))
    db.commit()
    db.refresh(template)
    return template


@letterheads_router.patch("/{template_id}/status", response_model=LetterheadTemplateRead)
def update_letterhead_status(template_id: int, payload: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_manage(current_user)
    ensure_official_message_runtime(db)
    template = db.get(OfficialLetterheadTemplate, template_id)
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="قالب الترويسة غير موجود")
    template.is_active = bool(payload.get("is_active", True))
    write_audit(db, "official_letterhead_status_updated", "official_letterhead", actor=current_user, entity_id=str(template.id), metadata={"is_active": template.is_active})
    db.commit()
    db.refresh(template)
    return template


@letterheads_router.post("/{template_id}/set-default", response_model=LetterheadTemplateRead)
def set_default_letterhead(template_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_manage(current_user)
    ensure_official_message_runtime(db)
    template = db.get(OfficialLetterheadTemplate, template_id)
    if not template or not template.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="قالب الترويسة غير موجود أو غير مفعل")
    for item in db.scalars(select(OfficialLetterheadTemplate).where(OfficialLetterheadTemplate.is_default == True)).all():
        item.is_default = False
    template.is_default = True
    settings_row = seed_default_official_settings(db)
    settings_row.default_letterhead_template_id = template.id
    write_audit(db, "official_letterhead_set_default", "official_letterhead", actor=current_user, entity_id=str(template.id))
    db.commit()
    db.refresh(template)
    return template


@letterheads_router.post("/{template_id}/logo", response_model=LetterheadTemplateRead)
async def upload_letterhead_logo(template_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_manage(current_user)
    ensure_official_message_runtime(db)
    template = db.get(OfficialLetterheadTemplate, template_id)
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="قالب الترويسة غير موجود")
    template.logo_path = save_official_image(file)
    write_audit(db, "official_letterhead_logo_uploaded", "official_letterhead", actor=current_user, entity_id=str(template.id))
    db.commit()
    db.refresh(template)
    return template


@letterheads_router.post("/{template_id}/pdf-template", response_model=LetterheadTemplateRead)
async def upload_letterhead_pdf_template(template_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_manage(current_user)
    ensure_official_message_runtime(db)
    template = db.get(OfficialLetterheadTemplate, template_id)
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="قالب الترويسة غير موجود")
    template.template_pdf_path = save_official_template_pdf(file)
    write_audit(db, "official_letterhead_pdf_template_uploaded", "official_letterhead", actor=current_user, entity_id=str(template.id))
    db.commit()
    db.refresh(template)
    return template


@letterheads_router.post("/{template_id}/preview")
def preview_letterhead_template(template_id: int, payload: LetterheadPreviewPayload | None = None, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_manage(current_user)
    ensure_official_message_runtime(db)
    template = db.get(OfficialLetterheadTemplate, template_id)
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="قالب الترويسة غير موجود")
    sample = payload or LetterheadPreviewPayload()
    preview = InternalMessage(
        id=0,
        message_uid="LETTERHEAD-PREVIEW",
        sender_id=current_user.id,
        sender=current_user,
        message_type="official_correspondence",
        subject=sample.subject,
        body=sample.body,
        created_at=datetime.now(timezone.utc),
    )
    try:
        content, _ = generate_official_document(
            db,
            message=preview,
            actor=current_user,
            letterhead_template_id=template.id,
            reference_number="REF-PREVIEW",
            correspondence_type="معاينة",
            persist=False,
        )
    except Exception as error:
        handle_permission_error(error)
    write_audit(db, "official_letterhead_previewed", "official_letterhead", actor=current_user, entity_id=str(template.id))
    db.commit()
    return Response(content, media_type="application/pdf", headers={"Content-Disposition": 'inline; filename="letterhead-preview.pdf"'})


@official_settings_router.get("", response_model=OfficialMessageSettingsRead)
def get_official_settings(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ensure_official_message_runtime(db)
    row = seed_default_official_settings(db)
    db.commit()
    return row


@official_settings_router.put("", response_model=OfficialMessageSettingsRead)
def update_official_settings(payload: OfficialMessageSettingsPayload, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_manage(current_user)
    ensure_official_message_runtime(db)
    row = seed_default_official_settings(db)
    if payload.default_letterhead_template_id:
        template = db.get(OfficialLetterheadTemplate, payload.default_letterhead_template_id)
        if not template or not template.is_active:
            raise HTTPException(status_code=422, detail="قالب الترويسة الافتراضي غير صحيح")
    for key, value in payload.model_dump().items():
        setattr(row, key, value)
    write_audit(db, "official_message_settings_updated", "official_message_settings", actor=current_user)
    db.commit()
    return row


@signatures_router.get("/me", response_model=list[UserSignatureRead])
def get_my_signatures(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ensure_official_message_runtime(db)
    return db.scalars(select(UserSignature).where(UserSignature.user_id == current_user.id).order_by(UserSignature.uploaded_at.desc())).all()


@signatures_router.post("/me", response_model=UserSignatureRead, status_code=status.HTTP_201_CREATED)
async def upload_my_signature(
    signature_label: str | None = Form(default=None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ensure_official_message_runtime(db)
    settings_row = seed_default_official_settings(db)
    if not settings_row.allow_signature_upload_by_user and not can_manage_official_assets(current_user):
        raise HTTPException(status_code=403, detail="رفع التوقيع غير مفعل للمستخدمين")
    relative_path = save_official_image(file)
    signature = UserSignature(user_id=current_user.id, signature_image_path=relative_path, signature_label=signature_label or "توقيعي", is_verified=False, is_active=True)
    db.add(signature)
    write_audit(db, "user_signature_uploaded", "user_signature", actor=current_user)
    db.commit()
    db.refresh(signature)
    return signature


@settings_signatures_router.get("", response_model=list[UserSignatureRead])
def list_signatures(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_manage(current_user)
    ensure_official_message_runtime(db)
    return db.scalars(select(UserSignature).order_by(UserSignature.uploaded_at.desc())).all()


@settings_signatures_router.post("/{signature_id}/verify", response_model=UserSignatureRead)
def verify_signature(signature_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_manage(current_user)
    ensure_official_message_runtime(db)
    signature = db.get(UserSignature, signature_id)
    if not signature:
        raise HTTPException(status_code=404, detail="التوقيع غير موجود")
    signature.is_verified = True
    signature.verified_by = current_user.id
    signature.verified_at = datetime.now(timezone.utc)
    write_audit(db, "user_signature_verified", "user_signature", actor=current_user, entity_id=str(signature.id))
    db.commit()
    db.refresh(signature)
    return signature


@settings_signatures_router.patch("/{signature_id}/status", response_model=UserSignatureRead)
def update_signature_status(signature_id: int, payload: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_manage(current_user)
    ensure_official_message_runtime(db)
    signature = db.get(UserSignature, signature_id)
    if not signature:
        raise HTTPException(status_code=404, detail="التوقيع غير موجود")
    signature.is_active = bool(payload.get("is_active", True))
    write_audit(db, "user_signature_status_updated", "user_signature", actor=current_user, entity_id=str(signature.id), metadata={"is_active": signature.is_active})
    db.commit()
    db.refresh(signature)
    return signature


@stamps_router.get("", response_model=list[OfficialStampRead])
def list_stamps(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ensure_official_message_runtime(db)
    return db.scalars(select(OfficialStamp).order_by(OfficialStamp.id)).all()


@stamps_router.post("", response_model=OfficialStampRead, status_code=status.HTTP_201_CREATED)
async def create_stamp(
    name_ar: str = Form(...),
    code: str = Form(...),
    allowed_roles_json: str = Form(default=""),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_manage(current_user)
    ensure_official_message_runtime(db)
    roles = [role.strip() for role in allowed_roles_json.split(",") if role.strip()]
    relative_path = save_official_image(file)
    normalized_code = unique_asset_code(db, OfficialStamp, normalize_asset_code(code or name_ar, "stamp"))
    stamp = OfficialStamp(name_ar=name_ar, code=normalized_code, stamp_image_path=relative_path, allowed_roles_json=roles, is_active=True, created_by=current_user.id)
    db.add(stamp)
    write_audit(db, "official_stamp_created", "official_stamp", actor=current_user, metadata={"code": code})
    db.commit()
    db.refresh(stamp)
    return stamp


@stamps_router.put("/{stamp_id}", response_model=OfficialStampRead)
def update_stamp(stamp_id: int, payload: OfficialStampPayload, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_manage(current_user)
    ensure_official_message_runtime(db)
    stamp = db.get(OfficialStamp, stamp_id)
    if not stamp:
        raise HTTPException(status_code=404, detail="الختم غير موجود")
    for key, value in stamp_payload_data(db, payload, stamp_id).items():
        setattr(stamp, key, value)
    write_audit(db, "official_stamp_updated", "official_stamp", actor=current_user, entity_id=str(stamp.id))
    db.commit()
    db.refresh(stamp)
    return stamp


@stamps_router.patch("/{stamp_id}/status", response_model=OfficialStampRead)
def update_stamp_status(stamp_id: int, payload: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_manage(current_user)
    ensure_official_message_runtime(db)
    stamp = db.get(OfficialStamp, stamp_id)
    if not stamp:
        raise HTTPException(status_code=404, detail="الختم غير موجود")
    stamp.is_active = bool(payload.get("is_active", True))
    write_audit(db, "official_stamp_status_updated", "official_stamp", actor=current_user, entity_id=str(stamp.id), metadata={"is_active": stamp.is_active})
    db.commit()
    db.refresh(stamp)
    return stamp


@official_messages_router.post("/official/preview-pdf")
def preview_official_pdf(payload: OfficialPreviewPayload, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ensure_official_message_runtime(db)
    if not seed_default_official_settings(db).enable_official_letterhead:
        raise HTTPException(status_code=403, detail="خاصية الترويسة الرسمية غير مفعلة حالياً")
    recipients = db.scalars(select(User).where(User.id.in_(payload.recipient_ids))).all() if payload.recipient_ids else []
    related_request = None
    related_request_id = None
    if payload.related_request_id:
        ref = str(payload.related_request_id)
        related_request = db.scalar(select(ServiceRequest).where((ServiceRequest.id == int(ref)) if ref.isdigit() else (ServiceRequest.request_number == ref)))
        related_request_id = related_request.id if related_request else None
    preview = InternalMessage(
        id=0,
        message_uid="PREVIEW",
        sender_id=current_user.id,
        sender=current_user,
        message_type="official_correspondence",
        subject=payload.subject,
        body=payload.body,
        related_request_id=related_request_id,
        related_request=related_request,
        created_at=datetime.now(timezone.utc),
    )
    preview.recipients = [InternalMessageRecipient(message_id=0, recipient_id=user.id, recipient=user) for user in recipients]
    try:
        content, _ = generate_official_document(
            db,
            message=preview,
            actor=current_user,
            letterhead_template_id=payload.letterhead_template_id,
            reference_number=payload.official_reference_number,
            correspondence_type=payload.correspondence_type,
            include_signature=payload.include_signature,
            signature_id=payload.signature_id,
            include_stamp=payload.include_stamp,
            stamp_id=payload.stamp_id,
            include_in_request_pdf=payload.include_in_request_pdf,
            show_sender_department=payload.show_sender_department,
            show_recipients=payload.show_recipients,
            show_generated_by=payload.show_generated_by,
            show_generated_at=payload.show_generated_at,
            persist=False,
        )
    except Exception as error:
        handle_permission_error(error)
    write_audit(db, "official_message_pdf_previewed", "internal_message", actor=current_user)
    db.commit()
    return Response(content, media_type="application/pdf", headers={"Content-Disposition": 'inline; filename="official-preview.pdf"'})


@official_messages_router.post("/{message_id}/official/generate-pdf")
def generate_message_official_pdf(message_id: int, payload: OfficialPDFOptions, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ensure_official_message_runtime(db)
    if not seed_default_official_settings(db).enable_official_letterhead:
        raise HTTPException(status_code=403, detail="خاصية الترويسة الرسمية غير مفعلة حالياً")
    if not has_action_permission(db, current_user, "send_official_message", default=can_manage_official_assets(current_user)):
        raise HTTPException(status_code=403, detail="لا تملك صلاحية إنشاء الخطاب الرسمي")
    message = load_message_for_official_pdf(db, message_id, current_user)
    if str(message.message_type) != "official_correspondence" and not bool(message.is_official):
        raise HTTPException(status_code=422, detail="هذه الرسالة ليست مراسلة رسمية")
    try:
        _, document = generate_official_document(
            db,
            message=message,
            actor=current_user,
            letterhead_template_id=payload.letterhead_template_id,
            reference_number=payload.official_reference_number,
            correspondence_type=payload.correspondence_type,
            include_signature=payload.include_signature,
            signature_id=payload.signature_id,
            include_stamp=payload.include_stamp,
            stamp_id=payload.stamp_id,
            include_in_request_pdf=payload.include_in_request_pdf,
            show_sender_department=payload.show_sender_department,
            show_recipients=payload.show_recipients,
            show_generated_by=payload.show_generated_by,
            show_generated_at=payload.show_generated_at,
            persist=True,
        )
    except Exception as error:
        handle_permission_error(error)
    db.commit()
    return {"document_id": document.id if document else None, "message_id": message.id}


@official_messages_router.get("/{message_id}/official/pdf/download")
def download_official_pdf(message_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ensure_official_message_runtime(db)
    if not has_action_permission(db, current_user, "download_official_message_pdf", default=can_manage_official_assets(current_user)):
        raise HTTPException(status_code=403, detail="لا تملك صلاحية تحميل الخطاب الرسمي")
    message = load_message_for_official_pdf(db, message_id, current_user)
    document = None
    if message.official_pdf_document_id:
        document = db.get(OfficialMessageDocument, message.official_pdf_document_id)
    if not document:
        document = db.scalar(select(OfficialMessageDocument).where(OfficialMessageDocument.message_id == message_id).order_by(OfficialMessageDocument.generated_at.desc()))
    if not document:
        raise HTTPException(status_code=404, detail="لم يتم إنشاء PDF رسمي لهذه الرسالة")
    try:
        path = official_document_path(document)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="ملف الخطاب الرسمي غير موجود")
    write_audit(db, "official_message_pdf_downloaded", "internal_message", actor=current_user, entity_id=str(message.id), metadata={"document_id": document.id})
    db.commit()
    return FileResponse(path, media_type="application/pdf", filename=f"{message.message_uid or message.id}-official.pdf")


@official_messages_router.get("/{message_id}/official/pdf/preview")
def preview_saved_official_pdf(message_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return download_official_pdf(message_id, db, current_user)
