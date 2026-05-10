from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import require_roles
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.audit import AuditLog
from app.models.ai import AISettings
from app.models.enums import UserRole
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
from app.models.settings import PortalSetting
from app.models.user import User
from app.schemas.messaging_settings import (
    MessageAISettingsPayload,
    MessageAISettingsRead,
    MessageAnalyticsRead,
    MessageAttachmentSettingsPayload,
    MessageAttachmentSettingsRead,
    MessageAuditLogRead,
    MessageAutoRulePayload,
    MessageAutoRuleRead,
    MessageClassificationPayload,
    MessageClassificationRead,
    MessageNotificationSettingsPayload,
    MessageNotificationSettingsRead,
    MessageRecipientsPayload,
    MessageRequestIntegrationPayload,
    MessageRequestIntegrationRead,
    MessageRequestNotificationControlRead,
    MessageRetentionPolicyPayload,
    MessageRetentionPolicyRead,
    MessageSecurityPolicyPayload,
    MessageSecurityPolicyRead,
    MessageTemplatePayload,
    MessageTemplatePreviewRequest,
    MessageTemplatePreviewResponse,
    MessageTemplateRead,
    MessageTypePayload,
    MessageTypeRead,
    MessagingSettingsPayload,
    MessagingSettingsRead,
)
from app.services.messaging_settings_service import (
    delete_message_type,
    get_global_upload_max_file_size_mb,
    get_singleton,
    message_type_used,
    messaging_analytics,
    request_notification_control,
    render_template_text,
    seed_messaging_settings,
    sync_legacy_message_settings,
    update_singleton,
    write_messaging_audit,
)

router = APIRouter(prefix="/settings/messaging", tags=["Messaging Settings"])

ViewActor = Depends(require_roles(UserRole.IT_MANAGER))
EditActor = Depends(require_roles(UserRole.SUPER_ADMIN))


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def commit_with_audit(db: Session, request: Request, actor: User, action: str, entity_type: str = "messaging_settings", entity_id: str | None = None, metadata: dict | None = None) -> None:
    write_messaging_audit(db, action, actor, entity_type=entity_type, entity_id=entity_id, metadata=metadata, ip_address=client_ip(request))
    sync_legacy_message_settings(db)
    db.commit()


def message_type_read(item: MessageType) -> MessageTypeRead:
    return MessageTypeRead.model_validate(item)


def classification_read(item: MessageClassification) -> MessageClassificationRead:
    return MessageClassificationRead.model_validate(item)


