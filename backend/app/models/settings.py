from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class PortalSetting(Base):
    __tablename__ = "portal_settings"
    __table_args__ = (UniqueConstraint("category", "setting_key", name="uq_portal_setting_category_key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    category: Mapped[str] = mapped_column(String(80), index=True)
    setting_key: Mapped[str] = mapped_column(String(120), index=True)
    setting_value: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    updated_by = relationship("User")


class SettingsGeneral(Base):
    __tablename__ = "settings_general"

    id: Mapped[int] = mapped_column(primary_key=True)
    system_name: Mapped[str] = mapped_column(String(160), default="QIB IT Service Portal")
    logo_url: Mapped[str | None] = mapped_column(String(255))
    brand_color: Mapped[str] = mapped_column(String(7), default="#0d6337")
    language: Mapped[str] = mapped_column(String(20), default="Arabic")
    session_timeout_minutes: Mapped[int] = mapped_column(Integer, default=60)
    upload_max_file_size_mb: Mapped[int] = mapped_column(Integer, default=10)
    allowed_file_extensions: Mapped[str] = mapped_column(String(255), default="pdf,docx,xlsx,png,jpg")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class SettingsDepartment(Base):
    __tablename__ = "settings_departments"

    id: Mapped[int] = mapped_column(primary_key=True)
    name_ar: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    name_en: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    code: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    manager_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    manager = relationship("User")


class SpecializedSection(Base):
    __tablename__ = "specialized_sections"
    __table_args__ = (UniqueConstraint("code", name="uq_specialized_section_code"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name_ar: Mapped[str] = mapped_column(String(120), index=True)
    name_en: Mapped[str | None] = mapped_column(String(120), index=True)
    code: Mapped[str] = mapped_column(String(40), index=True)
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class WorkflowApprovalConfig(Base):
    __tablename__ = "workflow_approval_configs"

    id: Mapped[int] = mapped_column(primary_key=True)
    request_type: Mapped[str] = mapped_column(String(80), index=True)
    step_order: Mapped[int] = mapped_column(Integer)
    approver_role: Mapped[str] = mapped_column(String(80))
    is_mandatory: Mapped[bool] = mapped_column(Boolean, default=True)
    sla_hours: Mapped[int] = mapped_column(Integer, default=8)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RequestTypeConfig(Base):
    __tablename__ = "request_type_configs"

    id: Mapped[int] = mapped_column(primary_key=True)
    request_type: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    label_ar: Mapped[str] = mapped_column(String(160))
    label_en: Mapped[str] = mapped_column(String(160))
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    require_attachment: Mapped[bool] = mapped_column(Boolean, default=False)
    auto_priority: Mapped[str | None] = mapped_column(String(30))
    default_approvers: Mapped[list] = mapped_column(JSON, default=list)


class SlaConfig(Base):
    __tablename__ = "sla_configs"

    id: Mapped[int] = mapped_column(primary_key=True)
    request_type: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    response_time_hours: Mapped[int] = mapped_column(Integer)
    resolution_time_hours: Mapped[int] = mapped_column(Integer)
    escalation_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))

    escalation_user = relationship("User")


class WorkflowTemplate(Base):
    __tablename__ = "workflow_templates"

    id: Mapped[int] = mapped_column(primary_key=True)
    request_type: Mapped[str | None] = mapped_column(String(80), unique=True, index=True)
    request_type_id: Mapped[int | None] = mapped_column(ForeignKey("request_types.id"), index=True)
    name: Mapped[str] = mapped_column(String(160))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class WorkflowStep(Base):
    __tablename__ = "workflow_steps"

    id: Mapped[int] = mapped_column(primary_key=True)
    workflow_template_id: Mapped[int] = mapped_column(ForeignKey("workflow_templates.id", ondelete="CASCADE"), index=True)
    step_order: Mapped[int] = mapped_column(Integer)
    approver_role: Mapped[str] = mapped_column(String(80))
    is_mandatory: Mapped[bool] = mapped_column(Boolean, default=True)
    sla_hours: Mapped[int] = mapped_column(Integer, default=8)

    template = relationship("WorkflowTemplate")


class RequestTypeSetting(Base):
    __tablename__ = "request_types"

    id: Mapped[int] = mapped_column(primary_key=True)
    request_type: Mapped[str | None] = mapped_column(String(80), unique=True, index=True)
    label_ar: Mapped[str | None] = mapped_column(String(160))
    name_ar: Mapped[str] = mapped_column(String(160), index=True)
    name_en: Mapped[str] = mapped_column(String(160), index=True)
    code: Mapped[str] = mapped_column(String(60), unique=True, index=True)
    category: Mapped[str] = mapped_column(String(80), index=True)
    assigned_section: Mapped[str | None] = mapped_column(String(40), index=True)
    assigned_department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"), index=True)
    description: Mapped[str | None] = mapped_column(Text)
    icon: Mapped[str | None] = mapped_column(String(80))
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    require_attachment: Mapped[bool | None] = mapped_column(Boolean, default=False)
    requires_attachment: Mapped[bool] = mapped_column(Boolean, default=False)
    allow_multiple_attachments: Mapped[bool] = mapped_column(Boolean, default=False)
    default_priority: Mapped[str] = mapped_column(String(20), default="medium")
    sla_response_hours: Mapped[int] = mapped_column(Integer, default=4)
    sla_resolution_hours: Mapped[int] = mapped_column(Integer, default=24)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    fields: Mapped[list["RequestTypeField"]] = relationship(back_populates="request_type", cascade="all, delete-orphan")
    assigned_department = relationship("Department")


class RequestTypeField(Base):
    __tablename__ = "request_type_fields"
    __table_args__ = (UniqueConstraint("request_type_id", "field_name", name="uq_request_type_field_name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    request_type_id: Mapped[int] = mapped_column(ForeignKey("request_types.id", ondelete="CASCADE"), index=True)
    label_ar: Mapped[str] = mapped_column(String(160))
    label_en: Mapped[str] = mapped_column(String(160))
    field_name: Mapped[str] = mapped_column(String(100), index=True)
    field_type: Mapped[str] = mapped_column(String(40))
    is_required: Mapped[bool] = mapped_column(Boolean, default=False)
    placeholder: Mapped[str | None] = mapped_column(String(255))
    help_text: Mapped[str | None] = mapped_column(Text)
    validation_rules: Mapped[dict] = mapped_column(JSON, default=dict)
    options: Mapped[list] = mapped_column(JSON, default=list)
    sort_order: Mapped[int] = mapped_column(Integer, default=1)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    request_type: Mapped[RequestTypeSetting] = relationship(back_populates="fields")


class WorkflowTemplateStep(Base):
    __tablename__ = "workflow_template_steps"

    id: Mapped[int] = mapped_column(primary_key=True)
    workflow_template_id: Mapped[int] = mapped_column(ForeignKey("workflow_templates.id", ondelete="CASCADE"), index=True)
    step_name_ar: Mapped[str] = mapped_column(String(160))
    step_name_en: Mapped[str] = mapped_column(String(160))
    step_type: Mapped[str] = mapped_column(String(80))
    approver_role_id: Mapped[int | None] = mapped_column(ForeignKey("roles.id"))
    approver_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    is_mandatory: Mapped[bool] = mapped_column(Boolean, default=True)
    can_reject: Mapped[bool] = mapped_column(Boolean, default=True)
    can_return_for_edit: Mapped[bool] = mapped_column(Boolean, default=False)
    sla_hours: Mapped[int] = mapped_column(Integer, default=8)
    escalation_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    sort_order: Mapped[int] = mapped_column(Integer, default=1)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    template = relationship("WorkflowTemplate")


class NotificationSettings(Base):
    __tablename__ = "notification_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    smtp_host: Mapped[str | None] = mapped_column(String(160))
    smtp_port: Mapped[int] = mapped_column(Integer, default=587)
    smtp_username: Mapped[str | None] = mapped_column(String(160))
    smtp_password: Mapped[str | None] = mapped_column(String(255))
    smtp_tls: Mapped[bool] = mapped_column(Boolean, default=True)
    email_approvals: Mapped[bool] = mapped_column(Boolean, default=True)
    email_rejections: Mapped[bool] = mapped_column(Boolean, default=True)
    request_completed: Mapped[bool] = mapped_column(Boolean, default=True)
    daily_summary: Mapped[bool] = mapped_column(Boolean, default=False)


class SecurityPolicy(Base):
    __tablename__ = "security_policies"

    id: Mapped[int] = mapped_column(primary_key=True)
    password_min_length: Mapped[int] = mapped_column(Integer, default=12)
    require_uppercase: Mapped[bool] = mapped_column(Boolean, default=True)
    require_numbers: Mapped[bool] = mapped_column(Boolean, default=True)
    require_special_chars: Mapped[bool] = mapped_column(Boolean, default=True)
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    lock_after_failed_attempts: Mapped[int] = mapped_column(Integer, default=5)
    password_expiry_days: Mapped[int] = mapped_column(Integer, default=90)


class SlaRule(Base):
    __tablename__ = "sla_rules"

    id: Mapped[int] = mapped_column(primary_key=True)
    request_type: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    response_time_hours: Mapped[int] = mapped_column(Integer)
    resolution_time_hours: Mapped[int] = mapped_column(Integer)
    escalation_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))


class IntegrationConfig(Base):
    __tablename__ = "integration_configs"

    id: Mapped[int] = mapped_column(primary_key=True)
    integration_name: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    settings_json: Mapped[dict] = mapped_column(JSON, default=dict)
    notes: Mapped[str | None] = mapped_column(Text)
