from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class DatabaseStatusResponse(BaseModel):
    status: str
    database_type: str
    database_name: str
    size_mb: float = 0
    tables_count: int = 0
    records_count: int = 0
    last_backup_at: datetime | None = None
    last_restore_at: datetime | None = None
    last_maintenance_at: datetime | None = None
    latency_ms: int = 0


class DatabaseBackupCreateRequest(BaseModel):
    backup_type: str = Field(default="full_backup", pattern="^(database_only|attachments_only|full_backup)$")


class DatabaseBackupResponse(BaseModel):
    id: int
    file_name: str
    backup_type: str
    file_size: int
    checksum: str
    status: str
    created_by: int | None = None
    created_by_name: str | None = None
    created_at: datetime
    verified_at: datetime | None = None
    metadata_json: dict[str, Any] = Field(default_factory=dict)


class DatabaseBackupDeleteRequest(BaseModel):
    admin_password: str = Field(min_length=1, max_length=256)
    confirmation_text: str = Field(default="DELETE BACKUP", max_length=80)


class AdminPasswordConfirmRequest(BaseModel):
    admin_password: str = Field(min_length=1, max_length=256)
    confirmation_text: str = Field(max_length=80)


class RestoreValidateResponse(BaseModel):
    restore_token: str
    status: str
    message: str
    preview: dict[str, Any] = Field(default_factory=dict)


class RestoreConfirmRequest(BaseModel):
    restore_token: str
    admin_password: str = Field(min_length=1, max_length=256)
    confirmation_text: str
    restore_uploads: bool = True


class ResetPreviewResponse(BaseModel):
    scope: str
    tables: list[dict[str, Any]] = Field(default_factory=list)
    attachments_affected: int = 0
    users_affected: int = 0
    settings_affected: int = 0
    warnings: list[str] = Field(default_factory=list)


class ResetConfirmRequest(BaseModel):
    scope: str
    admin_password: str = Field(min_length=1, max_length=256)
    confirmation_text: str
    delete_upload_files: bool = False
    understand_risk: bool = False


class DatabaseJobResponse(BaseModel):
    id: int
    job_type: str
    status: str
    progress: int
    message: str | None = None
    started_by: int | None = None
    started_by_name: str | None = None
    started_at: datetime
    completed_at: datetime | None = None
    details_json: dict[str, Any] = Field(default_factory=dict)


class DatabaseTableInfoResponse(BaseModel):
    table_name: str
    category: str
    records_count: int
    size_mb: float = 0
    last_updated_at: datetime | None = None
    description: str


class DatabaseActivityLogResponse(BaseModel):
    id: int
    action: str
    user: str | None = None
    created_at: datetime
    ip_address: str | None = None
    result: str
    details: dict[str, Any] = Field(default_factory=dict)


class DatabaseBackupSettingsRead(BaseModel):
    id: int
    auto_backup_enabled: bool = False
    backup_time: str = "02:00"
    frequency: str = "daily"
    retention_count: int = 7
    backup_location: str = "backups"
    include_uploads: bool = True
    compress_backups: bool = True
    encrypt_backups: bool = False
    notify_on_failure: bool = True
    updated_at: datetime


class DatabaseBackupSettingsUpdate(BaseModel):
    auto_backup_enabled: bool = False
    backup_time: str = Field(default="02:00", pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    frequency: str = Field(default="daily", pattern="^(daily|weekly|monthly)$")
    retention_count: int = Field(default=7, ge=1, le=365)
    backup_location: str = Field(default="backups", max_length=500)
    include_uploads: bool = True
    compress_backups: bool = True
    encrypt_backups: bool = False
    notify_on_failure: bool = True
