from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, Integer, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class SystemHealthCheck(Base):
    __tablename__ = "system_health_checks"

    id: Mapped[int] = mapped_column(primary_key=True)
    check_name: Mapped[str] = mapped_column(String(80), index=True)
    category: Mapped[str | None] = mapped_column(String(80), index=True)
    status: Mapped[str] = mapped_column(String(20), index=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    message: Mapped[str | None] = mapped_column(Text)
    details_json: Mapped[dict] = mapped_column(JSON, default=dict)
    checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class SystemAlert(Base):
    __tablename__ = "system_alerts"

    id: Mapped[int] = mapped_column(primary_key=True)
    alert_type: Mapped[str] = mapped_column(String(80), index=True)
    severity: Mapped[str] = mapped_column(String(20), index=True)
    message: Mapped[str] = mapped_column(Text)
    is_resolved: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SystemHealthAlert(Base):
    __tablename__ = "system_health_alerts"

    id: Mapped[int] = mapped_column(primary_key=True)
    alert_type: Mapped[str] = mapped_column(String(80), index=True)
    severity: Mapped[str] = mapped_column(String(20), index=True)
    title: Mapped[str] = mapped_column(String(180))
    message: Mapped[str] = mapped_column(Text)
    recommended_action: Mapped[str | None] = mapped_column(Text)
    related_route: Mapped[str | None] = mapped_column(String(255))
    is_resolved: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_by: Mapped[int | None] = mapped_column(Integer)


class SystemHealthMetric(Base):
    __tablename__ = "system_health_metrics"

    id: Mapped[int] = mapped_column(primary_key=True)
    metric_name: Mapped[str] = mapped_column(String(120), index=True)
    metric_value: Mapped[float] = mapped_column(Float)
    metric_unit: Mapped[str | None] = mapped_column(String(40))
    category: Mapped[str] = mapped_column(String(80), index=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class SystemHealthSettings(Base):
    __tablename__ = "system_health_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    disk_warning_percent: Mapped[int] = mapped_column(Integer, default=80)
    disk_critical_percent: Mapped[int] = mapped_column(Integer, default=90)
    errors_warning_count: Mapped[int] = mapped_column(Integer, default=10)
    errors_critical_count: Mapped[int] = mapped_column(Integer, default=50)
    db_latency_warning_ms: Mapped[int] = mapped_column(Integer, default=300)
    db_latency_critical_ms: Mapped[int] = mapped_column(Integer, default=1000)
    auto_check_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    auto_check_interval_minutes: Mapped[int] = mapped_column(Integer, default=15)
    retention_days: Mapped[int] = mapped_column(Integer, default=30)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
