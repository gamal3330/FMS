from datetime import datetime

from pydantic import BaseModel, Field


class RequestTypePayload(BaseModel):
    name_ar: str = Field(min_length=2, max_length=160)
    name_en: str = Field(min_length=2, max_length=160)
    code: str = Field(min_length=2, max_length=60)
    category: str = Field(default="general", min_length=2, max_length=80)
    assigned_section: str | None = None
    assigned_department_id: int | None = None
    description: str | None = None
    icon: str | None = None
    is_active: bool = True
    requires_attachment: bool = False
    allow_multiple_attachments: bool = False
    default_priority: str = "medium"
    sla_response_hours: int = Field(default=4, ge=1, le=720)
    sla_resolution_hours: int = Field(default=24, ge=1, le=1440)


class RequestTypeRead(RequestTypePayload):
    id: int
    created_at: datetime | None = None
    updated_at: datetime | None = None
    fields_count: int = 0
    workflow_summary: str = ""


class RequestTypeFieldPayload(BaseModel):
    label_ar: str
    label_en: str
    field_name: str
    field_type: str
    is_required: bool = False
    placeholder: str | None = None
    help_text: str | None = None
    validation_rules: dict = Field(default_factory=dict)
    options: list[str] = Field(default_factory=list)
    sort_order: int = 1
    is_active: bool = True


class RequestTypeFieldRead(RequestTypeFieldPayload):
    id: int
    request_type_id: int

    model_config = {"from_attributes": True}


class WorkflowStepPayload(BaseModel):
    step_name_ar: str
    step_name_en: str
    step_type: str
    approver_role_id: int | None = None
    approver_user_id: int | None = None
    is_mandatory: bool = True
    can_reject: bool = True
    can_return_for_edit: bool = False
    return_to_step_order: int | None = None
    sla_hours: int = Field(default=8, ge=1, le=720)
    escalation_user_id: int | None = None
    sort_order: int = 1
    is_active: bool = True


class WorkflowStepRead(WorkflowStepPayload):
    id: int
    workflow_template_id: int

    model_config = {"from_attributes": True}


class WorkflowRead(BaseModel):
    id: int
    request_type_id: int | None = None
    name: str
    is_active: bool
    steps: list[WorkflowStepRead] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class ReorderPayload(BaseModel):
    ids: list[int]


class RequestSubmitPayload(BaseModel):
    request_type_id: int
    title: str
    priority: str | None = None
    form_data: dict = Field(default_factory=dict)
    business_justification: str | None = None
