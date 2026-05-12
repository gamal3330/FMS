from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class MessagingSettings(Base):
    __tablename__ = "messaging_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    enable_messaging: Mapped[bool] = mapped_column(Boolean, default=True)
    module_name_ar: Mapped[str] = mapped_column(String(160), default="المراسلات الداخلية")
    module_name_en: Mapped[str] = mapped_column(String(160), default="Internal Messaging")
    allow_general_messages: Mapped[bool] = mapped_column(Boolean, default=True)
    allow_replies: Mapped[bool] = mapped_column(Boolean, default=True)
    allow_forwarding: Mapped[bool] = mapped_column(Boolean, default=False)
    allow_archiving: Mapped[bool] = mapped_column(Boolean, default=True)
    enable_read_receipts: Mapped[bool] = mapped_column(Boolean, default=True)
    enable_unread_badge: Mapped[bool] = mapped_column(Boolean, default=True)
    enable_templates: Mapped[bool] = mapped_column(Boolean, default=True)
    default_priority: Mapped[str] = mapped_column(String(30), default="normal")
    max_recipients: Mapped[int] = mapped_column(Integer, default=10)
    allow_multiple_recipients: Mapped[bool] = mapped_column(Boolean, default=True)
    allow_broadcast_messages: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class MessageType(Base):
    __tablename__ = "message_types"

    id: Mapped[int] = mapped_column(primary_key=True)
    name_ar: Mapped[str] = mapped_column(String(160), index=True)
    name_en: Mapped[str | None] = mapped_column(String(160))
    code: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    color: Mapped[str] = mapped_column(String(30), default="#0d6337")
    icon: Mapped[str] = mapped_column(String(80), default="mail")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    is_official: Mapped[bool] = mapped_column(Boolean, default=False)
    requires_request: Mapped[bool] = mapped_column(Boolean, default=False)
    requires_attachment: Mapped[bool] = mapped_column(Boolean, default=False)
    show_in_pdf: Mapped[bool] = mapped_column(Boolean, default=False)
    visible_to_requester: Mapped[bool] = mapped_column(Boolean, default=False)
    allow_reply: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=100)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class MessageClassification(Base):
    __tablename__ = "message_classifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    name_ar: Mapped[str] = mapped_column(String(160))
    name_en: Mapped[str | None] = mapped_column(String(160))
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    restricted_access: Mapped[bool] = mapped_column(Boolean, default=False)
    show_in_pdf: Mapped[bool] = mapped_column(Boolean, default=True)
    show_in_reports: Mapped[bool] = mapped_column(Boolean, default=True)
    allow_attachment_download: Mapped[bool] = mapped_column(Boolean, default=True)
    log_downloads: Mapped[bool] = mapped_column(Boolean, default=False)
    requires_special_permission: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class MessageTemplate(Base):
    __tablename__ = "message_templates"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160), index=True)
    message_type_id: Mapped[int | None] = mapped_column(ForeignKey("message_types.id"))
    subject_template: Mapped[str] = mapped_column(String(255))
    body_template: Mapped[str] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    message_type = relationship("MessageType")
    creator = relationship("User")


