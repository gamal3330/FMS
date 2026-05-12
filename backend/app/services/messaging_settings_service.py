from __future__ import annotations

from datetime import datetime, timedelta, timezone
import re
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, inspect, select, text
from sqlalchemy.orm import Session, selectinload

from app.models.ai import AISettings
from app.models.audit import AuditLog
from app.models.message import InternalMessage, InternalMessageAttachment, InternalMessageRecipient
from app.models.messaging_settings import (
    MessageAISettings,
    MessageAttachmentSettings,
    MessageAutoRule,
    MessageClassification,
    MessageNotificationSettings,
    MessageRequestIntegrationSettings,
    MessageRetentionPolicy,
    MessageSecurityPolicy,
    MessageTemplate,
    MessageType,
    MessagingSettings,
)
from app.models.request import ServiceRequest
from app.models.settings import PortalSetting, SettingsGeneral
from app.models.user import Department, User


DEFAULT_MESSAGE_TYPES = [
    ("internal_message", "مراسلة داخلية", "Internal Message", "مراسلة عامة بين مستخدمي النظام", "#0d6337", "mail", False, False, False, False, False, True, 10),
    ("official_message", "مراسلة رسمية", "Official Message", "مراسلة رسمية يمكن تضمينها في PDF", "#1d4ed8", "badge-check", True, False, False, True, True, True, 20),
    ("clarification_request", "طلب استيضاح", "Clarification Request", "طلب معلومات إضافية بخصوص طلب", "#b45309", "help-circle", True, True, False, True, True, True, 30),
    ("clarification_response", "رد على استيضاح", "Clarification Response", "رد على طلب استيضاح", "#047857", "reply", True, True, False, True, True, True, 40),
    ("approval_note", "ملاحظة موافقة", "Approval Note", "ملاحظة مرتبطة بالموافقة", "#15803d", "check-circle", True, True, False, True, False, True, 50),
    ("rejection_note", "سبب رفض", "Rejection Note", "سبب رفض أو ملاحظة رفض", "#b91c1c", "x-circle", True, True, False, True, True, True, 60),
    ("execution_note", "ملاحظة تنفيذ", "Execution Note", "ملاحظة مرتبطة بتنفيذ الطلب", "#7c3aed", "wrench", True, True, False, True, False, True, 70),
    ("notification", "إشعار", "Notification", "إشعار آلي أو يدوي", "#0369a1", "bell", False, False, False, False, True, False, 80),
    ("announcement", "تعميم", "Announcement", "رسالة تعميم واسعة النطاق", "#854d0e", "megaphone", True, False, False, True, True, False, 90),
]

LEGACY_MESSAGE_TYPE_MAP = {
    "internal_message": "internal_correspondence",
    "official_message": "official_correspondence",
    "clarification_response": "reply_to_clarification",
    "rejection_note": "rejection_reason",
    "execution_note": "implementation_note",
    "announcement": "circular",
}

DEFAULT_CLASSIFICATIONS = [
    ("public", "عام", "Public", False, True, True, True, False, False),
    ("internal", "داخلي", "Internal", False, True, True, True, False, False),
    ("confidential", "سري", "Confidential", True, False, True, True, True, True),
    ("top_secret", "سري للغاية", "Top Secret", True, False, False, False, True, True),
]

DEFAULT_TEMPLATES = [
    ("طلب استيضاح", "clarification_request", "طلب استيضاح بخصوص الطلب {{request_number}}", "السلام عليكم،\n\nنرجو تزويدنا بإيضاح إضافي بخصوص الطلب {{request_number}}.\n\nمع الشكر."),
    ("نقص مرفق", "clarification_request", "نقص مرفق في الطلب {{request_number}}", "السلام عليكم،\n\nنرجو إرفاق المستند المطلوب لاستكمال معالجة الطلب {{request_number}}.\n\nمع الشكر."),
    ("تم تنفيذ الطلب", "execution_note", "تم تنفيذ الطلب {{request_number}}", "السلام عليكم،\n\nتم تنفيذ الطلب {{request_number}} بنجاح.\n\nمع الشكر."),
    ("تم رفض الطلب", "rejection_note", "تم رفض الطلب {{request_number}}", "السلام عليكم،\n\nنعتذر عن عدم قبول الطلب {{request_number}} للأسباب التالية:\n- \n\nمع الشكر."),
    ("تمت الموافقة بشرط", "approval_note", "موافقة مشروطة للطلب {{request_number}}", "السلام عليكم،\n\nتمت الموافقة على الطلب {{request_number}} بشرط استكمال التالي:\n- \n\nمع الشكر."),
    ("تعميم صيانة", "announcement", "تعميم صيانة", "السلام عليكم،\n\nنفيدكم بوجود أعمال صيانة مجدولة على الأنظمة.\n\nمع الشكر."),
]

