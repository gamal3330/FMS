from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class SystemVersion(Base):
    __tablename__ = "system_versions"

    id: Mapped[int] = mapped_column(primary_key=True)
    version: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    build_number: Mapped[str | None] = mapped_column(String(80))
    commit_hash: Mapped[str | None] = mapped_column(String(80))
    deployed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    is_current: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    source: Mapped[str] = mapped_column(String(80), default="local")
    status: Mapped[str] = mapped_column(String(30), default="installed", index=True)
    notes: Mapped[str | None] = mapped_column(Text)
    installed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

    deployer = relationship("User")


class UpdateHistory(Base):
    __tablename__ = "update_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    from_version: Mapped[str | None] = mapped_column(String(40), index=True)
    to_version: Mapped[str] = mapped_column(String(40), index=True)
    status: Mapped[str] = mapped_column(String(30), index=True)
    message: Mapped[str | None] = mapped_column(Text)
    details_json: Mapped[dict] = mapped_column(JSON, default=dict)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AppliedMigration(Base):
    __tablename__ = "applied_migrations"
    __table_args__ = (UniqueConstraint("migration_id", name="uq_applied_migration_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    migration_id: Mapped[str] = mapped_column(String(120), index=True)
    version: Mapped[str] = mapped_column(String(40), index=True)
    name: Mapped[str] = mapped_column(String(180))
    checksum: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(30), default="success", index=True)
    message: Mapped[str | None] = mapped_column(Text)
    execution_ms: Mapped[int | None] = mapped_column(Integer)
    applied_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class UpdatePackage(Base):
    __tablename__ = "update_packages"

    id: Mapped[int] = mapped_column(primary_key=True)
    file_name: Mapped[str] = mapped_column(String(255))
    file_path: Mapped[str] = mapped_column(String(500))
    version: Mapped[str | None] = mapped_column(String(40), index=True)
    checksum: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(40), default="uploaded", index=True)
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    validated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)

    uploader = relationship("User")


class UpdateJob(Base):
    __tablename__ = "update_jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    job_type: Mapped[str] = mapped_column(String(40), index=True)
    from_version: Mapped[str | None] = mapped_column(String(40))
    to_version: Mapped[str | None] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(30), default="pending", index=True)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    message: Mapped[str | None] = mapped_column(Text)
    started_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    details_json: Mapped[dict] = mapped_column(JSON, default=dict)

    starter = relationship("User")


class RollbackPoint(Base):
    __tablename__ = "rollback_points"

    id: Mapped[int] = mapped_column(primary_key=True)
    version: Mapped[str] = mapped_column(String(40), index=True)
    database_backup_id: Mapped[int | None] = mapped_column(ForeignKey("database_backups.id"))
    uploads_backup_id: Mapped[int | None] = mapped_column(ForeignKey("database_backups.id"))
    config_backup_path: Mapped[str | None] = mapped_column(String(500))
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    status: Mapped[str] = mapped_column(String(40), default="ready", index=True)
    details_json: Mapped[dict] = mapped_column(JSON, default=dict)

    creator = relationship("User")
    database_backup = relationship("DatabaseBackup", foreign_keys=[database_backup_id])
    uploads_backup = relationship("DatabaseBackup", foreign_keys=[uploads_backup_id])


class UpdateLog(Base):
    __tablename__ = "update_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    update_job_id: Mapped[int | None] = mapped_column(ForeignKey("update_jobs.id"))
    step_name: Mapped[str] = mapped_column(String(120), index=True)
    status: Mapped[str] = mapped_column(String(30), index=True)
    message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

    job = relationship("UpdateJob")


class UpdateSettings(Base):
    __tablename__ = "update_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    enable_maintenance_mode_during_update: Mapped[bool] = mapped_column(Boolean, default=True)
    auto_backup_before_update: Mapped[bool] = mapped_column(Boolean, default=True)
    auto_health_check_after_update: Mapped[bool] = mapped_column(Boolean, default=True)
    auto_rollback_on_failed_health_check: Mapped[bool] = mapped_column(Boolean, default=False)
    retain_rollback_points_count: Mapped[int] = mapped_column(Integer, default=5)
    block_updates_in_production_without_flag: Mapped[bool] = mapped_column(Boolean, default=True)
    allow_local_update_upload: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
