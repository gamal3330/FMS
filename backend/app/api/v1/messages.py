from datetime import datetime, time, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_user
from app.core.config import get_settings
from app.db.session import get_db
from app.models.message import InternalMessage, InternalMessageAttachment, InternalMessageRecipient
from app.models.enums import UserRole
from app.models.request import ServiceRequest
from app.models.settings import PortalSetting
from app.models.user import User
from app.schemas.message import InternalMessageCreate, InternalMessageDraftUpsert, InternalMessageForward, InternalMessageRead, InternalMessageReply, MessageAttachmentRead, MessageBulkAction, MessageCapabilitiesRead, MessageCounters, MessageReadReceipt, MessageSettingsRead, MessageSettingsUpdate, MessageSignatureRead, MessageSignatureUpdate, MessageTemplateRead, MessageTemplatesUpdate, MessageTypeRead, MessageTypesUpdate, MessageUserRead
from app.services.audit import write_audit

router = APIRouter(prefix="/messages", tags=["Internal Messages"])
settings = get_settings()
MAX_MESSAGE_ATTACHMENT_BYTES = 25 * 1024 * 1024
DEFAULT_MESSAGE_TYPE = "internal_correspondence"
MESSAGE_SETTINGS_DEFAULTS = {
    "enabled": True,
    "enable_attachments": True,
    "enable_drafts": True,
    "enable_templates": True,
    "enable_signatures": True,
    "enable_circulars": True,
    "enable_department_broadcasts": True,
    "enable_read_receipts": True,
    "enable_linked_requests": True,
    "auto_refresh_seconds": 20,
    "max_attachment_mb": 25,
    "max_recipients": 200,
    "default_message_type": DEFAULT_MESSAGE_TYPE,
    "allowed_user_ids": [],
    "blocked_user_ids": [],
    "allowed_department_ids": [],
    "blocked_department_ids": [],
    "circular_allowed_roles": [],
    "circular_allowed_user_ids": [],
    "department_broadcast_allowed_roles": [],
    "department_broadcast_allowed_user_ids": [],
    "template_allowed_roles": [],
    "template_allowed_user_ids": [],
}
MESSAGE_TYPE_DEFAULTS = [
    {"value": "internal_correspondence", "label": "مراسلة داخلية", "is_system": True},
    {"value": "official_correspondence", "label": "مراسلة رسمية", "is_system": True},
    {"value": "clarification_request", "label": "طلب استيضاح", "is_system": True},
    {"value": "reply_to_clarification", "label": "رد على استيضاح", "is_system": True},
    {"value": "approval_note", "label": "ملاحظة موافقة", "is_system": True},
    {"value": "rejection_reason", "label": "سبب رفض", "is_system": True},
    {"value": "implementation_note", "label": "ملاحظة تنفيذ", "is_system": True},
    {"value": "notification", "label": "إشعار", "is_system": True},
    {"value": "circular", "label": "تعميم", "is_system": True},
]
MESSAGE_TYPES = {item["value"] for item in MESSAGE_TYPE_DEFAULTS}

MESSAGE_DEFAULT_ROLES = {
    UserRole.EMPLOYEE,
    UserRole.DIRECT_MANAGER,
    UserRole.IT_STAFF,
    UserRole.IT_MANAGER,
    UserRole.INFOSEC,
    UserRole.EXECUTIVE,
    UserRole.SUPER_ADMIN,
}

MESSAGE_TEMPLATE_DEFAULTS = [
    {
        "key": "clarification_request",
        "label": "طلب استيضاح",
        "message_type": "clarification_request",
        "subject": "طلب استيضاح بخصوص الطلب {request_number}",
        "body": "السلام عليكم،\n\nنرجو تزويدنا بإيضاح إضافي بخصوص الطلب {request_number} حتى نتمكن من استكمال المعالجة.\n\nنقاط الاستيضاح:\n- \n\nمع الشكر.",
    },
    {
        "key": "rejection_reason",
        "label": "قالب الرفض",
        "message_type": "rejection_reason",
        "subject": "سبب رفض الطلب {request_number}",
        "body": "السلام عليكم،\n\nنعتذر عن عدم قبول الطلب {request_number} للأسباب التالية:\n- \n\nيمكن إعادة تقديم الطلب بعد معالجة الملاحظات المذكورة.\n\nمع الشكر.",
    },
    {
        "key": "implementation_note",
        "label": "قالب التنفيذ",
        "message_type": "implementation_note",
        "subject": "ملاحظة تنفيذ للطلب {request_number}",
        "body": "السلام عليكم،\n\nتمت مراجعة الطلب {request_number}، ونود توضيح ملاحظات التنفيذ التالية:\n- الإجراء المنفذ: \n- الملاحظات: \n- الخطوة التالية: \n\nمع الشكر.",
    },
    {
        "key": "closure_notification",
        "label": "إشعار إغلاق",
        "message_type": "notification",
        "subject": "إشعار إغلاق الطلب {request_number}",
        "body": "السلام عليكم،\n\nتم إغلاق الطلب {request_number} بعد استكمال الإجراءات المطلوبة.\n\nفي حال وجود أي ملاحظات إضافية، يرجى فتح طلب جديد أو التواصل مع القسم المختص.\n\nمع الشكر.",
    },
]


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


def can_manage_message_templates(user: User) -> bool:
    return user.role in {UserRole.SUPER_ADMIN, UserRole.IT_MANAGER}


def message_settings_setting(db: Session) -> PortalSetting | None:
    return db.scalar(select(PortalSetting).where(PortalSetting.category == "message_settings", PortalSetting.setting_key == "defaults"))


def load_message_settings(db: Session) -> dict:
    setting = message_settings_setting(db)
    value = setting.setting_value if setting and isinstance(setting.setting_value, dict) else {}
    loaded = {**MESSAGE_SETTINGS_DEFAULTS, **value}
    loaded["auto_refresh_seconds"] = min(max(int(loaded.get("auto_refresh_seconds") or 20), 5), 300)
    loaded["max_attachment_mb"] = min(max(int(loaded.get("max_attachment_mb") or 25), 1), 100)
    loaded["max_recipients"] = min(max(int(loaded.get("max_recipients") or 200), 1), 1000)
    loaded["default_message_type"] = str(loaded.get("default_message_type") or DEFAULT_MESSAGE_TYPE)
    for key in ["allowed_user_ids", "blocked_user_ids", "allowed_department_ids", "blocked_department_ids", "circular_allowed_user_ids", "department_broadcast_allowed_user_ids", "template_allowed_user_ids"]:
        value = loaded.get(key, [])
        loaded[key] = [int(item) for item in value if str(item).isdigit()] if isinstance(value, list) else []
    for key in ["circular_allowed_roles", "department_broadcast_allowed_roles", "template_allowed_roles"]:
        value = loaded.get(key, [])
        loaded[key] = [str(item) for item in value if str(item).strip()] if isinstance(value, list) else []
    return loaded