AUTO_EVENTS = {
    "on_request_created": "طلب جديد {{request_number}}",
    "on_request_approved": "تمت الموافقة على الطلب {{request_number}}",
    "on_request_rejected": "تم رفض الطلب {{request_number}}",
    "on_request_returned": "إعادة الطلب {{request_number}} للتعديل",
    "on_request_resubmitted": "إعادة تقديم الطلب {{request_number}}",
    "on_request_completed": "تم تنفيذ الطلب {{request_number}}",
    "on_request_closed": "تم إغلاق الطلب {{request_number}}",
}


def get_singleton(db: Session, model):
    item = db.scalar(select(model).limit(1))
    if item:
        return item
    item = model()
    db.add(item)
    db.flush()
    return item


def get_global_upload_max_file_size_mb(db: Session) -> int:
    general = db.scalar(select(SettingsGeneral).limit(1))
    try:
        return max(int((general.upload_max_file_size_mb if general else 10) or 10), 1)
    except (TypeError, ValueError):
        return 10


def get_effective_message_attachment_max_mb(db: Session, message_max_mb: int | None = None) -> int:
    try:
        configured_max = max(int(message_max_mb or 25), 1)
    except (TypeError, ValueError):
        configured_max = 25
    return min(configured_max, get_global_upload_max_file_size_mb(db))


def ensure_messaging_settings_schema(db: Session) -> None:
    bind = db.get_bind()
    inspector = inspect(bind)
    if "messaging_settings" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("messaging_settings")}
    if "enable_templates" in columns:
        return
    if bind.dialect.name == "sqlite":
        db.execute(text("ALTER TABLE messaging_settings ADD COLUMN enable_templates BOOLEAN DEFAULT 1"))
    else:
        db.execute(text("ALTER TABLE messaging_settings ADD COLUMN enable_templates BOOLEAN DEFAULT TRUE"))
    db.flush()


def seed_messaging_settings(db: Session) -> None:
    ensure_messaging_settings_schema(db)
    get_singleton(db, MessagingSettings)
    get_singleton(db, MessageNotificationSettings)
    attachment_settings = get_singleton(db, MessageAttachmentSettings)
    if not attachment_settings.allowed_extensions_json:
        attachment_settings.allowed_extensions_json = ["pdf", "png", "jpg", "jpeg"]
    get_singleton(db, MessageRequestIntegrationSettings)
    get_singleton(db, MessageRetentionPolicy)
    get_singleton(db, MessageSecurityPolicy)
    get_singleton(db, MessageAISettings)
    existing_types = set(db.scalars(select(MessageType.code)).all())
    for code, name_ar, name_en, description, color, icon, is_official, requires_request, requires_attachment, show_in_pdf, visible_to_requester, allow_reply, sort_order in DEFAULT_MESSAGE_TYPES:
        if code in existing_types:
            continue
        db.add(
            MessageType(
                code=code,
                name_ar=name_ar,
                name_en=name_en,
                description=description,
                color=color,
                icon=icon,
                is_active=True,
                is_official=is_official,
                requires_request=requires_request,
                requires_attachment=requires_attachment,
                show_in_pdf=show_in_pdf,
                visible_to_requester=visible_to_requester,
                allow_reply=allow_reply,
                sort_order=sort_order,
            )
        )
    existing_classifications = set(db.scalars(select(MessageClassification.code)).all())
    for code, name_ar, name_en, restricted, show_pdf, show_reports, allow_download, log_downloads, special_permission in DEFAULT_CLASSIFICATIONS:
        if code in existing_classifications:
            continue
        db.add(
            MessageClassification(
                code=code,
                name_ar=name_ar,
                name_en=name_en,
                restricted_access=restricted,
                show_in_pdf=show_pdf,
                show_in_reports=show_reports,
                allow_attachment_download=allow_download,
                log_downloads=log_downloads,
                requires_special_permission=special_permission,
            )
        )
    db.flush()
    types_by_code = {item.code: item for item in db.scalars(select(MessageType)).all()}
    existing_templates = set(db.scalars(select(MessageTemplate.name)).all())
    for name, type_code, subject, body in DEFAULT_TEMPLATES:
        if name in existing_templates:
            continue
        db.add(MessageTemplate(name=name, message_type_id=types_by_code.get(type_code).id if types_by_code.get(type_code) else None, subject_template=subject, body_template=body, is_active=True))
    existing_rules = set(db.scalars(select(MessageAutoRule.event_code)).all())
    notification_type = types_by_code.get("notification")
    for event_code, subject in AUTO_EVENTS.items():
        if event_code in existing_rules:
            continue
        db.add(
            MessageAutoRule(
                event_code=event_code,
                is_enabled=False,
                message_type_id=notification_type.id if notification_type else None,
                subject_template=subject,
                body_template="تم تحديث حالة الطلب {{request_number}}. يرجى مراجعة تفاصيل الطلب عند الحاجة.",
            )
        )
    db.flush()


