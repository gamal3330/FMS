from __future__ import annotations

from pydantic import BaseModel, Field


class UpdateSettingsPayload(BaseModel):
    enable_maintenance_mode_during_update: bool = True
    auto_backup_before_update: bool = True
    auto_health_check_after_update: bool = True
    auto_rollback_on_failed_health_check: bool = False
    retain_rollback_points_count: int = Field(default=5, ge=1, le=50)
    block_updates_in_production_without_flag: bool = True
    allow_local_update_upload: bool = True


class UpdateConfirmPayload(BaseModel):
    package_id: int | None = None
    admin_password: str = Field(min_length=1, max_length=256)
    confirmation_text: str = Field(min_length=1, max_length=80)
    understood: bool = False


class UpdatePackageActionPayload(BaseModel):
    package_id: int


class RollbackConfirmPayload(BaseModel):
    admin_password: str = Field(min_length=1, max_length=256)
    confirmation_text: str = Field(min_length=1, max_length=80)