def require_message_feature(db: Session, key: str, detail: str) -> None:
    if not load_message_settings(db).get(key, True):
        raise HTTPException(status_code=403, detail=detail)


def user_allowed_by_message_scope(db: Session, user: User) -> bool:
    message_settings = load_message_settings(db)
    allowed_user_ids = set(message_settings.get("allowed_user_ids") or [])
    blocked_user_ids = set(message_settings.get("blocked_user_ids") or [])
    allowed_department_ids = set(message_settings.get("allowed_department_ids") or [])
    blocked_department_ids = set(message_settings.get("blocked_department_ids") or [])
    if user.id in blocked_user_ids:
        return False
    if user.department_id and user.department_id in blocked_department_ids:
        return False
    if allowed_user_ids or allowed_department_ids:
        return user.id in allowed_user_ids or bool(user.department_id and user.department_id in allowed_department_ids)
    return True


def user_role_value(user: User) -> str:
    return getattr(user.role, "value", str(user.role))


def user_allowed_for_message_permission(message_settings: dict, user: User, role_key: str, user_key: str) -> bool:
    allowed_roles = set(message_settings.get(role_key) or [])
    allowed_user_ids = set(message_settings.get(user_key) or [])
    if not allowed_roles and not allowed_user_ids:
        return True
    return user.id in allowed_user_ids or user_role_value(user) in allowed_roles


def can_send_circular(message_settings: dict, user: User) -> bool:
    return bool(message_settings.get("enable_circulars", True)) and user_allowed_for_message_permission(message_settings, user, "circular_allowed_roles", "circular_allowed_user_ids")


def can_send_department_broadcast(message_settings: dict, user: User) -> bool:
    return (
        bool(message_settings.get("enable_department_broadcasts", True))
        and can_send_circular(message_settings, user)
        and user_allowed_for_message_permission(message_settings, user, "department_broadcast_allowed_roles", "department_broadcast_allowed_user_ids")
    )


def can_use_message_templates(message_settings: dict, user: User) -> bool:
    return bool(message_settings.get("enable_templates", True)) and user_allowed_for_message_permission(message_settings, user, "template_allowed_roles", "template_allowed_user_ids")


def normalize_message_type_definition(raw: dict) -> dict:
    value = str(raw.get("value") or "").strip()
    label = str(raw.get("label") or "").strip()
    is_system = bool(raw.get("is_system"))
    if not value or not label:
        raise HTTPException(status_code=422, detail="كل تصنيف يحتاج رمزاً واسماً")
    if not value.replace("_", "").isalnum() or not value[0].isalpha() or value.lower() != value:
        raise HTTPException(status_code=422, detail="رمز التصنيف يجب أن يكون إنجليزياً صغيراً مثل internal_note")
    return {"value": value, "label": label, "is_system": is_system or value in MESSAGE_TYPES}


def message_type_setting(db: Session) -> PortalSetting | None:
    return db.scalar(select(PortalSetting).where(PortalSetting.category == "message_types", PortalSetting.setting_key == "defaults"))


def load_message_types(db: Session) -> list[dict]:
    types = {item["value"]: dict(item) for item in MESSAGE_TYPE_DEFAULTS}
    setting = message_type_setting(db)
    value = setting.setting_value if setting and isinstance(setting.setting_value, dict) else {}
    saved_types = value.get("types", [])
    if isinstance(saved_types, list):
        for item in saved_types:
            if not isinstance(item, dict):
                continue
            normalized = normalize_message_type_definition(item)
            types[normalized["value"]] = {**types.get(normalized["value"], {}), **normalized}
    return list(types.values())


def normalize_message_template(raw: dict) -> dict:
    return {
        "key": str(raw.get("key") or "").strip(),
        "label": str(raw.get("label") or "").strip(),
        "message_type": str(raw.get("message_type") or DEFAULT_MESSAGE_TYPE).strip(),
        "subject": str(raw.get("subject") or "").strip(),
        "body": str(raw.get("body") or "").strip(),
    }


def message_template_setting(db: Session) -> PortalSetting | None:
    return db.scalar(select(PortalSetting).where(PortalSetting.category == "message_templates", PortalSetting.setting_key == "defaults"))


def load_message_templates(db: Session) -> list[dict]:
    templates = {item["key"]: dict(item) for item in MESSAGE_TEMPLATE_DEFAULTS}
    setting = message_template_setting(db)
    value = setting.setting_value if setting and isinstance(setting.setting_value, dict) else {}
    saved_templates = value.get("templates", [])
    if isinstance(saved_templates, list):
        for item in saved_templates:
            if not isinstance(item, dict):
                continue
            normalized = normalize_message_template(item)
            if normalized["key"]:
                templates[normalized["key"]] = {**templates.get(normalized["key"], {}), **normalized}
    return list(templates.values())


def attachment_read(attachment: InternalMessageAttachment) -> MessageAttachmentRead:
    return MessageAttachmentRead(
        id=attachment.id,
        original_name=attachment.original_name,
        content_type=attachment.content_type,
        size_bytes=attachment.size_bytes,
        created_at=attachment.created_at,
    )


def read_receipt(recipient: InternalMessageRecipient) -> MessageReadReceipt:
    return MessageReadReceipt(
        recipient_id=recipient.recipient_id,
        recipient_name=recipient.recipient.full_name_ar if recipient.recipient else "-",
        is_read=bool(recipient.is_read),
        read_at=recipient.read_at,
    )


def generate_message_uid(db: Session) -> str:
    year = datetime.now(timezone.utc).year
    prefix = f"MSG-{year}-"
    last_uid = db.scalar(
        select(InternalMessage.message_uid)
        .where(InternalMessage.message_uid.like(f"{prefix}%"))
        .order_by(InternalMessage.id.desc())
        .limit(1)
    )
    next_number = 1
    if last_uid:
        try:
            next_number = int(last_uid.rsplit("-", 1)[1]) + 1
        except (IndexError, ValueError):
            next_number = 1
    while True:
        message_uid = f"{prefix}{next_number:06d}"
        exists = db.scalar(select(InternalMessage.id).where(InternalMessage.message_uid == message_uid))
        if not exists:
            return message_uid
        next_number += 1