def template_read(item: MessageTemplate) -> MessageTemplateRead:
    return MessageTemplateRead(
        id=item.id,
        name=item.name,
        message_type_id=item.message_type_id,
        message_type_name=item.message_type.name_ar if item.message_type else None,
        message_type_code=item.message_type.code if item.message_type else None,
        subject_template=item.subject_template,
        body_template=item.body_template,
        is_active=item.is_active,
        created_by=item.created_by,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def auto_rule_read(item: MessageAutoRule) -> MessageAutoRuleRead:
    return MessageAutoRuleRead(
        id=item.id,
        event_code=item.event_code,
        is_enabled=item.is_enabled,
        message_type_id=item.message_type_id,
        message_type_name=item.message_type.name_ar if item.message_type else None,
        subject_template=item.subject_template,
        body_template=item.body_template,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def ensure_seeded(db: Session) -> None:
    seed_messaging_settings(db)
    db.commit()


@router.get("", response_model=MessagingSettingsRead)
def get_messaging_settings(db: Session = Depends(get_db), _: User = ViewActor):
    ensure_seeded(db)
    item = get_singleton(db, MessagingSettings)
    db.refresh(item)
    return item


@router.put("", response_model=MessagingSettingsRead)
def update_messaging_settings(payload: MessagingSettingsPayload, request: Request, db: Session = Depends(get_db), actor: User = EditActor):
    item = update_singleton(db, MessagingSettings, payload.model_dump())
    commit_with_audit(db, request, actor, "messaging_settings_updated", entity_id=str(item.id), metadata=payload.model_dump())
    db.refresh(item)
    return item


@router.get("/message-types", response_model=list[MessageTypeRead])
def list_message_types(db: Session = Depends(get_db), _: User = ViewActor):
    ensure_seeded(db)
    rows = db.scalars(select(MessageType).order_by(MessageType.sort_order, MessageType.id)).all()
    return [message_type_read(row) for row in rows]


@router.post("/message-types", response_model=MessageTypeRead, status_code=status.HTTP_201_CREATED)
def create_message_type(payload: MessageTypePayload, request: Request, db: Session = Depends(get_db), actor: User = EditActor):
    if db.scalar(select(MessageType.id).where(MessageType.code == payload.code)):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="رمز نوع الرسالة مستخدم مسبقاً")
    item = MessageType(**payload.model_dump())
    db.add(item)
    db.flush()
    commit_with_audit(db, request, actor, "message_type_created", "message_type", str(item.id), {"code": item.code})
    db.refresh(item)
    return message_type_read(item)


@router.put("/message-types/{item_id}", response_model=MessageTypeRead)
def update_message_type(item_id: int, payload: MessageTypePayload, request: Request, db: Session = Depends(get_db), actor: User = EditActor):
    item = db.get(MessageType, item_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="نوع الرسالة غير موجود")
    duplicate = db.scalar(select(MessageType.id).where(MessageType.code == payload.code, MessageType.id != item_id))
    if duplicate:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="رمز نوع الرسالة مستخدم مسبقاً")
    if item.code == "internal_message" and payload.show_in_pdf and not item.show_in_pdf:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="لا يمكن إظهار المراسلات الداخلية في PDF إلا بعد مراجعة سياسة السرية")
    for field, value in payload.model_dump().items():
        setattr(item, field, value)
    commit_with_audit(db, request, actor, "message_type_updated", "message_type", str(item.id), {"code": item.code})
    db.refresh(item)
    return message_type_read(item)


@router.delete("/message-types/{item_id}")
def delete_message_type_endpoint(item_id: int, request: Request, db: Session = Depends(get_db), actor: User = EditActor):
    item = db.get(MessageType, item_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="نوع الرسالة غير موجود")
    used = message_type_used(db, item.code)
    delete_message_type(db, item)
    commit_with_audit(db, request, actor, "message_type_disabled" if used else "message_type_deleted", "message_type", str(item.id), {"code": item.code, "used": used})
    return {"ok": True, "disabled_only": used}


@router.patch("/message-types/{item_id}/status", response_model=MessageTypeRead)
def update_message_type_status(item_id: int, payload: dict, request: Request, db: Session = Depends(get_db), actor: User = EditActor):
    item = db.get(MessageType, item_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="نوع الرسالة غير موجود")
    next_status = bool(payload.get("is_active"))
    if not next_status:
        active_count = db.scalar(select(MessageType.id).where(MessageType.is_active == True, MessageType.id != item.id).limit(1))
        if not active_count:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="لا يمكن تعطيل جميع أنواع الرسائل")
    item.is_active = next_status
    commit_with_audit(db, request, actor, "message_type_status_updated", "message_type", str(item.id), {"is_active": item.is_active})
    db.refresh(item)
    return message_type_read(item)


@router.get("/classifications", response_model=list[MessageClassificationRead])
def list_classifications(db: Session = Depends(get_db), _: User = ViewActor):
    ensure_seeded(db)
    rows = db.scalars(select(MessageClassification).order_by(MessageClassification.id)).all()
    return [classification_read(row) for row in rows]


@router.post("/classifications", response_model=MessageClassificationRead, status_code=status.HTTP_201_CREATED)
def create_classification(payload: MessageClassificationPayload, request: Request, db: Session = Depends(get_db), actor: User = EditActor):
    if db.scalar(select(MessageClassification.id).where(MessageClassification.code == payload.code)):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="رمز التصنيف مستخدم مسبقاً")
    data = payload.model_dump()
    if data["code"] in {"confidential", "top_secret"} or data["restricted_access"]:
        data["log_downloads"] = True
    item = MessageClassification(**data)
    db.add(item)
    db.flush()
    commit_with_audit(db, request, actor, "message_classification_created", "message_classification", str(item.id), {"code": item.code})
    db.refresh(item)
    return classification_read(item)


