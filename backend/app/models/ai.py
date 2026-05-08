from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class AISettings(Base):
    __tablename__ = "ai_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    mode: Mapped[str] = mapped_column(String(30), default="disabled")
    assistant_name: Mapped[str] = mapped_column(String(160), default="المساعد الذكي للمراسلات")
    assistant_description: Mapped[str | None] = mapped_column(Text)
    provider: Mapped[str] = mapped_column(String(80), default="local_ollama")
    api_base_url: Mapped[str | None] = mapped_column(String(500), default="http://localhost:11434")
    api_key_encrypted: Mapped[str | None] = mapped_column(Text)
    model_name: Mapped[str] = mapped_column(String(160), default="qwen3:8b")
    default_language: Mapped[str] = mapped_column(String(20), default="ar")
    max_input_chars: Mapped[int] = mapped_column(Integer, default=6000)
    timeout_seconds: Mapped[int] = mapped_column(Integer, default=60)
    show_human_review_disclaimer: Mapped[bool] = mapped_column(Boolean, default=True)
    allow_message_drafting: Mapped[bool] = mapped_column(Boolean, default=True)
    allow_summarization: Mapped[bool] = mapped_column(Boolean, default=True)
    allow_reply_suggestion: Mapped[bool] = mapped_column(Boolean, default=True)
    allow_message_improvement: Mapped[bool] = mapped_column(Boolean, default=True)
    allow_missing_info_detection: Mapped[bool] = mapped_column(Boolean, default=True)
    allow_translate_ar_en: Mapped[bool] = mapped_column(Boolean, default=False)
    mask_sensitive_data: Mapped[bool] = mapped_column(Boolean, default=True)
    mask_emails: Mapped[bool] = mapped_column(Boolean, default=True)
    mask_phone_numbers: Mapped[bool] = mapped_column(Boolean, default=True)
    mask_employee_ids: Mapped[bool] = mapped_column(Boolean, default=True)
    mask_usernames: Mapped[bool] = mapped_column(Boolean, default=False)
    mask_request_numbers: Mapped[bool] = mapped_column(Boolean, default=False)
    allow_request_context: Mapped[bool] = mapped_column(Boolean, default=True)
    request_context_level: Mapped[str] = mapped_column(String(40), default="basic_only")
    allow_attachments_to_ai: Mapped[bool] = mapped_column(Boolean, default=False)
    store_full_prompt_logs: Mapped[bool] = mapped_column(Boolean, default=False)
    show_in_compose_message: Mapped[bool] = mapped_column(Boolean, default=True)
    show_in_message_details: Mapped[bool] = mapped_column(Boolean, default=True)
    show_in_request_messages_tab: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class AIFeaturePermission(Base):
    __tablename__ = "ai_feature_permissions"

    id: Mapped[int] = mapped_column(primary_key=True)
    role_id: Mapped[int | None] = mapped_column(ForeignKey("roles.id"), index=True)
    feature_code: Mapped[str] = mapped_column(String(80), index=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    daily_limit: Mapped[int] = mapped_column(Integer, default=20)
    monthly_limit: Mapped[int] = mapped_column(Integer, default=500)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    role = relationship("Role")


class AIUsageLog(Base):
    __tablename__ = "ai_usage_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    feature: Mapped[str] = mapped_column(String(80), index=True)
    feature_code: Mapped[str | None] = mapped_column(String(80), index=True)
    entity_type: Mapped[str | None] = mapped_column(String(80), index=True)
    entity_id: Mapped[str | None] = mapped_column(String(80), index=True)
    input_length: Mapped[int] = mapped_column(Integer, default=0)
    output_length: Mapped[int] = mapped_column(Integer, default=0)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(30), default="success", index=True)
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

    user = relationship("User")


class AIPromptTemplate(Base):
    __tablename__ = "ai_prompt_templates"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    name_ar: Mapped[str] = mapped_column(String(160))
    description: Mapped[str | None] = mapped_column(Text)
    prompt_text: Mapped[str] = mapped_column(Text)
    version_number: Mapped[int] = mapped_column(Integer, default=1)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    creator = relationship("User")


class AIHealthCheck(Base):
    __tablename__ = "ai_health_checks"

    id: Mapped[int] = mapped_column(primary_key=True)
    provider: Mapped[str] = mapped_column(String(80), index=True)
    model_name: Mapped[str] = mapped_column(String(160), index=True)
    status: Mapped[str] = mapped_column(String(30), index=True)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    message: Mapped[str | None] = mapped_column(Text)
    checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class AIFeedback(Base):
    __tablename__ = "ai_feedback"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    feature_code: Mapped[str] = mapped_column(String(80), index=True)
    rating: Mapped[int] = mapped_column(Integer, default=0)
    comment: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

    user = relationship("User")
