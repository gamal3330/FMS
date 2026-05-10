from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class SavedReport(Base):
    __tablename__ = "saved_reports"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160), index=True)
    description: Mapped[str | None] = mapped_column(Text)
    report_type: Mapped[str] = mapped_column(String(80), index=True)
    filters_json: Mapped[dict] = mapped_column(JSON, default=dict)
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    creator = relationship("User")


class ReportTemplate(Base):
    __tablename__ = "report_templates"

    id: Mapped[int] = mapped_column(primary_key=True)
    name_ar: Mapped[str] = mapped_column(String(160), index=True)
    code: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    report_type: Mapped[str] = mapped_column(String(80), index=True)
    description: Mapped[str | None] = mapped_column(Text)
    default_filters_json: Mapped[dict] = mapped_column(JSON, default=dict)
    default_columns_json: Mapped[list] = mapped_column(JSON, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    creator = relationship("User")


class ScheduledReport(Base):
    __tablename__ = "scheduled_reports"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160), index=True)
    report_template_id: Mapped[int | None] = mapped_column(ForeignKey("report_templates.id"), index=True)
    frequency: Mapped[str] = mapped_column(String(30), default="monthly", index=True)
    run_time: Mapped[str] = mapped_column(String(5), default="08:00")
    recipients_json: Mapped[list] = mapped_column(JSON, default=list)
    export_format: Mapped[str] = mapped_column(String(20), default="excel")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    template = relationship("ReportTemplate")
    creator = relationship("User")


class ReportExportLog(Base):
    __tablename__ = "report_export_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    report_type: Mapped[str] = mapped_column(String(80), index=True)
    export_format: Mapped[str] = mapped_column(String(20), index=True)
    filters_json: Mapped[dict] = mapped_column(JSON, default=dict)
    file_path: Mapped[str | None] = mapped_column(String(500))
    exported_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    exported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    ip_address: Mapped[str | None] = mapped_column(String(64))

    exporter = relationship("User")