@router.put("/classifications/{item_id}", response_model=MessageClassificationRead)
def update_classification(item_id: int, payload: MessageClassificationPayload, request: Request, db: Session = Depends(get_db), actor: User = EditActor):
    item = db.get(MessageClassification, item_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="تصنيف السرية غير موجود")
    duplicate = db.scalar(select(MessageClassification.id).where(MessageClassification.code == payload.code, MessageClassification.id != item_id))
    if duplicate:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="رمز التصنيف مستخدم مسبقاً")
    data = payload.model_dump()
    if data["code"] in {"confidential", "top_secret"} or data["restricted_access"]:
        data["log_downloads"] = True
    for field, value in data.items():
        setattr(item, field, value)
    commit_with_audit(db, request, actor, "message_classification_updated", "message_classification", str(item.id), {"code": item.code})
    db.refresh(item)
    return classification_read(item)


@router.delete("/classifications/{item_id}")
def delete_classification(item_id: int, request: Request, db: Session = Depends(get_db), actor: User = EditActor):
    item = db.get(MessageClassification, item_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="تصنيف السرية غير موجود")
    db.delete(item)
    commit_with_audit(db, request, actor, "message_classification_deleted", "message_classification", str(item_id))
    return {"ok": True}


@router.get("/request-integration", response_model=MessageRequestIntegrationRead)
def get_request_integration(db: Session = Depends(get_db), _: User = ViewActor):
    ensure_seeded(db)
    return get_singleton(db, MessageRequestIntegrationSettings)


