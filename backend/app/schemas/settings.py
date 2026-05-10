from datetime import datetime

from pydantic import BaseModel, Field


class SettingsGeneralPayload(BaseModel):
    system_name: str
    login_intro_text: str = Field(
        default="منصة داخلية موحدة لاستقبال الطلبات، تتبع مراحل الاعتماد، مراقبة مؤشرات الخدمة، وتوثيق الأثر التشغيلي.",
        max_length=500,
    )
    logo_url: str | None = None
    brand_color: str = Field(default="#0d6337", pattern=r"^#[0-9A-Fa-f]{6}$")
    language: str
    timezone: str = Field(default="Asia/Qatar", max_length=80)
    session_timeout_minutes: int = Field(ge=5, le=1440)
    upload_max_file_size_mb: int = Field(ge=1, le=200)
    allowed_file_extensions: str


class SettingsGeneralRead(SettingsGeneralPayload):
    id: int
    updated_at: datetime

    model_config = {"from_attributes": True}


class PortalSettingPayload(BaseModel):
    category: str = Field(max_length=80)
    setting_key: str = Field(max_length=120)
    setting_value: dict = Field(default_factory=dict)


class PortalSettingRead(PortalSettingPayload):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SettingsDepartmentCreate(BaseModel):
    name_ar: str
    name_en: str
    code: str
    manager_id: int | None = None
    is_active: bool = True


class SettingsDepartmentRead(SettingsDepartmentCreate):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SpecializedSectionPayload(BaseModel):
    name_ar: str = Field(max_length=120)
    name_en: str | None = Field(default=None, max_length=120)
    code: str = Field(max_length=40, pattern=r"^[A-Za-z0-9_-]+$")
    department_id: int | None = None
    description: str | None = None
    is_active: bool = True


class SpecializedSectionRead(SpecializedSectionPayload):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class WorkflowApprovalPayload(BaseModel):
    request_type: str
    step_order: int
    approver_role: str
    is_mandatory: bool = True
    sla_hours: int = Field(default=8, ge=1, le=720)


class WorkflowApprovalRead(WorkflowApprovalPayload):
    id: int

    model_config = {"from_attributes": True}


class RequestTypeConfigPayload(BaseModel):
    request_type: str
    label_ar: str
    label_en: str
    is_enabled: bool = True
    require_attachment: bool = False
    auto_priority: str | None = None
    default_approvers: list[str] = Field(default_factory=list)


class RequestTypeConfigRead(RequestTypeConfigPayload):
    id: int

    model_config = {"from_attributes": True}


class SlaConfigPayload(BaseModel):
    request_type: str
    response_time_hours: int = Field(ge=1, le=720)
    resolution_time_hours: int = Field(ge=1, le=1440)
    escalation_user_id: int | None = None


class SlaConfigRead(SlaConfigPayload):
    id: int

    model_config = {"from_attributes": True}


class IntegrationConfigPayload(BaseModel):
    integration_name: str
    is_enabled: bool = False
    settings_json: dict = Field(default_factory=dict)
    notes: str | None = None


class IntegrationConfigRead(IntegrationConfigPayload):
    id: int

    model_config = {"from_attributes": True}


class NotificationSettingsPayload(BaseModel):
    smtp_host: str | None = None
    smtp_port: int = Field(default=587, ge=1, le=65535)
    smtp_from_email: str | None = None
    smtp_from_name: str | None = None
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_tls: bool = True
    email_approvals: bool = True
    email_rejections: bool = True
    request_completed: bool = True
    daily_summary: bool = False


class NotificationSettingsRead(NotificationSettingsPayload):
    id: int

    model_config = {"from_attributes": True}


class BackupSettingsPayload(BaseModel):
    auto_backup_enabled: bool = False
    backup_time: str = Field(default="02:00", pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    retention_count: int = Field(default=7, ge=1, le=365)
    backup_path: str = Field(default="backups", max_length=500)
    notify_on_failure: bool = True


class BackupSettingsRead(BackupSettingsPayload):
    pass


class SecurityPolicyPayload(BaseModel):
    password_min_length: int = Field(default=12, ge=1, le=128)
    require_uppercase: bool = True
    require_numbers: bool = True
    require_special_chars: bool = True
    mfa_enabled: bool = False
    login_identifier_mode: str = Field(default="email_or_employee_id", pattern="^(email|employee_id|email_or_employee_id)$")
    temporary_password: str = Field(default="Change@12345", min_length=1, max_length=128)
    lock_after_failed_attempts: int = Field(default=5, ge=1, le=20)
    password_expiry_days: int = Field(default=90, ge=1, le=365)


class SecurityPolicyRead(SecurityPolicyPayload):
    id: int

    model_config = {"from_attributes": True}