def sync_legacy_message_settings(db: Session) -> None:
    seed_messaging_settings(db)
    general = get_singleton(db, MessagingSettings)
    attachments = get_singleton(db, MessageAttachmentSettings)
    effective_attachment_max_mb = get_effective_message_attachment_max_mb(db, attachments.max_file_size_mb)
    integration = get_singleton(db, MessageRequestIntegrationSettings)
    notifications = get_singleton(db, MessageNotificationSettings)
    retention = get_singleton(db, MessageRetentionPolicy)
    ai = get_singleton(db, MessageAISettings)
    recipient_setting = db.scalar(select(PortalSetting).where(PortalSetting.category == "messaging_recipient_settings", PortalSetting.setting_key == "defaults"))
    recipient_value = recipient_setting.setting_value if recipient_setting and isinstance(recipient_setting.setting_value, dict) else {}
    allow_broadcast = bool(general.allow_broadcast_messages and recipient_value.get("allow_broadcast", False))
    allow_department_broadcast = bool(allow_broadcast and recipient_value.get("allow_send_to_department", True))
    value = {
        "module_name_ar": general.module_name_ar or "المراسلات الداخلية",
        "module_name_en": general.module_name_en or "Internal Messaging",
        "enabled": bool(general.enable_messaging),
        "enable_attachments": bool(attachments.allow_message_attachments),
        "enable_drafts": True,
        "enable_templates": bool(general.enable_templates),
        "enable_signatures": True,
        "allow_archiving": bool(general.allow_archiving and retention.allow_archiving),
        "enable_circulars": allow_broadcast,
        "enable_department_broadcasts": allow_department_broadcast,
        "enable_read_receipts": bool(general.enable_read_receipts),
        "enable_unread_badge": bool(general.enable_unread_badge and notifications.show_unread_count),
        "enable_linked_requests": bool(integration.allow_link_to_request),
        "allow_general_messages": bool(general.allow_general_messages),
        "allow_replies": bool(general.allow_replies),
        "allow_forwarding": bool(general.allow_forwarding),
        "allow_multiple_recipients": bool(general.allow_multiple_recipients and recipient_value.get("allow_multiple_recipients", True)),
        "allow_send_to_user": bool(recipient_value.get("allow_send_to_user", True)),
        "allow_send_to_department": bool(recipient_value.get("allow_send_to_department", True)),
        "allow_broadcast": allow_broadcast,
        "circular_allowed_user_ids": recipient_value.get("circular_allowed_user_ids", []),
        "enable_message_notifications": bool(notifications.enable_message_notifications),
        "notify_on_new_message": bool(notifications.notify_on_new_message),
        "notify_on_reply": bool(notifications.notify_on_reply),
        "notify_on_read": bool(notifications.notify_on_read),
        "notify_on_clarification_request": bool(notifications.notify_on_clarification_request),
        "notify_on_official_message": bool(notifications.notify_on_official_message),
        "auto_refresh_seconds": 20,
        "max_attachment_mb": effective_attachment_max_mb,
        "max_attachments_per_message": int(attachments.max_attachments_per_message or 10),
        "max_recipients": min(int(general.max_recipients or 10), int(recipient_value.get("max_recipients") or general.max_recipients or 10)) if recipient_value else int(general.max_recipients or 10),
        "default_message_type": "internal_correspondence",
        "allowed_extensions": attachments.allowed_extensions_json or ["pdf", "png", "jpg", "jpeg"],
        "message_upload_path": attachments.message_upload_path or "uploads/messages",
        "log_attachment_downloads": bool(attachments.log_attachment_downloads),
        "block_executable_files": bool(attachments.block_executable_files),
        "enable_virus_scan": bool(attachments.enable_virus_scan),
        "department_recipient_behavior": str(recipient_value.get("department_recipient_behavior") or "selected_department_users"),
        "allowed_user_ids": [],
        "blocked_user_ids": [],
        "allowed_department_ids": [],
        "blocked_department_ids": [],
        "circular_allowed_roles": [],
        "department_broadcast_allowed_roles": [],
        "department_broadcast_allowed_user_ids": [],
        "template_allowed_roles": [],
        "template_allowed_user_ids": [],
    }
    setting = db.scalar(select(PortalSetting).where(PortalSetting.category == "message_settings", PortalSetting.setting_key == "defaults"))
    if not setting:
        setting = PortalSetting(category="message_settings", setting_key="defaults", setting_value={})
        db.add(setting)
    old_value = setting.setting_value if isinstance(setting.setting_value, dict) else {}
    setting.setting_value = {
        **old_value,
        **value,
        "allow_archiving": bool(general.allow_archiving and retention.allow_archiving),
        "enable_linked_requests": bool(integration.allow_link_to_request),
        "enable_attachments": bool(attachments.allow_message_attachments),
        "max_attachment_mb": effective_attachment_max_mb,
        "max_attachments_per_message": int(attachments.max_attachments_per_message or 10),
        "enable_virus_scan": bool(attachments.enable_virus_scan),
        "max_recipients": int(general.max_recipients or 10),
    }
    type_items = []
    for item in db.scalars(select(MessageType).where(MessageType.is_active == True).order_by(MessageType.sort_order, MessageType.id)).all():
        legacy_value = LEGACY_MESSAGE_TYPE_MAP.get(item.code, item.code)
        type_items.append({"value": legacy_value, "label": item.name_ar, "is_system": item.code in {row[0] for row in DEFAULT_MESSAGE_TYPES}})
    type_setting = db.scalar(select(PortalSetting).where(PortalSetting.category == "message_types", PortalSetting.setting_key == "defaults"))
    if not type_setting:
        type_setting = PortalSetting(category="message_types", setting_key="defaults", setting_value={})
        db.add(type_setting)
    type_setting.setting_value = {"types": type_items}
    template_items = []
    for template in db.scalars(select(MessageTemplate).options(selectinload(MessageTemplate.message_type)).where(MessageTemplate.is_active == True).order_by(MessageTemplate.id)).all():
        code = template.message_type.code if template.message_type else "internal_message"
        template_items.append(
            {
                "key": f"tpl_{template.id}",
                "label": template.name,
                "message_type": LEGACY_MESSAGE_TYPE_MAP.get(code, code),
                "subject": template.subject_template.replace("{{", "{").replace("}}", "}"),
                "body": template.body_template.replace("{{", "{").replace("}}", "}"),
            }
        )
    template_setting = db.scalar(select(PortalSetting).where(PortalSetting.category == "message_templates", PortalSetting.setting_key == "defaults"))
    if not template_setting:
        template_setting = PortalSetting(category="message_templates", setting_key="defaults", setting_value={})
        db.add(template_setting)
    template_setting.setting_value = {"templates": template_items}
    global_ai = db.scalar(select(AISettings).limit(1))
    if global_ai:
        global_ai.show_in_compose_message = bool(ai.show_ai_in_compose)
        global_ai.show_in_message_details = bool(ai.show_ai_in_message_details)
        global_ai.show_in_request_messages_tab = bool(ai.show_ai_in_request_messages_tab)
        global_ai.allow_message_drafting = bool(ai.allow_ai_draft)
        global_ai.allow_message_improvement = bool(ai.allow_ai_improve or ai.allow_ai_formalize)
        global_ai.allow_reply_suggestion = bool(ai.allow_ai_suggest_reply)
        global_ai.allow_summarization = bool(ai.allow_ai_summarize_request_messages)
        global_ai.allow_missing_info_detection = bool(ai.allow_ai_detect_missing_info)
    db.flush()


