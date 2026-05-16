from datetime import datetime

from pydantic import BaseModel, Field


AI_FEATURE_CODES = {
    "draft_message",
    "improve_message",
    "formalize_message",
    "shorten_message",
    "suggest_reply",
    "summarize_message",
    "summarize_request_messages",
    "detect_missing_info",
    "translate_ar_en",
}


class AISettingsRead(BaseModel):
    id: int
    is_enabled: bool = False
    mode: str = "disabled"
    assistant_name: str = "المساعد الذكي للمراسلات"
    assistant_description: str | None = None
    system_prompt: str | None = None
    provider: str = "local_ollama"
    api_base_url: str | None = None
    api_key_configured: bool = False
    model_name: str = "qwen3:8b"
    default_language: str = "ar"
    max_input_chars: int = 6000
    timeout_seconds: int = 60
    show_human_review_disclaimer: bool = True
    allow_message_drafting: bool = True
    allow_summarization: bool = True
    allow_reply_suggestion: bool = True
    allow_message_improvement: bool = True
    allow_missing_info_detection: bool = True
    allow_translate_ar_en: bool = False
    mask_sensitive_data: bool = True
    mask_emails: bool = True
    mask_phone_numbers: bool = True
    mask_employee_ids: bool = True
    mask_usernames: bool = False
    mask_request_numbers: bool = False
    allow_request_context: bool = True
    request_context_level: str = "basic_only"
    allow_attachments_to_ai: bool = False
    store_full_prompt_logs: bool = False
    show_in_compose_message: bool = True
    show_in_message_details: bool = True
    show_in_request_messages_tab: bool = True
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AISettingsUpdate(BaseModel):
    is_enabled: bool = False
    mode: str = Field(default="disabled", pattern="^(disabled|pilot|enabled)$")
    assistant_name: str = Field(default="المساعد الذكي للمراسلات", max_length=160)
    assistant_description: str | None = Field(default=None, max_length=2000)
    system_prompt: str | None = Field(default=None, max_length=8000)
    provider: str = Field(default="local_ollama", max_length=80)
    api_base_url: str | None = Field(default=None, max_length=500)
    api_key: str | None = Field(default=None, max_length=5000)
    model_name: str = Field(default="qwen3:8b", max_length=160)
    default_language: str = Field(default="ar", pattern="^(ar|en)$")
    max_input_chars: int = Field(default=6000, ge=100, le=50000)
    timeout_seconds: int = Field(default=60, ge=5, le=300)
    show_human_review_disclaimer: bool = True
    allow_message_drafting: bool = True
    allow_summarization: bool = True
    allow_reply_suggestion: bool = True
    allow_message_improvement: bool = True
    allow_missing_info_detection: bool = True
    allow_translate_ar_en: bool = False
    mask_sensitive_data: bool = True
    mask_emails: bool = True
    mask_phone_numbers: bool = True
    mask_employee_ids: bool = True
    mask_usernames: bool = False
    mask_request_numbers: bool = False
    allow_request_context: bool = True
    request_context_level: str = Field(default="basic_only", pattern="^(none|basic_only|basic_and_allowed_messages)$")
    allow_attachments_to_ai: bool = False
    store_full_prompt_logs: bool = False
    show_in_compose_message: bool = True
    show_in_message_details: bool = True
    show_in_request_messages_tab: bool = True


class AIConnectionTestResponse(BaseModel):
    ok: bool = False
    message: str
    sample: str | None = None


class AIUsageLogRead(BaseModel):
    id: int
    user_id: int | None = None
    user_name: str | None = None
    feature: str
    feature_code: str | None = None
    entity_type: str | None = None
    entity_id: str | None = None
    input_length: int
    output_length: int
    latency_ms: int = 0
    status: str
    error_message: str | None = None
    prompt_text: str | None = None
    output_text: str | None = None
    created_at: datetime


class AIStatusRead(BaseModel):
    is_enabled: bool = False
    mode: str = "disabled"
    assistant_name: str = "المساعد الذكي للمراسلات"
    assistant_description: str | None = None
    max_input_chars: int = 6000
    show_human_review_disclaimer: bool = True
    allow_message_drafting: bool = False
    allow_summarization: bool = False
    allow_message_summarization: bool = False
    allow_request_messages_summarization: bool = False
    allow_reply_suggestion: bool = False
    allow_message_improvement: bool = False
    allow_missing_info_detection: bool = False
    allow_translate_ar_en: bool = False
    show_in_compose_message: bool = False
    show_in_message_details: bool = False
    show_in_request_messages_tab: bool = False


class AIFeaturePermissionItem(BaseModel):
    role_id: int
    role_name: str
    role_label_ar: str
    feature_code: str
    is_enabled: bool = False
    daily_limit: int = Field(default=20, ge=0, le=100000)
    monthly_limit: int = Field(default=500, ge=0, le=1000000)


class AIFeaturePermissionsPayload(BaseModel):
    items: list[AIFeaturePermissionItem] = Field(default_factory=list)


class AIPromptTemplateRead(BaseModel):
    id: int
    code: str
    name_ar: str
    description: str | None = None
    prompt_text: str
    version_number: int = 1
    is_active: bool = True
    created_by: int | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AIPromptTemplateOption(BaseModel):
    id: int
    code: str
    name_ar: str
    description: str | None = None
    output_kind: str = "text"


class AIRunTemplateRequest(BaseModel):
    template_id: int
    instruction: str | None = Field(default=None, max_length=50000)
    body: str | None = Field(default=None, max_length=50000)
    related_request_id: int | str | None = None
    request_type: str | None = Field(default=None, max_length=120)


class AIRunTemplateResponse(BaseModel):
    template_id: int
    template_name: str
    output_kind: str = "text"
    subject: str = ""
    body: str = ""
    items: list[str] = Field(default_factory=list)


class AIPromptTemplatePayload(BaseModel):
    code: str = Field(min_length=2, max_length=80)
    name_ar: str = Field(min_length=2, max_length=160)
    description: str | None = Field(default=None, max_length=2000)
    prompt_text: str = Field(min_length=10, max_length=20000)
    version_number: int = Field(default=1, ge=1, le=10000)
    is_active: bool = True


class AIPromptTemplateTestRequest(BaseModel):
    sample_data: str = Field(min_length=1, max_length=10000)


class AITestGenerationRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=10000)
    max_tokens: int = Field(default=200, ge=20, le=2000)
    temperature: float = Field(default=0.2, ge=0, le=2)


class AITestMaskingRequest(BaseModel):
    text: str = Field(min_length=1, max_length=10000)


class AITestMaskingResponse(BaseModel):
    input_text: str
    output_text: str


class AIHealthCheckRead(BaseModel):
    provider: str
    model_name: str
    status: str
    latency_ms: int = 0
    message: str | None = None
    checked_at: datetime | None = None


class AIAuditLogRead(BaseModel):
    id: int
    action: str
    user_name: str | None = None
    ip_address: str | None = None
    old_value: str | None = None
    new_value: str | None = None
    metadata: dict = Field(default_factory=dict)
    created_at: datetime


class AIUsageSummaryRead(BaseModel):
    usage_today: int = 0
    usage_last_7_days: int = 0
    most_used_feature: str | None = None
    top_users: list[dict] = Field(default_factory=list)
    average_latency_ms: int = 0
    errors_count: int = 0
    model_status: str = "unknown"
    logs: list[AIUsageLogRead] = Field(default_factory=list)


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