@router.get("/request-notification-control", response_model=MessageRequestNotificationControlRead)
def get_request_notification_control(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return MessageRequestNotificationControlRead(**request_notification_control(db))


@router.put("/request-integration", response_model=MessageRequestIntegrationRead)
def update_request_integration(payload: MessageRequestIntegrationPayload, request: Request, db: Session = Depends(get_db), actor: User = EditActor):
    item = update_singleton(db, MessageRequestIntegrationSettings, payload.model_dump())
    commit_with_audit(db, request, actor, "message_request_integration_updated", entity_id=str(item.id), metadata=payload.model_dump())
    db.refresh(item)
    return item


@router.get("/auto-rules", response_model=list[MessageAutoRuleRead])
def list_auto_rules(db: Session = Depends(get_db), _: User = ViewActor):
    ensure_seeded(db)
    rows = db.scalars(select(MessageAutoRule).options(selectinload(MessageAutoRule.message_type)).order_by(MessageAutoRule.id)).all()
    return [auto_rule_read(row) for row in rows]


@router.put("/auto-rules", response_model=list[MessageAutoRuleRead])
def update_auto_rules(payload: list[MessageAutoRulePayload], request: Request, db: Session = Depends(get_db), actor: User = EditActor):
    existing = {row.event_code: row for row in db.scalars(select(MessageAutoRule)).all()}
    for data in payload:
        row = existing.get(data.event_code)
        if not row:
            row = MessageAutoRule(event_code=data.event_code)
            db.add(row)
        for field, value in data.model_dump(exclude={"event_code"}).items():
            setattr(row, field, value)
    commit_with_audit(db, request, actor, "message_auto_rules_updated", metadata={"count": len(payload)})
    rows = db.scalars(select(MessageAutoRule).options(selectinload(MessageAutoRule.message_type)).order_by(MessageAutoRule.id)).all()
    return [auto_rule_read(row) for row in rows]


def recipients_setting(db: Session) -> PortalSetting:
    setting = db.scalar(select(PortalSetting).where(PortalSetting.category == "messaging_recipient_settings", PortalSetting.setting_key == "defaults"))
    if not setting:
        setting = PortalSetting(category="messaging_recipient_settings", setting_key="defaults", setting_value={})
        db.add(setting)
        db.flush()
    return setting


@router.get("/recipients", response_model=MessageRecipientsPayload)
def get_recipients_settings(db: Session = Depends(get_db), _: User = ViewActor):
    setting = recipients_setting(db)
    db.commit()
    return MessageRecipientsPayload(**(setting.setting_value if isinstance(setting.setting_value, dict) else {}))


@router.put("/recipients", response_model=MessageRecipientsPayload)
def update_recipients_settings(payload: MessageRecipientsPayload, request: Request, db: Session = Depends(get_db), actor: User = EditActor):
    setting = recipients_setting(db)
    setting.setting_value = payload.model_dump()
    commit_with_audit(db, request, actor, "message_recipients_settings_updated", entity_id=str(setting.id), metadata=payload.model_dump())
    return MessageRecipientsPayload(**setting.setting_value)


@router.get("/notifications", response_model=MessageNotificationSettingsRead)
def get_notifications(db: Session = Depends(get_db), _: User = ViewActor):
    ensure_seeded(db)
    return get_singleton(db, MessageNotificationSettings)


@router.put("/notifications", response_model=MessageNotificationSettingsRead)
def update_notifications(payload: MessageNotificationSettingsPayload, request: Request, db: Session = Depends(get_db), actor: User = EditActor):
    item = update_singleton(db, MessageNotificationSettings, payload.model_dump())
    commit_with_audit(db, request, actor, "message_notification_settings_updated", entity_id=str(item.id), metadata=payload.model_dump())
    db.refresh(item)
    return item


@router.get("/attachments", response_model=MessageAttachmentSettingsRead)
def get_attachments(db: Session = Depends(get_db), _: User = ViewActor):
    ensure_seeded(db)
    return get_singleton(db, MessageAttachmentSettings)


@router.put("/attachments", response_model=MessageAttachmentSettingsRead)
def update_attachments(payload: MessageAttachmentSettingsPayload, request: Request, db: Session = Depends(get_db), actor: User = EditActor):
    global_max_mb = get_global_upload_max_file_size_mb(db)
    if payload.max_file_size_mb > global_max_mb:
        raise HTTPException(
            status_code=422,
            detail=f"لا يمكن أن يتجاوز حد مرفقات المراسلات الحد الأقصى العام لرفع الملفات ({global_max_mb} MB).",
        )
    item = update_singleton(db, MessageAttachmentSettings, payload.model_dump())
    commit_with_audit(db, request, actor, "message_attachment_settings_updated", entity_id=str(item.id), metadata=payload.model_dump())
    db.refresh(item)
    return item


@router.get("/templates", response_model=list[MessageTemplateRead])
def list_templates(db: Session = Depends(get_db), _: User = ViewActor):
    ensure_seeded(db)
    rows = db.scalars(select(MessageTemplate).options(selectinload(MessageTemplate.message_type)).order_by(MessageTemplate.id)).all()
    return [template_read(row) for row in rows]


@router.post("/templates", response_model=MessageTemplateRead, status_code=status.HTTP_201_CREATED)
def create_template(payload: MessageTemplatePayload, request: Request, db: Session = Depends(get_db), actor: User = EditActor):
    item = MessageTemplate(**payload.model_dump(), created_by=actor.id)
    db.add(item)
    db.flush()
    commit_with_audit(db, request, actor, "message_template_created", "message_template", str(item.id), {"name": item.name})
    db.refresh(item)
    return template_read(item)


@router.put("/templates/{item_id}", response_model=MessageTemplateRead)
def update_template(item_id: int, payload: MessageTemplatePayload, request: Request, db: Session = Depends(get_db), actor: User = EditActor):
    item = db.get(MessageTemplate, item_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="القالب غير موجود")
    for field, value in payload.model_dump().items():
        setattr(item, field, value)
    commit_with_audit(db, request, actor, "message_template_updated", "message_template", str(item.id), {"name": item.name})
    db.refresh(item)
    return template_read(item)


@router.delete("/templates/{item_id}")
def delete_template(item_id: int, request: Request, db: Session = Depends(get_db), actor: User = EditActor):
    item = db.get(MessageTemplate, item_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="القالب غير موجود")
    db.delete(item)
    commit_with_audit(db, request, actor, "message_template_deleted", "message_template", str(item_id))
    return {"ok": True}


@router.post("/templates/{item_id}/preview", response_model=MessageTemplatePreviewResponse)
def preview_template(item_id: int, payload: MessageTemplatePreviewRequest, db: Session = Depends(get_db), _: User = ViewActor):
    item = db.get(MessageTemplate, item_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="القالب غير موجود")
    return MessageTemplatePreviewResponse(
        subject=render_template_text(item.subject_template, payload.sample_data),
        body=render_template_text(item.body_template, payload.sample_data),
    )


@router.get("/retention", response_model=MessageRetentionPolicyRead)
def get_retention(db: Session = Depends(get_db), _: User = ViewActor):
    ensure_seeded(db)
    return get_singleton(db, MessageRetentionPolicy)


@router.put("/retention", response_model=MessageRetentionPolicyRead)
def update_retention(payload: MessageRetentionPolicyPayload, request: Request, db: Session = Depends(get_db), actor: User = EditActor):
    item = update_singleton(db, MessageRetentionPolicy, payload.model_dump())
    commit_with_audit(db, request, actor, "message_retention_policy_updated", entity_id=str(item.id), metadata=payload.model_dump())
    db.refresh(item)
    return item


@router.get("/security", response_model=MessageSecurityPolicyRead)
def get_security(db: Session = Depends(get_db), _: User = ViewActor):
    ensure_seeded(db)
    return get_singleton(db, MessageSecurityPolicy)


@router.put("/security", response_model=MessageSecurityPolicyRead)
def update_security(payload: MessageSecurityPolicyPayload, request: Request, db: Session = Depends(get_db), actor: User = EditActor):
    item = get_singleton(db, MessageSecurityPolicy)
    if payload.allow_super_admin_message_audit and not item.allow_super_admin_message_audit and not payload.confirm_super_admin_message_audit:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="تفعيل تدقيق رسائل مدير النظام يحتاج تأكيداً إدارياً منفصلاً")
    for field, value in payload.model_dump(exclude={"confirm_super_admin_message_audit"}).items():
        setattr(item, field, value)
    commit_with_audit(db, request, actor, "message_security_policy_updated", entity_id=str(item.id), metadata=payload.model_dump(exclude={"confirm_super_admin_message_audit"}))
    db.refresh(item)
    return item