def write_messaging_audit(db: Session, action: str, actor: User | None, entity_type: str = "messaging_settings", entity_id: str | None = None, metadata: dict | None = None, ip_address: str | None = None) -> None:
    db.add(AuditLog(actor_id=actor.id if actor else None, action=action, entity_type=entity_type, entity_id=entity_id, ip_address=ip_address, metadata_json=metadata or {}))


def ensure_super_admin(user: User) -> None:
    if user.role != "super_admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="هذه العملية متاحة لمدير النظام فقط")


def update_singleton(db: Session, model, payload: dict):
    item = get_singleton(db, model)
    for field, value in payload.items():
        if hasattr(item, field):
            setattr(item, field, value)
    db.flush()
    return item


def request_notification_control(db: Session) -> dict[str, bool]:
    seed_messaging_settings(db)
    integration = get_singleton(db, MessageRequestIntegrationSettings)
    return {
        "show_checkbox": bool(integration.show_request_notification_checkbox),
        "default_checked": bool(integration.default_send_request_notification),
        "allow_toggle": bool(integration.allow_requester_toggle_notification),
    }


def should_send_request_created_notification(db: Session, requested_value: bool) -> bool:
    control = request_notification_control(db)
    if not control["show_checkbox"] or not control["allow_toggle"]:
        return control["default_checked"]
    return bool(requested_value)