def message_read(message: InternalMessage, current_user: User, recipient_state: InternalMessageRecipient | None = None, replies: list[InternalMessageRead] | None = None) -> InternalMessageRead:
    return InternalMessageRead(
        id=message.id,
        message_uid=message.message_uid,
        thread_id=message.thread_id or message.id,
        message_type=message.message_type or DEFAULT_MESSAGE_TYPE,
        subject=message.subject,
        body=message.body,
        sender_id=message.sender_id,
        sender_name=message.sender.full_name_ar if message.sender else "-",
        recipient_ids=[recipient.recipient_id for recipient in message.recipients],
        recipient_names=[recipient.recipient.full_name_ar for recipient in message.recipients if recipient.recipient],
        related_request_id=message.related_request_id,
        related_request_number=message.related_request.request_number if getattr(message, "related_request", None) else None,
        is_read=True if message.sender_id == current_user.id else bool(recipient_state and recipient_state.is_read),
        is_archived=bool(message.is_sender_archived) if message.sender_id == current_user.id else bool(recipient_state and recipient_state.is_archived),
        is_draft=bool(message.is_draft),
        created_at=message.created_at,
        updated_at=message.updated_at,
        attachments=[attachment_read(attachment) for attachment in message.attachments],
        read_receipts=[read_receipt(recipient) for recipient in message.recipients],
        replies=replies or [],
    )


def can_access_message(message: InternalMessage, user: User) -> bool:
    if message.is_draft:
        return message.sender_id == user.id
    return message.sender_id == user.id or any(recipient.recipient_id == user.id for recipient in message.recipients)


def load_message_with_access(db: Session, message_id: int, current_user: User) -> InternalMessage:
    message = db.scalar(
        select(InternalMessage)
        .options(
            selectinload(InternalMessage.sender),
            selectinload(InternalMessage.recipients).selectinload(InternalMessageRecipient.recipient),
            selectinload(InternalMessage.attachments),
            selectinload(InternalMessage.related_request),
        )
        .where(InternalMessage.id == message_id)
    )
    if not message or not can_access_message(message, current_user):
        raise HTTPException(status_code=404, detail="Message not found")
    return message


def thread_messages(db: Session, message: InternalMessage, current_user: User) -> list[InternalMessageRead]:
    thread_id = message.thread_id or message.id
    messages = db.scalars(
        select(InternalMessage)
        .options(
            selectinload(InternalMessage.sender),
            selectinload(InternalMessage.recipients).selectinload(InternalMessageRecipient.recipient),
            selectinload(InternalMessage.attachments),
            selectinload(InternalMessage.related_request),
        )
        .where(((InternalMessage.thread_id == thread_id) | (InternalMessage.id == thread_id)), InternalMessage.is_draft == False)
        .order_by(InternalMessage.created_at)
    ).all()
    return [message_read(item, current_user) for item in messages if item.id != message.id and can_access_message(item, current_user)]


def message_upload_dir() -> Path:
    upload_dir = Path(settings.upload_dir)
    if not upload_dir.is_absolute():
        upload_dir = Path.cwd() / upload_dir
    target = upload_dir / "messages"
    target.mkdir(parents=True, exist_ok=True)
    return target


async def save_message_attachments(db: Session, message: InternalMessage, files: list[UploadFile], current_user: User) -> None:
    message_settings = load_message_settings(db)
    if files and not message_settings.get("enable_attachments", True):
        raise HTTPException(status_code=403, detail="المرفقات غير مفعلة في إعدادات المراسلات")
    max_attachment_bytes = int(message_settings.get("max_attachment_mb") or 25) * 1024 * 1024
    target_dir = message_upload_dir()
    for file in files:
        if not file.filename:
            continue
        content = await file.read()
        if len(content) > max_attachment_bytes:
            raise HTTPException(status_code=413, detail=f"حجم المرفق أكبر من الحد المسموح {message_settings.get('max_attachment_mb')}MB")
        stored_name = f"{uuid4().hex}{Path(file.filename).suffix.lower()[:20]}"
        (target_dir / stored_name).write_bytes(content)
        db.add(
            InternalMessageAttachment(
                message_id=message.id,
                uploaded_by_id=current_user.id,
                original_name=Path(file.filename).name,
                stored_name=stored_name,
                content_type=file.content_type or "application/octet-stream",
                size_bytes=len(content),
            )
        )


def resolve_related_request_id(db: Session, related_request_ref: int | str | None) -> int | None:
    if related_request_ref is None or str(related_request_ref).strip() == "":
        return None
    ref = str(related_request_ref).strip()
    request = None
    if ref.isdigit():
        request = db.scalar(select(ServiceRequest).where((ServiceRequest.id == int(ref)) | (ServiceRequest.request_number == ref)))
    if not request:
        request = db.scalar(select(ServiceRequest).where(ServiceRequest.request_number == ref))
    if not request:
        raise HTTPException(status_code=404, detail="الطلب المرتبط غير موجود")
    return request.id


def parse_filter_date(value: str | None, end_of_day: bool = False) -> datetime | None:
    if not value:
        return None
    try:
        day = datetime.fromisoformat(value[:10]).date()
    except ValueError:
        raise HTTPException(status_code=422, detail="صيغة التاريخ غير صحيحة")
    return datetime.combine(day, time.max if end_of_day else time.min)


def normalize_message_type(value: str | None, db: Session | None = None) -> str:
    message_type = (value or DEFAULT_MESSAGE_TYPE).strip()
    allowed_types = {item["value"] for item in load_message_types(db)} if db else MESSAGE_TYPES
    if message_type not in allowed_types:
        raise HTTPException(status_code=422, detail="تصنيف الرسالة غير صحيح")
    return message_type


def authorize_message_type(db: Session, user: User, value: str | None, message_settings: dict | None = None) -> str:
    message_type = normalize_message_type(value, db)
    settings_value = message_settings or load_message_settings(db)
    if message_type == "circular" and not can_send_circular(settings_value, user):
        raise HTTPException(status_code=403, detail="لا تملك صلاحية إرسال التعاميم")
    return message_type