@router.get("/ai", response_model=MessageAISettingsRead)
def get_message_ai(db: Session = Depends(get_db), _: User = ViewActor):
    ensure_seeded(db)
    item = get_singleton(db, MessageAISettings)
    global_ai = db.scalar(select(AISettings).limit(1))
    return MessageAISettingsRead(**{**item.__dict__, "global_ai_enabled": bool(global_ai and global_ai.is_enabled)})


@router.put("/ai", response_model=MessageAISettingsRead)
def update_message_ai(payload: MessageAISettingsPayload, request: Request, db: Session = Depends(get_db), actor: User = EditActor):
    item = update_singleton(db, MessageAISettings, payload.model_dump())
    commit_with_audit(db, request, actor, "message_ai_settings_updated", entity_id=str(item.id), metadata=payload.model_dump())
    db.refresh(item)
    global_ai = db.scalar(select(AISettings).limit(1))
    return MessageAISettingsRead(**{**item.__dict__, "global_ai_enabled": bool(global_ai and global_ai.is_enabled)})


@router.get("/analytics", response_model=MessageAnalyticsRead)
def get_analytics(db: Session = Depends(get_db), _: User = ViewActor):
    ensure_seeded(db)
    return messaging_analytics(db)


@router.get("/audit-logs", response_model=list[MessageAuditLogRead])
def get_audit_logs(db: Session = Depends(get_db), _: User = ViewActor):
    rows = db.scalars(
        select(AuditLog)
        .options(selectinload(AuditLog.actor))
        .where(AuditLog.action.like("message_%") | AuditLog.action.like("messaging_%") | (AuditLog.action == "internal_message_settings_updated"))
        .order_by(AuditLog.created_at.desc())
        .limit(200)
    ).all()
    return [
        MessageAuditLogRead(
            id=row.id,
            action=row.action,
            user_name=row.actor.full_name_ar if row.actor else None,
            ip_address=row.ip_address,
            details=row.metadata_json or {},
            created_at=row.created_at,
        )
        for row in rows
    ]
