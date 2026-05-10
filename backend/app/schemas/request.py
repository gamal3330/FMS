from datetime import datetime
from pydantic import BaseModel, Field

from app.models.enums import ApprovalAction, Priority, RequestStatus, RequestType
from app.schemas.user import DepartmentRead, UserRead


class ServiceRequestCreate(BaseModel):
    title: str = Field(min_length=3, max_length=180)
    request_type: RequestType = RequestType.SUPPORT
    request_type_id: int | None = None
    priority: Priority = Priority.MEDIUM
    form_data: dict = Field(default_factory=dict)
    business_justification: str | None = None
    send_notification: bool = True
    attachment_count: int = Field(default=0, ge=0, le=100)


class ServiceRequestUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=3, max_length=180)
    priority: Priority | None = None
    form_data: dict | None = None
    business_justification: str | None = None


class ApprovalStepRead(BaseModel):
    id: int
    step_order: int
    role: str
    action: ApprovalAction
    can_reject: bool = True
    can_return_for_edit: bool = False
    can_act: bool = False
    note: str | None = None
    acted_at: datetime | None = None
    approver: UserRead | None = None

    model_config = {"from_attributes": True}


class ApprovalDecision(BaseModel):
    action: ApprovalAction
    note: str | None = None


class CommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
    is_internal: bool = True


class CommentRead(BaseModel):
    id: int
    body: str
    is_internal: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class AttachmentRead(BaseModel):
    id: int
    original_name: str
    content_type: str
    size_bytes: int
    created_at: datetime

    model_config = {"from_attributes": True}


class ServiceRequestRead(BaseModel):
    id: int
    request_number: str
    title: str
    request_type: RequestType
    request_type_id: int | None = None
    request_type_version_id: int | None = None
    request_type_version_number: int = 1
    status: RequestStatus
    priority: Priority
    requester: UserRead
    assigned_to: UserRead | None = None
    department: DepartmentRead | None = None
    form_data: dict
    request_type_snapshot: dict = Field(default_factory=dict)
    form_schema_snapshot: list[dict] = Field(default_factory=list)
    business_justification: str | None = None
    sla_due_at: datetime | None = None
    closed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    approvals: list[ApprovalStepRead] = Field(default_factory=list)
    comments: list[CommentRead] = Field(default_factory=list)
    attachments: list[AttachmentRead] = Field(default_factory=list)

    model_config = {"from_attributes": True}