def resolve_message_recipients(db: Session, current_user: User, recipient_ids: list[int], require_any: bool = True) -> list[User]:
    if not user_allowed_by_message_scope(db, current_user):
        raise HTTPException(status_code=403, detail="لا يمكنك إرسال مراسلات حسب إعدادات الموظف أو الإدارة")
    clean_recipient_ids = sorted({recipient_id for recipient_id in recipient_ids if recipient_id != current_user.id})
    if require_any and not clean_recipient_ids:
        raise HTTPException(status_code=422, detail="اختر مستلماً واحداً على الأقل")
    if not clean_recipient_ids:
        return []
    max_recipients = int(load_message_settings(db).get("max_recipients") or 200)
    if len(clean_recipient_ids) > max_recipients:
        raise HTTPException(status_code=422, detail=f"عدد المستلمين أكبر من الحد المسموح {max_recipients}")
    recipients = db.scalars(select(User).where(User.id.in_(clean_recipient_ids), User.is_active == True)).all()
    if len(recipients) != len(clean_recipient_ids):
        raise HTTPException(status_code=404, detail="أحد المستلمين غير موجود أو غير نشط")
    blocked = [recipient.full_name_ar for recipient in recipients if not user_has_messages_screen(db, recipient)]
    if blocked:
        raise HTTPException(status_code=403, detail=f"المراسلات غير مفعلة للمستلم: {blocked[0]}")
    blocked_by_scope = [recipient.full_name_ar for recipient in recipients if not user_allowed_by_message_scope(db, recipient)]
    if blocked_by_scope:
        raise HTTPException(status_code=403, detail=f"المستلم خارج نطاق المراسلات المسموح: {blocked_by_scope[0]}")
    return recipients


def create_message_record(db: Session, current_user: User, recipient_ids: list[int], subject: str, body: str, related_request_id: int | str | None = None, message_type: str | None = None) -> InternalMessage:
    message_settings = load_message_settings(db)
    if not message_settings.get("enabled", True):
        raise HTTPException(status_code=403, detail="المراسلات غير مفعلة حالياً")
    authorized_message_type = authorize_message_type(db, current_user, message_type, message_settings)
    if related_request_id and not message_settings.get("enable_linked_requests", True):
        raise HTTPException(status_code=403, detail="ربط الرسائل بالطلبات غير مفعل")
    recipients = resolve_message_recipients(db, current_user, recipient_ids)
    resolved_related_request_id = resolve_related_request_id(db, related_request_id)

    message = InternalMessage(
        message_uid=generate_message_uid(db),
        sender_id=current_user.id,
        message_type=authorized_message_type,
        subject=subject.strip(),
        body=body.strip(),
        related_request_id=resolved_related_request_id,
    )
    db.add(message)
    db.flush()
    message.thread_id = message.id
    for recipient in recipients:
        db.add(InternalMessageRecipient(message_id=message.id, recipient_id=recipient.id))
    return message


def replace_message_recipients(db: Session, message: InternalMessage, recipients: list[User]) -> None:
    message.recipients.clear()
    db.flush()
    for recipient in recipients:
        db.add(InternalMessageRecipient(message_id=message.id, recipient_id=recipient.id))


