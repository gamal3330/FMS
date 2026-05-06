from datetime import datetime

from pydantic import BaseModel, Field


class MessageUserRead(BaseModel):
    id: int
    full_name_ar: str
    email: str
    role: str
    department_id: int | None = None
    department_name: str | None = None

    model_config = {"from_attributes": True}


class InternalMessageCreate(BaseModel):
    recipient_ids: list[int] = Field(min_length=1)
    message_type: str = Field(default="internal_correspondence", max_length=40)
    subject: str = Field(min_length=2, max_length=180)
    body: str = Field(min_length=1)
    related_request_id: int | str | None = None


class InternalMessageDraftUpsert(BaseModel):
    recipient_ids: list[int] = Field(default_factory=list)
    message_type: str = Field(default="internal_correspondence", max_length=40)
    subject: str = Field(default="", max_length=180)
    body: str = Field(default="")
    related_request_id: int | str | None = None


class InternalMessageReply(BaseModel):
    body: str = Field(min_length=1)
    message_type: str = Field(default="reply_to_clarification", max_length=40)


class InternalMessageForward(BaseModel):
    recipient_ids: list[int] = Field(min_length=1)
    message_type: str = Field(default="internal_correspondence", max_length=40)
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
    enabled: bool = True
    enable_attachments: bool = True
    enable_drafts: bool = True
    enable_templates: bool = True
    enable_signatures: bool = True
    enable_circulars: bool = True
    enable_department_broadcasts: bool = True
    enable_read_receipts: bool = True
    enable_linked_requests: bool = True
    auto_refresh_seconds: int = 20
    max_attachment_mb: int = 25
    max_recipients: int = 200
    default_message_type: str = "internal_correspondence"
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
    enable_circulars: bool = True
    enable_department_broadcasts: bool = True
    enable_read_receipts: bool = True
    enable_linked_requests: bool = True
    auto_refresh_seconds: int = Field(default=20, ge=5, le=300)
    max_attachment_mb: int = Field(default=25, ge=1, le=100)
    max_recipients: int = Field(default=200, ge=1, le=1000)
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
