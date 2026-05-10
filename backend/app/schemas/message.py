from datetime import datetime

from pydantic import BaseModel, Field


class MessageUserRead(BaseModel):
    id: int
    full_name_ar: str
    email: str
    role: str
    department_id: int | None = None
    department_name: str | None = None
    department_manager_id: int | None = None

    model_config = {"from_attributes": True}


class InternalMessageCreate(BaseModel):
    recipient_ids: list[int] = Field(min_length=1)
    message_type: str = Field(default="internal_correspondence", max_length=40)
    priority: str = Field(default="normal", max_length=20)
    classification_code: str = Field(default="internal", max_length=80)
    subject: str = Field(min_length=2, max_length=180)
    body: str = Field(min_length=1)
    related_request_id: int | str | None = None


class InternalMessageDraftUpsert(BaseModel):
    recipient_ids: list[int] = Field(default_factory=list)
    message_type: str = Field(default="internal_correspondence", max_length=40)
    priority: str = Field(default="normal", max_length=20)
    classification_code: str = Field(default="internal", max_length=80)
    subject: str = Field(default="", max_length=180)
    body: str = Field(default="")
    related_request_id: int | str | None = None


class InternalMessageReply(BaseModel):
    body: str = Field(min_length=1)
    message_type: str = Field(default="reply_to_clarification", max_length=40)
    priority: str = Field(default="normal", max_length=20)
    classification_code: str = Field(default="internal", max_length=80)


class InternalMessageForward(BaseModel):
    recipient_ids: list[int] = Field(min_length=1)
    message_type: str = Field(default="internal_correspondence", max_length=40)
    priority: str = Field(default="normal", max_length=20)
    classification_code: str = Field(default="internal", max_length=80)
    note: str | None = None


class MessageAttachmentRead(BaseModel):
    id: int
    original_name: str
    content_type: str
    size_bytes: int
    created_at: datetime

    model_config = {"from_attributes": True}


class MessageReadReceipt(BaseModel):
    recipient_id: int
    recipient_name: str
    is_read: bool = False
    read_at: datetime | None = None


class MessageBulkAction(BaseModel):
    message_ids: list[int] = Field(min_length=1)


class MessageSettingsRead(BaseModel):
    module_name_ar: str = "المراسلات الداخلية"
    module_name_en: str = "Internal Messaging"
    enabled: bool = True
    enable_attachments: bool = True
    enable_drafts: bool = True
    enable_templates: bool = True
    enable_signatures: bool = True
    allow_archiving: bool = True
    allow_general_messages: bool = True
    allow_replies: bool = True
    allow_forwarding: bool = False
    allow_multiple_recipients: bool = True
    allow_user_delete_own_messages: bool = False
    prevent_hard_delete: bool = True
    exclude_official_messages_from_delete: bool = True
    exclude_confidential_messages_from_delete: bool = True
    allow_send_to_user: bool = True
    allow_send_to_department: bool = True
    allow_broadcast: bool = False
    enable_circulars: bool = True
    enable_department_broadcasts: bool = True
    enable_read_receipts: bool = True
    enable_unread_badge: bool = True
    enable_linked_requests: bool = True
    allow_send_message_from_request: bool = True
    show_messages_tab_in_request_details: bool = True
    show_message_count_on_request: bool = True
    allow_request_owner_to_view_messages: bool = False
    allow_approvers_to_view_request_messages: bool = True
    enable_message_notifications: bool = True
    notify_on_new_message: bool = True
    notify_on_reply: bool = True
    notify_on_read: bool = False
    notify_on_clarification_request: bool = True
    notify_on_official_message: bool = True
    auto_refresh_seconds: int = 20
    max_attachment_mb: int = 25
    max_attachments_per_message: int = 10
    max_recipients: int = 200
    default_priority: str = "normal"
    default_message_type: str = "internal_correspondence"
    allowed_extensions: list[str] = Field(default_factory=lambda: ["pdf", "png", "jpg", "jpeg"])
    block_executable_files: bool = True
    department_recipient_behavior: str = "selected_department_users"
    allowed_user_ids: list[int] = Field(default_factory=list)
    blocked_user_ids: list[int] = Field(default_factory=list)
    allowed_department_ids: list[int] = Field(default_factory=list)
    blocked_department_ids: list[int] = Field(default_factory=list)
    circular_allowed_roles: list[str] = Field(default_factory=list)
    circular_allowed_user_ids: list[int] = Field(default_factory=list)
    department_broadcast_allowed_roles: list[str] = Field(default_factory=list)
    department_broadcast_allowed_user_ids: list[int] = Field(default_factory=list)
    template_allowed_roles: list[str] = Field(default_factory=list)
    template_allowed_user_ids: list[int] = Field(default_factory=list)