class MessageNotificationSettings(Base):
    __tablename__ = "message_notification_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    enable_message_notifications: Mapped[bool] = mapped_column(Boolean, default=True)
    notify_on_new_message: Mapped[bool] = mapped_column(Boolean, default=True)
    notify_on_reply: Mapped[bool] = mapped_column(Boolean, default=True)
    notify_on_read: Mapped[bool] = mapped_column(Boolean, default=False)
    notify_on_clarification_request: Mapped[bool] = mapped_column(Boolean, default=True)
    notify_on_official_message: Mapped[bool] = mapped_column(Boolean, default=True)
    show_unread_count: Mapped[bool] = mapped_column(Boolean, default=True)
    enable_unread_reminder: Mapped[bool] = mapped_column(Boolean, default=False)
    unread_reminder_hours: Mapped[int] = mapped_column(Integer, default=24)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class MessageAttachmentSettings(Base):
    __tablename__ = "message_attachment_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    allow_message_attachments: Mapped[bool] = mapped_column(Boolean, default=True)
    allowed_extensions_json: Mapped[list] = mapped_column(JSON, default=list)
    max_file_size_mb: Mapped[int] = mapped_column(Integer, default=25)
    max_attachments_per_message: Mapped[int] = mapped_column(Integer, default=10)
    message_upload_path: Mapped[str] = mapped_column(String(255), default="uploads/messages")
    hide_real_file_path: Mapped[bool] = mapped_column(Boolean, default=True)
    log_attachment_downloads: Mapped[bool] = mapped_column(Boolean, default=True)
    enable_virus_scan: Mapped[bool] = mapped_column(Boolean, default=False)
    block_executable_files: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class MessageRequestIntegrationSettings(Base):
    __tablename__ = "message_request_integration_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    allow_link_to_request: Mapped[bool] = mapped_column(Boolean, default=True)
    show_messages_tab_in_request_details: Mapped[bool] = mapped_column(Boolean, default=True)
    allow_send_message_from_request: Mapped[bool] = mapped_column(Boolean, default=True)
    require_request_for_clarification: Mapped[bool] = mapped_column(Boolean, default=True)
    require_request_for_execution_note: Mapped[bool] = mapped_column(Boolean, default=True)
    include_official_messages_in_request_pdf: Mapped[bool] = mapped_column(Boolean, default=True)
    exclude_internal_messages_from_pdf: Mapped[bool] = mapped_column(Boolean, default=True)
    show_message_count_on_request: Mapped[bool] = mapped_column(Boolean, default=True)
    allow_request_owner_to_view_messages: Mapped[bool] = mapped_column(Boolean, default=False)
    allow_approvers_to_view_request_messages: Mapped[bool] = mapped_column(Boolean, default=True)
    show_request_notification_checkbox: Mapped[bool] = mapped_column(Boolean, default=True)
    default_send_request_notification: Mapped[bool] = mapped_column(Boolean, default=True)
    allow_requester_toggle_notification: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class MessageAutoRule(Base):
    __tablename__ = "message_auto_rules"

    id: Mapped[int] = mapped_column(primary_key=True)
    event_code: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    message_type_id: Mapped[int | None] = mapped_column(ForeignKey("message_types.id"))
    subject_template: Mapped[str] = mapped_column(String(255), default="")
    body_template: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    message_type = relationship("MessageType")


class MessageRetentionPolicy(Base):
    __tablename__ = "message_retention_policies"

    id: Mapped[int] = mapped_column(primary_key=True)
    allow_archiving: Mapped[bool] = mapped_column(Boolean, default=True)
    prevent_hard_delete: Mapped[bool] = mapped_column(Boolean, default=True)
    retention_days: Mapped[int] = mapped_column(Integer, default=2555)
    attachment_retention_days: Mapped[int] = mapped_column(Integer, default=2555)
    auto_archive_after_days: Mapped[int] = mapped_column(Integer, default=365)
    exclude_official_messages_from_delete: Mapped[bool] = mapped_column(Boolean, default=True)
    exclude_confidential_messages_from_delete: Mapped[bool] = mapped_column(Boolean, default=True)
    allow_user_delete_own_messages: Mapped[bool] = mapped_column(Boolean, default=False)
    allow_admin_purge_messages: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class MessageSecurityPolicy(Base):
    __tablename__ = "message_security_policies"

    id: Mapped[int] = mapped_column(primary_key=True)
    log_message_sent: Mapped[bool] = mapped_column(Boolean, default=True)
    log_message_read: Mapped[bool] = mapped_column(Boolean, default=False)
    log_message_archived: Mapped[bool] = mapped_column(Boolean, default=True)
    log_message_deleted: Mapped[bool] = mapped_column(Boolean, default=True)
    log_attachment_downloaded: Mapped[bool] = mapped_column(Boolean, default=True)
    log_settings_changes: Mapped[bool] = mapped_column(Boolean, default=True)
    log_ip_address: Mapped[bool] = mapped_column(Boolean, default=True)
    log_user_agent: Mapped[bool] = mapped_column(Boolean, default=True)
    allow_super_admin_message_audit: Mapped[bool] = mapped_column(Boolean, default=False)
    require_reason_for_confidential_access: Mapped[bool] = mapped_column(Boolean, default=True)
    reading_policy: Mapped[str] = mapped_column(String(60), default="sender_and_recipients_only")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class MessageAISettings(Base):
    __tablename__ = "message_ai_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    show_ai_in_compose: Mapped[bool] = mapped_column(Boolean, default=True)
    show_ai_in_message_details: Mapped[bool] = mapped_column(Boolean, default=True)
    show_ai_in_request_messages_tab: Mapped[bool] = mapped_column(Boolean, default=True)
    allow_ai_draft: Mapped[bool] = mapped_column(Boolean, default=True)
    allow_ai_improve: Mapped[bool] = mapped_column(Boolean, default=True)
    allow_ai_formalize: Mapped[bool] = mapped_column(Boolean, default=True)
    allow_ai_suggest_reply: Mapped[bool] = mapped_column(Boolean, default=True)
    allow_ai_summarize_request_messages: Mapped[bool] = mapped_column(Boolean, default=True)
    allow_ai_detect_missing_info: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