@router.get("/users", response_model=list[MessageUserRead])
def list_message_users(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not user_allowed_by_message_scope(db, current_user):
        raise HTTPException(status_code=403, detail="المراسلات غير مفعلة لهذا المستخدم حسب إعدادات الموظف أو الإدارة")
    users = db.scalars(select(User).options(selectinload(User.department)).where(User.is_active == True, User.id != current_user.id).order_by(User.full_name_ar)).all()
    return [
        {
            "id": user.id,
            "full_name_ar": user.full_name_ar,
            "email": user.email,
            "role": getattr(user.role, "value", str(user.role)),
            "department_id": user.department_id,
            "department_name": user.department.name_ar if user.department else None,
        }
        for user in users
        if user_has_messages_screen(db, user) and user_allowed_by_message_scope(db, user)
    ]


@router.get("/counters", response_model=MessageCounters)
def message_counters(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    unread = db.scalar(
        select(func.count())
        .select_from(InternalMessageRecipient)
        .where(
            InternalMessageRecipient.recipient_id == current_user.id,
            InternalMessageRecipient.is_read == False,
            InternalMessageRecipient.is_archived == False,
        )
        .join(InternalMessage, InternalMessageRecipient.message_id == InternalMessage.id)
        .where(InternalMessage.is_draft == False)
    ) or 0
    return MessageCounters(unread=int(unread))


@router.get("/settings", response_model=MessageSettingsRead)
def get_message_settings(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not (user_has_messages_screen(db, current_user) or can_manage_message_templates(current_user)):
        raise HTTPException(status_code=403, detail="المراسلات غير مفعلة لهذا المستخدم")
    return load_message_settings(db)


@router.get("/capabilities", response_model=MessageCapabilitiesRead)
def get_message_capabilities(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not user_has_messages_screen(db, current_user):
        raise HTTPException(status_code=403, detail="المراسلات غير مفعلة لهذا المستخدم")
    message_settings = load_message_settings(db)
    return MessageCapabilitiesRead(
        can_send_circular=can_send_circular(message_settings, current_user),
        can_send_department_broadcast=can_send_department_broadcast(message_settings, current_user),
        can_use_templates=can_use_message_templates(message_settings, current_user),
    )


@router.put("/settings", response_model=MessageSettingsRead)
def update_message_settings(payload: MessageSettingsUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not can_manage_message_templates(current_user):
        raise HTTPException(status_code=403, detail="لا تملك صلاحية تعديل إعدادات المراسلات")
    data = payload.model_dump()
    data["default_message_type"] = normalize_message_type(data.get("default_message_type"), db)
    setting = message_settings_setting(db)
    if not setting:
        setting = PortalSetting(category="message_settings", setting_key="defaults", setting_value={}, updated_by_id=current_user.id)
        db.add(setting)
    setting.setting_value = data
    setting.updated_by_id = current_user.id
    write_audit(db, "internal_message_settings_updated", "internal_message", actor=current_user)
    db.commit()
    return load_message_settings(db)


@router.get("/types", response_model=list[MessageTypeRead])
def list_message_types(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not (user_has_messages_screen(db, current_user) or can_manage_message_templates(current_user)):
        raise HTTPException(status_code=403, detail="المراسلات غير مفعلة لهذا المستخدم")
    return load_message_types(db)


@router.put("/types", response_model=list[MessageTypeRead])
def update_message_types(payload: MessageTypesUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not can_manage_message_templates(current_user):
        raise HTTPException(status_code=403, detail="لا تملك صلاحية تعديل تصنيفات المراسلات")
    types = {item["value"]: dict(item) for item in MESSAGE_TYPE_DEFAULTS}
    for item in payload.types:
        normalized = normalize_message_type_definition(item.model_dump())
        if normalized["value"] in MESSAGE_TYPES:
            normalized["is_system"] = True
        types[normalized["value"]] = normalized
    if DEFAULT_MESSAGE_TYPE not in types:
        types[DEFAULT_MESSAGE_TYPE] = next(item for item in MESSAGE_TYPE_DEFAULTS if item["value"] == DEFAULT_MESSAGE_TYPE)
    setting = message_type_setting(db)
    if not setting:
        setting = PortalSetting(category="message_types", setting_key="defaults", setting_value={}, updated_by_id=current_user.id)
        db.add(setting)
    setting.setting_value = {"types": list(types.values())}
    setting.updated_by_id = current_user.id
    write_audit(db, "internal_message_types_updated", "internal_message", actor=current_user)
    db.commit()
    return load_message_types(db)


@router.get("/templates", response_model=list[MessageTemplateRead])
def list_message_templates(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not (user_has_messages_screen(db, current_user) or can_manage_message_templates(current_user)):
        raise HTTPException(status_code=403, detail="المراسلات غير مفعلة لهذا المستخدم")
    message_settings = load_message_settings(db)
    if not (can_use_message_templates(message_settings, current_user) or can_manage_message_templates(current_user)):
        raise HTTPException(status_code=403, detail="قوالب المراسلات غير مفعلة")
    return load_message_templates(db)


@router.put("/templates", response_model=list[MessageTemplateRead])
def update_message_templates(payload: MessageTemplatesUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not can_manage_message_templates(current_user):
        raise HTTPException(status_code=403, detail="لا تملك صلاحية تعديل قوالب المراسلات")
    templates = [normalize_message_template(item.model_dump()) for item in payload.templates if item.key.strip()]
    for template in templates:
        template["message_type"] = normalize_message_type(template["message_type"], db)
    setting = message_template_setting(db)
    if not setting:
        setting = PortalSetting(category="message_templates", setting_key="defaults", setting_value={}, updated_by_id=current_user.id)
        db.add(setting)
    setting.setting_value = {"templates": templates}
    setting.updated_by_id = current_user.id
    write_audit(db, "internal_message_templates_updated", "internal_message", actor=current_user)
    db.commit()
    return load_message_templates(db)


@router.get("/inbox", response_model=list[InternalMessageRead])
def inbox(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    search: str | None = None,
    unread_only: bool = Query(default=False),
    archived: bool = Query(default=False),
    related_request_id: int | None = None,
    related_request: str | None = None,
    sender_id: int | None = None,
    message_type: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    stmt = (
        select(InternalMessageRecipient)
        .options(
            selectinload(InternalMessageRecipient.message).selectinload(InternalMessage.sender),
            selectinload(InternalMessageRecipient.message).selectinload(InternalMessage.recipients).selectinload(InternalMessageRecipient.recipient),
            selectinload(InternalMessageRecipient.message).selectinload(InternalMessage.attachments),
            selectinload(InternalMessageRecipient.message).selectinload(InternalMessage.related_request),
        )
        .where(InternalMessageRecipient.recipient_id == current_user.id, InternalMessageRecipient.is_archived == archived, InternalMessage.is_draft == False)
        .join(InternalMessage, InternalMessageRecipient.message_id == InternalMessage.id)
        .order_by(InternalMessage.created_at.desc())
    )
    if unread_only:
        stmt = stmt.where(InternalMessageRecipient.is_read == False)
    if search:
        stmt = stmt.where(InternalMessage.message_uid.ilike(f"%{search}%") | InternalMessage.subject.ilike(f"%{search}%") | InternalMessage.body.ilike(f"%{search}%"))
    if related_request_id or related_request:
        stmt = stmt.where(InternalMessage.related_request_id == resolve_related_request_id(db, related_request_id or related_request))
    if sender_id:
        stmt = stmt.where(InternalMessage.sender_id == sender_id)
    if message_type:
        stmt = stmt.where(InternalMessage.message_type == normalize_message_type(message_type, db))
    if date_from:
        stmt = stmt.where(InternalMessage.created_at >= parse_filter_date(date_from))
    if date_to:
        stmt = stmt.where(InternalMessage.created_at <= parse_filter_date(date_to, end_of_day=True))
    rows = db.scalars(stmt.offset(offset).limit(limit)).all()
    return [message_read(row.message, current_user, row) for row in rows]


@router.get("/sent", response_model=list[InternalMessageRead])
def sent(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    search: str | None = None,
    archived: bool = Query(default=False),
    related_request_id: int | None = None,
    related_request: str | None = None,
    message_type: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    stmt = (
        select(InternalMessage)
        .options(
            selectinload(InternalMessage.sender),
            selectinload(InternalMessage.recipients).selectinload(InternalMessageRecipient.recipient),
            selectinload(InternalMessage.attachments),
            selectinload(InternalMessage.related_request),
        )
        .where(InternalMessage.sender_id == current_user.id, InternalMessage.is_sender_archived == archived, InternalMessage.is_draft == False)
        .order_by(InternalMessage.created_at.desc())
    )
    if search:
        stmt = stmt.where(InternalMessage.message_uid.ilike(f"%{search}%") | InternalMessage.subject.ilike(f"%{search}%") | InternalMessage.body.ilike(f"%{search}%"))
    if related_request_id or related_request:
        stmt = stmt.where(InternalMessage.related_request_id == resolve_related_request_id(db, related_request_id or related_request))
    if message_type:
        stmt = stmt.where(InternalMessage.message_type == normalize_message_type(message_type, db))
    if date_from:
        stmt = stmt.where(InternalMessage.created_at >= parse_filter_date(date_from))
    if date_to:
        stmt = stmt.where(InternalMessage.created_at <= parse_filter_date(date_to, end_of_day=True))
    return [message_read(message, current_user) for message in db.scalars(stmt.offset(offset).limit(limit)).all()]


@router.get("/drafts", response_model=list[InternalMessageRead])
def drafts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    search: str | None = None,
    message_type: str | None = None,
    related_request: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    stmt = (
        select(InternalMessage)
        .options(
            selectinload(InternalMessage.sender),
            selectinload(InternalMessage.recipients).selectinload(InternalMessageRecipient.recipient),
            selectinload(InternalMessage.attachments),
            selectinload(InternalMessage.related_request),
        )
        .where(InternalMessage.sender_id == current_user.id, InternalMessage.is_draft == True)
        .order_by(InternalMessage.updated_at.desc(), InternalMessage.created_at.desc())
    )
    if search:
        stmt = stmt.where(InternalMessage.message_uid.ilike(f"%{search}%") | InternalMessage.subject.ilike(f"%{search}%") | InternalMessage.body.ilike(f"%{search}%"))
    if message_type:
        stmt = stmt.where(InternalMessage.message_type == normalize_message_type(message_type, db))
    if related_request:
        stmt = stmt.where(InternalMessage.related_request_id == resolve_related_request_id(db, related_request))
    if date_from:
        stmt = stmt.where(InternalMessage.created_at >= parse_filter_date(date_from))
    if date_to:
        stmt = stmt.where(InternalMessage.created_at <= parse_filter_date(date_to, end_of_day=True))
    return [message_read(message, current_user) for message in db.scalars(stmt.offset(offset).limit(limit)).all()]


@router.post("/drafts", response_model=InternalMessageRead, status_code=status.HTTP_201_CREATED)
def create_draft(payload: InternalMessageDraftUpsert, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_message_feature(db, "enable_drafts", "المسودات غير مفعلة في إعدادات المراسلات")
    recipients = resolve_message_recipients(db, current_user, payload.recipient_ids, require_any=False)
    resolved_related_request_id = resolve_related_request_id(db, payload.related_request_id)
    draft = InternalMessage(
        message_uid=generate_message_uid(db),
        sender_id=current_user.id,
        message_type=authorize_message_type(db, current_user, payload.message_type),
        subject=payload.subject.strip(),
        body=payload.body.strip(),
        related_request_id=resolved_related_request_id,
        is_draft=True,
    )
    db.add(draft)
    db.flush()
    draft.thread_id = draft.id
    for recipient in recipients:
        db.add(InternalMessageRecipient(message_id=draft.id, recipient_id=recipient.id))
    write_audit(db, "internal_message_draft_created", "internal_message", actor=current_user, entity_id=str(draft.id))
    db.commit()
    return message_read(load_message_with_access(db, draft.id, current_user), current_user)


@router.post("/drafts/with-attachments", response_model=InternalMessageRead, status_code=status.HTTP_201_CREATED)
async def create_draft_with_attachments(
    recipient_ids: str = Form(default=""),
    message_type: str = Form(default=DEFAULT_MESSAGE_TYPE),
    subject: str = Form(default=""),
    body: str = Form(default=""),
    related_request_id: str | None = Form(default=None),
    attachments: list[UploadFile] = File(default=[]),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_message_feature(db, "enable_drafts", "المسودات غير مفعلة في إعدادات المراسلات")
    ids = [int(value) for value in recipient_ids.split(",") if value.strip().isdigit()]
    recipients = resolve_message_recipients(db, current_user, ids, require_any=False)
    draft = InternalMessage(
        message_uid=generate_message_uid(db),
        sender_id=current_user.id,
        message_type=authorize_message_type(db, current_user, message_type),
        subject=subject.strip(),
        body=body.strip(),
        related_request_id=resolve_related_request_id(db, related_request_id),
        is_draft=True,
    )
    db.add(draft)
    db.flush()
    draft.thread_id = draft.id
    for recipient in recipients:
        db.add(InternalMessageRecipient(message_id=draft.id, recipient_id=recipient.id))
    await save_message_attachments(db, draft, attachments, current_user)
    write_audit(db, "internal_message_draft_created", "internal_message", actor=current_user, entity_id=str(draft.id), metadata={"attachments": len(attachments)})
    db.commit()
    return message_read(load_message_with_access(db, draft.id, current_user), current_user)


@router.put("/drafts/{draft_id}", response_model=InternalMessageRead)
def update_draft(draft_id: int, payload: InternalMessageDraftUpsert, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_message_feature(db, "enable_drafts", "المسودات غير مفعلة في إعدادات المراسلات")
    draft = load_message_with_access(db, draft_id, current_user)
    if not draft.is_draft or draft.sender_id != current_user.id:
        raise HTTPException(status_code=404, detail="Draft not found")
    recipients = resolve_message_recipients(db, current_user, payload.recipient_ids, require_any=False)
    draft.subject = payload.subject.strip()
    draft.message_type = authorize_message_type(db, current_user, payload.message_type)
    draft.body = payload.body.strip()
    draft.related_request_id = resolve_related_request_id(db, payload.related_request_id)
    draft.updated_at = datetime.now(timezone.utc)
    replace_message_recipients(db, draft, recipients)
    write_audit(db, "internal_message_draft_updated", "internal_message", actor=current_user, entity_id=str(draft.id))
    db.commit()
    return message_read(load_message_with_access(db, draft.id, current_user), current_user)


@router.post("/drafts/{draft_id}/send", response_model=InternalMessageRead)
def send_draft(draft_id: int, payload: InternalMessageDraftUpsert, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_message_feature(db, "enable_drafts", "المسودات غير مفعلة في إعدادات المراسلات")
    draft = load_message_with_access(db, draft_id, current_user)
    if not draft.is_draft or draft.sender_id != current_user.id:
        raise HTTPException(status_code=404, detail="Draft not found")
    subject = payload.subject.strip()
    body = payload.body.strip()
    if len(subject) < 2:
        raise HTTPException(status_code=422, detail="اكتب موضوع الرسالة")
    if not body:
        raise HTTPException(status_code=422, detail="اكتب محتوى الرسالة")
    recipients = resolve_message_recipients(db, current_user, payload.recipient_ids, require_any=True)
    draft.subject = subject
    draft.message_type = authorize_message_type(db, current_user, payload.message_type)
    draft.body = body
    draft.related_request_id = resolve_related_request_id(db, payload.related_request_id)
    draft.is_draft = False
    draft.updated_at = datetime.now(timezone.utc)
    replace_message_recipients(db, draft, recipients)
    write_audit(db, "internal_message_draft_sent", "internal_message", actor=current_user, entity_id=str(draft.id))
    db.commit()
    return message_read(load_message_with_access(db, draft.id, current_user), current_user)


@router.delete("/drafts/{draft_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_draft(draft_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_message_feature(db, "enable_drafts", "المسودات غير مفعلة في إعدادات المراسلات")
    draft = load_message_with_access(db, draft_id, current_user)
    if not draft.is_draft or draft.sender_id != current_user.id:
        raise HTTPException(status_code=404, detail="Draft not found")
    db.delete(draft)
    write_audit(db, "internal_message_draft_deleted", "internal_message", actor=current_user, entity_id=str(draft_id))
    db.commit()


@router.get("/request/{request_id}", response_model=list[InternalMessageRead])
def request_messages(request_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    stmt = (
        select(InternalMessage)
        .options(
            selectinload(InternalMessage.sender),
            selectinload(InternalMessage.recipients).selectinload(InternalMessageRecipient.recipient),
            selectinload(InternalMessage.attachments),
            selectinload(InternalMessage.related_request),
        )
        .where(InternalMessage.related_request_id == request_id, InternalMessage.is_draft == False)
        .order_by(InternalMessage.created_at.desc())
    )
    return [message_read(message, current_user) for message in db.scalars(stmt.limit(100)).all() if can_access_message(message, current_user)]


@router.post("", response_model=InternalMessageRead, status_code=status.HTTP_201_CREATED)
def send_message(payload: InternalMessageCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    message = create_message_record(db, current_user, payload.recipient_ids, payload.subject, payload.body, payload.related_request_id, payload.message_type)
    write_audit(db, "internal_message_sent", "internal_message", actor=current_user, entity_id=str(message.id))
    db.commit()
    message = db.scalar(
        select(InternalMessage)
        .options(
            selectinload(InternalMessage.sender),
            selectinload(InternalMessage.recipients).selectinload(InternalMessageRecipient.recipient),
            selectinload(InternalMessage.attachments),
            selectinload(InternalMessage.related_request),
        )
        .where(InternalMessage.id == message.id)
    )
    return message_read(message, current_user)


@router.post("/with-attachments", response_model=InternalMessageRead, status_code=status.HTTP_201_CREATED)
async def send_message_with_attachments(
    recipient_ids: str = Form(...),
    message_type: str = Form(default=DEFAULT_MESSAGE_TYPE),
    subject: str = Form(...),
    body: str = Form(...),
    related_request_id: str | None = Form(default=None),
    attachments: list[UploadFile] = File(default=[]),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ids = [int(value) for value in recipient_ids.split(",") if value.strip().isdigit()]
    message = create_message_record(db, current_user, ids, subject, body, related_request_id, message_type)
    await save_message_attachments(db, message, attachments, current_user)
    write_audit(
        db,
        "internal_message_sent",
        "internal_message",
        actor=current_user,
        entity_id=str(message.id),
        metadata={"attachments": len(attachments), "related_request_id": related_request_id},
    )
    db.commit()
    return message_read(load_message_with_access(db, message.id, current_user), current_user)


@router.post("/bulk/archive", status_code=status.HTTP_204_NO_CONTENT)
def bulk_archive_messages(payload: MessageBulkAction, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    messages = db.scalars(
        select(InternalMessage)
        .options(selectinload(InternalMessage.recipients))
        .where(InternalMessage.id.in_(payload.message_ids))
    ).all()
    changed = 0
    for message in messages:
        if not can_access_message(message, current_user) or message.is_draft:
            continue
        if message.sender_id == current_user.id:
            message.is_sender_archived = True
            changed += 1
            continue
        row = next((recipient for recipient in message.recipients if recipient.recipient_id == current_user.id), None)
        if row:
            row.is_archived = True
            changed += 1
    write_audit(db, "internal_messages_bulk_archived", "internal_message", actor=current_user, metadata={"count": changed})
    db.commit()


@router.post("/bulk/read", status_code=status.HTTP_204_NO_CONTENT)
def bulk_mark_read(payload: MessageBulkAction, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = db.scalars(
        select(InternalMessageRecipient)
        .where(
            InternalMessageRecipient.message_id.in_(payload.message_ids),
            InternalMessageRecipient.recipient_id == current_user.id,
        )
    ).all()
    now = datetime.now(timezone.utc)
    for row in rows:
        if not row.is_read:
            row.is_read = True
            row.read_at = now
    write_audit(db, "internal_messages_bulk_read", "internal_message", actor=current_user, metadata={"count": len(rows)})
    db.commit()


@router.post("/drafts/bulk-delete", status_code=status.HTTP_204_NO_CONTENT)
def bulk_delete_drafts(payload: MessageBulkAction, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    drafts = db.scalars(select(InternalMessage).where(InternalMessage.id.in_(payload.message_ids), InternalMessage.sender_id == current_user.id, InternalMessage.is_draft == True)).all()
    for draft in drafts:
        db.delete(draft)
    write_audit(db, "internal_message_drafts_bulk_deleted", "internal_message", actor=current_user, metadata={"count": len(drafts)})
    db.commit()


@router.get("/signature", response_model=MessageSignatureRead)
def get_message_signature(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_message_feature(db, "enable_signatures", "التواقيع غير مفعلة في إعدادات المراسلات")
    setting = db.scalar(select(PortalSetting).where(PortalSetting.category == "message_signatures", PortalSetting.setting_key == str(current_user.id)))
    value = setting.setting_value if setting and isinstance(setting.setting_value, dict) else {}
    return MessageSignatureRead(signature=str(value.get("signature") or ""))


@router.put("/signature", response_model=MessageSignatureRead)
def update_message_signature(payload: MessageSignatureUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_message_feature(db, "enable_signatures", "التواقيع غير مفعلة في إعدادات المراسلات")
    setting = db.scalar(select(PortalSetting).where(PortalSetting.category == "message_signatures", PortalSetting.setting_key == str(current_user.id)))
    if not setting:
        setting = PortalSetting(category="message_signatures", setting_key=str(current_user.id), setting_value={}, updated_by_id=current_user.id)
        db.add(setting)
    setting.setting_value = {"signature": payload.signature.strip()}
    setting.updated_by_id = current_user.id
    write_audit(db, "internal_message_signature_updated", "internal_message", actor=current_user)
    db.commit()
    return MessageSignatureRead(signature=setting.setting_value["signature"])


@router.get("/{message_id}", response_model=InternalMessageRead)
def get_message(message_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    message = load_message_with_access(db, message_id, current_user)
    recipient_state = next((recipient for recipient in message.recipients if recipient.recipient_id == current_user.id), None)
    return message_read(message, current_user, recipient_state, thread_messages(db, message, current_user))


@router.post("/{message_id}/reply", response_model=InternalMessageRead, status_code=status.HTTP_201_CREATED)
def reply_message(message_id: int, payload: InternalMessageReply, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    original = load_message_with_access(db, message_id, current_user)
    participant_ids = {original.sender_id, *(recipient.recipient_id for recipient in original.recipients)}
    participant_ids.discard(current_user.id)
    if not participant_ids:
        raise HTTPException(status_code=422, detail="لا يوجد مستلم للرد")
    reply = InternalMessage(
        message_uid=generate_message_uid(db),
        thread_id=original.thread_id or original.id,
        sender_id=current_user.id,
        message_type=authorize_message_type(db, current_user, payload.message_type),
        subject=original.subject if original.subject.startswith("رد:") else f"رد: {original.subject}",
        body=payload.body.strip(),
        related_request_id=original.related_request_id,
    )
    db.add(reply)
    db.flush()
    for recipient_id in sorted(participant_ids):
        db.add(InternalMessageRecipient(message_id=reply.id, recipient_id=recipient_id))
    write_audit(db, "internal_message_replied", "internal_message", actor=current_user, entity_id=str(reply.id))
    db.commit()
    reply = load_message_with_access(db, reply.id, current_user)
    return message_read(reply, current_user)


@router.post("/{message_id}/reply-with-attachments", response_model=InternalMessageRead, status_code=status.HTTP_201_CREATED)
async def reply_message_with_attachments(
    message_id: int,
    body: str = Form(...),
    message_type: str = Form(default="reply_to_clarification"),
    attachments: list[UploadFile] = File(default=[]),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    original = load_message_with_access(db, message_id, current_user)
    participant_ids = {original.sender_id, *(recipient.recipient_id for recipient in original.recipients)}
    participant_ids.discard(current_user.id)
    if not participant_ids:
        raise HTTPException(status_code=422, detail="لا يوجد مستلم للرد")
    reply = InternalMessage(
        message_uid=generate_message_uid(db),
        thread_id=original.thread_id or original.id,
        sender_id=current_user.id,
        message_type=authorize_message_type(db, current_user, message_type),
        subject=original.subject if original.subject.startswith("رد:") else f"رد: {original.subject}",
        body=body.strip(),
        related_request_id=original.related_request_id,
    )
    db.add(reply)
    db.flush()
    for recipient_id in sorted(participant_ids):
        db.add(InternalMessageRecipient(message_id=reply.id, recipient_id=recipient_id))
    await save_message_attachments(db, reply, attachments, current_user)
    write_audit(db, "internal_message_replied", "internal_message", actor=current_user, entity_id=str(reply.id), metadata={"attachments": len(attachments)})
    db.commit()
    return message_read(load_message_with_access(db, reply.id, current_user), current_user)


@router.post("/{message_id}/forward", response_model=InternalMessageRead, status_code=status.HTTP_201_CREATED)
def forward_message(message_id: int, payload: InternalMessageForward, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    original = load_message_with_access(db, message_id, current_user)
    note = payload.note.strip() if payload.note else ""
    original_created = original.created_at.strftime("%Y-%m-%d %H:%M") if original.created_at else "-"
    forwarded_body = "\n".join(
        part
        for part in [
            note,
            "---------- رسالة محولة ----------",
            f"من: {original.sender.full_name_ar if original.sender else '-'}",
            f"التاريخ: {original_created}",
            f"الموضوع: {original.subject}",
            "",
            original.body,
        ]
        if part is not None
    )
    forward = create_message_record(
        db,
        current_user,
        payload.recipient_ids,
        original.subject if original.subject.startswith("تحويل:") else f"تحويل: {original.subject}",
        forwarded_body,
        original.related_request_id,
        payload.message_type,
    )
    write_audit(
        db,
        "internal_message_forwarded",
        "internal_message",
        actor=current_user,
        entity_id=str(forward.id),
        metadata={"original_message_id": original.id},
    )
    db.commit()
    return message_read(load_message_with_access(db, forward.id, current_user), current_user)


@router.post("/{message_id}/read", response_model=InternalMessageRead)
def mark_read(message_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    row = db.scalar(
        select(InternalMessageRecipient)
        .options(
            selectinload(InternalMessageRecipient.message).selectinload(InternalMessage.sender),
            selectinload(InternalMessageRecipient.message).selectinload(InternalMessage.recipients).selectinload(InternalMessageRecipient.recipient),
        )
        .where(InternalMessageRecipient.message_id == message_id, InternalMessageRecipient.recipient_id == current_user.id)
    )
    if not row:
        raise HTTPException(status_code=404, detail="Message not found")
    if not row.is_read:
        row.is_read = True
        row.read_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(row)
    return message_read(row.message, current_user, row)


@router.delete("/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
def archive_message(message_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    row = db.scalar(select(InternalMessageRecipient).where(InternalMessageRecipient.message_id == message_id, InternalMessageRecipient.recipient_id == current_user.id))
    if not row:
        raise HTTPException(status_code=404, detail="Message not found")
    row.is_archived = True
    write_audit(db, "internal_message_archived", "internal_message", actor=current_user, entity_id=str(message_id))
    db.commit()


@router.post("/{message_id}/archive", status_code=status.HTTP_204_NO_CONTENT)
def archive_any_message(message_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    message = load_message_with_access(db, message_id, current_user)
    if message.sender_id == current_user.id:
        message.is_sender_archived = True
    else:
        row = next((recipient for recipient in message.recipients if recipient.recipient_id == current_user.id), None)
        if not row:
            raise HTTPException(status_code=404, detail="Message not found")
        row.is_archived = True
    write_audit(db, "internal_message_archived", "internal_message", actor=current_user, entity_id=str(message_id))
    db.commit()


@router.post("/{message_id}/restore", status_code=status.HTTP_204_NO_CONTENT)
def restore_message(message_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    message = load_message_with_access(db, message_id, current_user)
    if message.sender_id == current_user.id:
        message.is_sender_archived = False
    else:
        row = next((recipient for recipient in message.recipients if recipient.recipient_id == current_user.id), None)
        if not row:
            raise HTTPException(status_code=404, detail="Message not found")
        row.is_archived = False
    write_audit(db, "internal_message_restored", "internal_message", actor=current_user, entity_id=str(message_id))
    db.commit()


@router.get("/{message_id}/attachments/{attachment_id}/download")
def download_attachment(message_id: int, attachment_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    message = load_message_with_access(db, message_id, current_user)
    attachment = next((item for item in message.attachments if item.id == attachment_id), None)
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    path = message_upload_dir() / attachment.stored_name
    if not path.exists():
        raise HTTPException(status_code=404, detail="Attachment file not found")
    write_audit(db, "internal_message_attachment_downloaded", "internal_message", actor=current_user, entity_id=str(message_id), metadata={"attachment_id": attachment_id})
    db.commit()
    return FileResponse(path, media_type=attachment.content_type, filename=attachment.original_name)