class MessageSettingsUpdate(BaseModel):
    enabled: bool = True
    enable_attachments: bool = True
    enable_drafts: bool = True
    enable_templates: bool = True
    enable_signatures: bool = True
    allow_archiving: bool = True
    enable_circulars: bool = True
    enable_department_broadcasts: bool = True
    enable_read_receipts: bool = True
    enable_linked_requests: bool = True
    auto_refresh_seconds: int = Field(default=20, ge=5, le=300)
    max_attachment_mb: int = Field(default=25, ge=1, le=100)
    max_recipients: int = Field(default=200, ge=1, le=1000)
    default_priority: str = Field(default="normal", max_length=20)
    default_message_type: str = Field(default="internal_correspondence", max_length=40)
    allowed_user_ids: list[int] = Field(default_factory=list)
    blocked_user_ids: list[int] = Field(default_factory=list)
    allowed_department_ids: list[int] = Field(default_factory=list)
    blocked_department_ids: list[int] = Field(default_factory=list)
    circular_allowed_roles: list[str] = Field(default_factory=list)
    circular_allowed_user_ids: list[int] = Field(default_factory=list)
    department_broadcast_allowed_roles: list[str] = Field(default_factory=list)
    department_broadcast_allowed_user_ids: list[int] = Field(default_factory=list)
    template_allowed_roles: list[str] = Field(default_factory=list)
    template_allowed_user_ids: list[int] = Field(default_factory=list)


class MessageCapabilitiesRead(BaseModel):
    can_send_circular: bool = True
    can_send_department_broadcast: bool = True
    can_use_templates: bool = True


class MessageSignatureRead(BaseModel):
    signature: str = ""


class MessageSignatureUpdate(BaseModel):
    signature: str = Field(default="", max_length=2000)


class MessageTemplateRead(BaseModel):
    key: str
    label: str
    message_type: str = "internal_correspondence"
    subject: str = ""
    body: str = ""


class MessageTemplateUpdate(BaseModel):
    key: str = Field(min_length=2, max_length=80)
    label: str = Field(min_length=2, max_length=120)
    message_type: str = Field(default="internal_correspondence", max_length=40)
    subject: str = Field(default="", max_length=180)
    body: str = Field(default="", max_length=4000)


class MessageTemplatesUpdate(BaseModel):
    templates: list[MessageTemplateUpdate]


class MessageTypeRead(BaseModel):
    value: str
    label: str
    is_system: bool = False
    color: str | None = None
    icon: str | None = None
    is_official: bool = False
    requires_request: bool = False
    requires_attachment: bool = False
    show_in_pdf: bool = False
    allow_reply: bool = True


class MessageClassificationRead(BaseModel):
    code: str
    name_ar: str
    name_en: str | None = None
    description: str | None = None
    is_active: bool = True
    restricted_access: bool = False
    show_in_pdf: bool = True
    show_in_reports: bool = True
    allow_attachment_download: bool = True
    log_downloads: bool = False
    requires_special_permission: bool = False

    model_config = {"from_attributes": True}


class MessageTypeUpdate(BaseModel):
    value: str = Field(min_length=2, max_length=40, pattern=r"^[a-z][a-z0-9_]*$")
    label: str = Field(min_length=2, max_length=120)
    is_system: bool = False


class MessageTypesUpdate(BaseModel):
    types: list[MessageTypeUpdate]


class InternalMessageRead(BaseModel):
    id: int
    message_uid: str | None = None
    thread_id: int | None = None
    message_type: str = "internal_correspondence"
    priority: str = "normal"
    classification_code: str = "internal"
    subject: str
    body: str
    sender_id: int
    sender_name: str
    recipient_ids: list[int] = Field(default_factory=list)
    recipient_names: list[str] = Field(default_factory=list)
    related_request_id: int | None = None
    related_request_number: str | None = None
    is_read: bool = True
    is_archived: bool = False
    is_draft: bool = False
    created_at: datetime
    updated_at: datetime | None = None
    attachments: list[MessageAttachmentRead] = Field(default_factory=list)
    read_receipts: list[MessageReadReceipt] = Field(default_factory=list)
    replies: list["InternalMessageRead"] = Field(default_factory=list)


class MessageCounters(BaseModel):
    unread: int = 0
