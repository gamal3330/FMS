from datetime import datetime

from pydantic import BaseModel, Field


class AISettingsRead(BaseModel):
    id: int
    is_enabled: bool = False
    provider: str = "openai_compatible"
    api_base_url: str | None = None
    api_key_configured: bool = False
    model_name: str = "gpt-4o-mini"
    max_input_chars: int = 6000
    allow_message_drafting: bool = True
    allow_summarization: bool = True
    allow_reply_suggestion: bool = True
    mask_sensitive_data: bool = True
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AISettingsUpdate(BaseModel):
    is_enabled: bool = False
    provider: str = Field(default="openai_compatible", max_length=80)
    api_base_url: str | None = Field(default=None, max_length=500)
    api_key: str | None = Field(default=None, max_length=5000)
    model_name: str = Field(default="gpt-4o-mini", max_length=160)
    max_input_chars: int = Field(default=6000, ge=500, le=50000)
    allow_message_drafting: bool = True
    allow_summarization: bool = True
    allow_reply_suggestion: bool = True
    mask_sensitive_data: bool = True


class AIConnectionTestResponse(BaseModel):
    ok: bool = False
    message: str
    sample: str | None = None


class AIUsageLogRead(BaseModel):
    id: int
    user_id: int | None = None
    user_name: str | None = None
    feature: str
    entity_type: str | None = None
    entity_id: str | None = None
    input_length: int
    output_length: int
    status: str
    error_message: str | None = None
    created_at: datetime


class AIStatusRead(BaseModel):
    is_enabled: bool = False
    allow_message_drafting: bool = False
    allow_summarization: bool = False
    allow_reply_suggestion: bool = False
    max_input_chars: int = 6000


class AIDraftRequest(BaseModel):
    instruction: str = Field(min_length=2, max_length=4000)
    related_request_id: int | str | None = None


class AIDraftResponse(BaseModel):
    subject: str = ""
    body: str = ""


class AITextRequest(BaseModel):
    body: str = Field(min_length=1, max_length=50000)
    related_request_id: int | str | None = None
    request_type: str | None = Field(default=None, max_length=120)


class AITextResponse(BaseModel):
    body: str = ""


class AISuggestReplyRequest(BaseModel):
    message_id: int | None = None
    body: str | None = Field(default=None, max_length=50000)
    related_request_id: int | str | None = None


class AISummarizeRequest(BaseModel):
    related_request_id: int | str | None = None
    message_id: int | None = None
    message_ids: list[int] = Field(default_factory=list)
    text: str | None = Field(default=None, max_length=50000)


class AISummaryResponse(BaseModel):
    summary: str = ""


class AIMissingInfoRequest(BaseModel):
    body: str = Field(min_length=1, max_length=50000)
    related_request_id: int | str | None = None
    request_type: str | None = Field(default=None, max_length=120)


class AIMissingInfoResponse(BaseModel):
    items: list[str] = Field(default_factory=list)
