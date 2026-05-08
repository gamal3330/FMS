from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator


BLOCKED_EXTENSIONS = {"exe", "bat", "cmd", "ps1", "sh", "js", "vbs", "msi"}


class MessagingSettingsPayload(BaseModel):
    enable_messaging: bool = True
    module_name_ar: str = Field(default="المراسلات الداخلية", min_length=2, max_length=160)
    module_name_en: str = Field(default="Internal Messaging", min_length=2, max_length=160)
    allow_general_messages: bool = True
    allow_replies: bool = True
    allow_forwarding: bool = False
    allow_archiving: bool = True
    enable_read_receipts: bool = True
    enable_unread_badge: bool = True
    default_priority: str = Field(default="normal", pattern="^(normal|high|urgent)$")
    max_recipients: int = Field(default=10, ge=1, le=1000)
    allow_multiple_recipients: bool = True
    allow_broadcast_messages: bool = False


class MessagingSettingsRead(MessagingSettingsPayload):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class MessageTypePayload(BaseModel):
    name_ar: str = Field(min_length=2, max_length=160)
    name_en: str | None = Field(default=None, max_length=160)
    code: str = Field(min_length=2, max_length=80, pattern=r"^[a-z][a-z0-9_]*$")
    description: str | None = Field(default=None, max_length=2000)
    color: str = Field(default="#0d6337", max_length=30)
    icon: str = Field(default="mail", max_length=80)
    is_active: bool = True
    is_official: bool = False
    requires_request: bool = False
    requires_attachment: bool = False
    show_in_pdf: bool = False
    visible_to_requester: bool = False
    allow_reply: bool = True
    sort_order: int = Field(default=100, ge=0, le=10000)


class MessageTypeRead(MessageTypePayload):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class MessageClassificationPayload(BaseModel):
    code: str = Field(min_length=2, max_length=80, pattern=r"^[a-z][a-z0-9_]*$")
    name_ar: str = Field(min_length=2, max_length=160)
    name_en: str | None = Field(default=None, max_length=160)
    description: str | None = Field(default=None, max_length=2000)
    is_active: bool = True
    restricted_access: bool = False
    show_in_pdf: bool = True
    show_in_reports: bool = True
    allow_attachment_download: bool = True
    log_downloads: bool = False
    requires_special_permission: bool = False


class MessageClassificationRead(MessageClassificationPayload):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class MessageRequestIntegrationPayload(BaseModel):
    allow_link_to_request: bool = True
    show_messages_tab_in_request_details: bool = True
    allow_send_message_from_request: bool = True
    require_request_for_clarification: bool = True
    require_request_for_execution_note: bool = True
    include_official_messages_in_request_pdf: bool = True
    exclude_internal_messages_from_pdf: bool = True
    show_message_count_on_request: bool = True
    allow_request_owner_to_view_messages: bool = False
    allow_approvers_to_view_request_messages: bool = True
    show_request_notification_checkbox: bool = True
    default_send_request_notification: bool = True
    allow_requester_toggle_notification: bool = True


class MessageRequestIntegrationRead(MessageRequestIntegrationPayload):
    id: int
    updated_at: datetime

    model_config = {"from_attributes": True}


class MessageRequestNotificationControlRead(BaseModel):
    show_checkbox: bool = True
    default_checked: bool = True
    allow_toggle: bool = True


class MessageAutoRulePayload(BaseModel):
    event_code: str = Field(min_length=2, max_length=80)
    is_enabled: bool = False
    message_type_id: int | None = None
    subject_template: str = Field(default="", max_length=255)
    body_template: str = Field(default="", max_length=8000)


class MessageAutoRuleRead(MessageAutoRulePayload):
    id: int
    message_type_name: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class MessageRecipientsPayload(BaseModel):
    allow_send_to_user: bool = True
    allow_send_to_department: bool = True
    allow_send_to_role: bool = False
    allow_send_to_specialized_section: bool = False
    allow_multiple_recipients: bool = True
    allow_broadcast: bool = False
    prevent_sending_to_inactive_users: bool = True
    max_recipients: int = Field(default=10, ge=1, le=1000)
    department_recipient_behavior: str = Field(default="selected_department_users", pattern="^(department_manager_only|all_department_users|selected_department_users)$")
    role_recipient_behavior: str = Field(default="role_users_only", pattern="^(role_users_only|role_managers_only)$")


class MessageNotificationSettingsPayload(BaseModel):
    enable_message_notifications: bool = True
    notify_on_new_message: bool = True
    notify_on_reply: bool = True
    notify_on_read: bool = False
    notify_on_clarification_request: bool = True
    notify_on_official_message: bool = True
    show_unread_count: bool = True
    enable_unread_reminder: bool = False
    unread_reminder_hours: int = Field(default=24, ge=1, le=720)