def message_type_used(db: Session, code: str) -> bool:
    legacy_code = LEGACY_MESSAGE_TYPE_MAP.get(code, code)
    return bool(db.scalar(select(InternalMessage.id).where(InternalMessage.message_type.in_({code, legacy_code})).limit(1)))


def delete_message_type(db: Session, item: MessageType) -> None:
    if message_type_used(db, item.code):
        item.is_active = False
        return
    db.delete(item)


def render_template_text(value: str, data: dict[str, Any]) -> str:
    text = value or ""
    for key, val in data.items():
        text = text.replace("{{" + key + "}}", str(val))
    return re.sub(r"\{\{[^}]+\}\}", "", text)


def messaging_analytics(db: Session) -> dict:
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    messages_today = db.scalar(select(func.count()).select_from(InternalMessage).where(InternalMessage.created_at >= today_start, InternalMessage.is_draft == False)) or 0
    messages_month = db.scalar(select(func.count()).select_from(InternalMessage).where(InternalMessage.created_at >= month_start, InternalMessage.is_draft == False)) or 0
    unread = db.scalar(select(func.count()).select_from(InternalMessageRecipient).where(InternalMessageRecipient.is_read == False)) or 0
    most_used = db.execute(select(InternalMessage.message_type, func.count()).where(InternalMessage.is_draft == False).group_by(InternalMessage.message_type).order_by(func.count().desc()).limit(1)).first()
    top_departments = db.execute(
        select(Department.name_ar, func.count(InternalMessage.id))
        .join(User, User.department_id == Department.id)
        .join(InternalMessage, InternalMessage.sender_id == User.id)
        .where(InternalMessage.is_draft == False)
        .group_by(Department.name_ar)
        .order_by(func.count(InternalMessage.id).desc())
        .limit(5)
    ).all()
    open_clarification = db.scalar(select(func.count()).select_from(InternalMessage).where(InternalMessage.message_type.in_(["clarification_request"]), InternalMessage.is_draft == False)) or 0
    attachments_count = db.scalar(select(func.count()).select_from(InternalMessageAttachment)) or 0
    return {
        "messages_today": int(messages_today),
        "messages_this_month": int(messages_month),
        "unread_messages": int(unread),
        "most_used_message_type": most_used[0] if most_used else None,
        "top_departments": [{"department": row[0] or "-", "count": int(row[1])} for row in top_departments],
        "open_clarification_requests": int(open_clarification),
        "average_reply_time_hours": 0,
        "attachments_count": int(attachments_count),
    }
