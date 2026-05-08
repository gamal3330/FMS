from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class DatabaseBackup(Base):
    __tablename__ = "database_backups"

    id: Mapped[int] = mapped_column(primary_key=True)
    file_name: Mapped[str] = mapped_column(String(255), index=True)
    file_path: Mapped[str] = mapped_column(String(700))
    backup_type: Mapped[str] = mapped_column(String(40), index=True)
    file_size: Mapped[int] = mapped_column(Integer, default=0)
    checksum: Mapped[str] = mapped_column(String(128), index=True)
    status: Mapped[str] = mapped_column(String(40), default="ready", index=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)

    creator = relationship("User", foreign_keys=[created_by])


class DatabaseJob(Base):
    __tablename__ = "database_jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    job_type: Mapped[str] = mapped_column(String(40), index=True)
    status: Mapped[str] = mapped_column(String(40), default="pending", index=True)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    message: Mapped[str | None] = mapped_column(String(500))
    started_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    details_json: Mapped[dict] = mapped_column(JSON, default=dict)

    starter = relationship("User", foreign_keys=[started_by])


class DatabaseRestoreJob(Base):
    __tablename__ = "database_restore_jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    backup_id: Mapped[int | None] = mapped_column(ForeignKey("database_backups.id"), index=True)
    status: Mapped[str] = mapped_column(String(40), default="validated", index=True)
    started_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    result_message: Mapped[str | None] = mapped_column(String(700))
    details_json: Mapped[dict] = mapped_column(JSON, default=dict)

    backup = relationship("DatabaseBackup")
    starter = relationship("User", foreign_keys=[started_by])


class DatabaseMaintenanceLog(Base):
    __tablename__ = "database_maintenance_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    action: Mapped[str] = mapped_column(String(80), index=True)
    status: Mapped[str] = mapped_column(String(40), index=True)
    message: Mapped[str | None] = mapped_column(String(700))
    details_json: Mapped[dict] = mapped_column(JSON, default=dict)
    executed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    executed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

    executor = relationship("User", foreign_keys=[executed_by])


class DatabaseBackupSettings(Base):
    __tablename__ = "database_backup_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    auto_backup_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    backup_time: Mapped[str] = mapped_column(String(5), default="02:00")
    frequency: Mapped[str] = mapped_column(String(20), default="daily")
    retention_count: Mapped[int] = mapped_column(Integer, default=7)
    backup_location: Mapped[str] = mapped_column(String(500), default="backups")
    include_uploads: Mapped[bool] = mapped_column(Boolean, default=True)
    compress_backups: Mapped[bool] = mapped_column(Boolean, default=True)
    encrypt_backups: Mapped[bool] = mapped_column(Boolean, default=False)
    notify_on_failure: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