class MessageNotificationSettingsRead(MessageNotificationSettingsPayload):
    id: int
    updated_at: datetime

    model_config = {"from_attributes": True}


class MessageAttachmentSettingsPayload(BaseModel):
    allow_message_attachments: bool = True
    allowed_extensions_json: list[str] = Field(default_factory=lambda: ["pdf", "png", "jpg", "jpeg"])
    max_file_size_mb: int = Field(default=25, ge=1, le=1024)
    max_attachments_per_message: int = Field(default=10, ge=1, le=100)
    message_upload_path: str = Field(default="uploads/messages", max_length=255)
    hide_real_file_path: bool = True
    log_attachment_downloads: bool = True
    enable_virus_scan: bool = False
    block_executable_files: bool = True

    @field_validator("allowed_extensions_json")
    @classmethod
    def validate_extensions(cls, value: list[str]) -> list[str]:
        clean = sorted({item.strip().lower().lstrip(".") for item in value if item.strip()})
        if not clean:
            raise ValueError("يجب تحديد امتداد واحد على الأقل")
        if BLOCKED_EXTENSIONS.intersection(clean):
            raise ValueError("لا يمكن السماح بامتدادات تنفيذية خطرة")
        return clean


class MessageAttachmentSettingsRead(MessageAttachmentSettingsPayload):
    id: int
    updated_at: datetime

    model_config = {"from_attributes": True}


class MessageTemplatePayload(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    message_type_id: int | None = None
    subject_template: str = Field(min_length=1, max_length=255)
    body_template: str = Field(min_length=1, max_length=8000)
    is_active: bool = True


class MessageTemplateRead(MessageTemplatePayload):
    id: int
    message_type_name: str | None = None
    message_type_code: str | None = None
    created_by: int | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class MessageTemplatePreviewRequest(BaseModel):
    sample_data: dict[str, Any] = Field(default_factory=dict)


class MessageTemplatePreviewResponse(BaseModel):
    subject: str
    body: str


class MessageRetentionPolicyPayload(BaseModel):
    allow_archiving: bool = True
    prevent_hard_delete: bool = True
    retention_days: int = Field(default=2555, ge=1, le=36500)
    attachment_retention_days: int = Field(default=2555, ge=1, le=36500)
    auto_archive_after_days: int = Field(default=365, ge=1, le=36500)
    exclude_official_messages_from_delete: bool = True
    exclude_confidential_messages_from_delete: bool = True
    allow_user_delete_own_messages: bool = False
    allow_admin_purge_messages: bool = False


class MessageRetentionPolicyRead(MessageRetentionPolicyPayload):
    id: int
    updated_at: datetime

    model_config = {"from_attributes": True}


class MessageSecurityPolicyPayload(BaseModel):
    log_message_sent: bool = True
    log_message_read: bool = False
    log_message_archived: bool = True
    log_message_deleted: bool = True
    log_attachment_downloaded: bool = True
    log_settings_changes: bool = True
    log_ip_address: bool = True
    log_user_agent: bool = True
    allow_super_admin_message_audit: bool = False
    require_reason_for_confidential_access: bool = True
    reading_policy: str = Field(default="sender_and_recipients_only", pattern="^(sender_and_recipients_only|request_authorized_users|special_audit_permission)$")
    confirm_super_admin_message_audit: bool = False


class MessageSecurityPolicyRead(MessageSecurityPolicyPayload):
    id: int
    updated_at: datetime

    model_config = {"from_attributes": True}


class MessageAISettingsPayload(BaseModel):
    show_ai_in_compose: bool = True
    show_ai_in_message_details: bool = True
    show_ai_in_request_messages_tab: bool = True
    allow_ai_draft: bool = True
    allow_ai_improve: bool = True
    allow_ai_formalize: bool = True
    allow_ai_suggest_reply: bool = True
    allow_ai_summarize_request_messages: bool = True
    allow_ai_detect_missing_info: bool = True


class MessageAISettingsRead(MessageAISettingsPayload):
    id: int
    global_ai_enabled: bool = False
    updated_at: datetime

    model_config = {"from_attributes": True}


class MessageAnalyticsRead(BaseModel):
    messages_today: int = 0
    messages_this_month: int = 0
    unread_messages: int = 0
    most_used_message_type: str | None = None
    top_departments: list[dict[str, Any]] = Field(default_factory=list)
    open_clarification_requests: int = 0
    average_reply_time_hours: float = 0
    attachments_count: int = 0


class MessageAuditLogRead(BaseModel):
    id: int
    action: str
    user_name: str | None = None
    ip_address: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
