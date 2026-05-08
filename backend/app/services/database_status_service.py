from __future__ import annotations

import time
from datetime import datetime
from pathlib import Path

from sqlalchemy import inspect, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import engine
from app.models.database import DatabaseBackup, DatabaseMaintenanceLog, DatabaseRestoreJob

settings = get_settings()
PROJECT_ROOT = Path.cwd().parent if Path.cwd().name == "backend" else Path.cwd()

TABLE_CATEGORIES: dict[str, tuple[str, str]] = {
    "users": ("المستخدمون والصلاحيات", "جدول المستخدمين"),
    "roles": ("المستخدمون والصلاحيات", "الأدوار"),
    "departments": ("المستخدمون والصلاحيات", "الإدارات"),
    "service_requests": ("الطلبات والموافقات", "طلبات الخدمة"),
    "approval_steps": ("الطلبات والموافقات", "مراحل الموافقة"),
    "request_approval_steps": ("الطلبات والموافقات", "مسارات الموافقة التفصيلية"),
    "request_comments": ("الطلبات والموافقات", "تعليقات الطلبات"),
    "internal_messages": ("المراسلات", "الرسائل الداخلية"),
    "internal_message_recipients": ("المراسلات", "مستلمو الرسائل"),
    "internal_message_attachments": ("المرفقات", "مرفقات المراسلات"),
    "attachments": ("المرفقات", "مرفقات الطلبات"),
    "portal_settings": ("الإعدادات", "إعدادات النظام العامة"),
    "settings_general": ("الإعدادات", "الإعدادات العامة"),
    "audit_logs": ("السجلات والتدقيق", "سجل التدقيق"),
    "database_backups": ("النظام", "سجل النسخ الاحتياطية"),
    "database_jobs": ("النظام", "مهام قاعدة البيانات"),
}


def database_url():
    return make_url(settings.database_url)


def database_engine_name() -> str:
    return database_url().drivername.split("+", 1)[0].lower()


def database_type_label() -> str:
    name = database_engine_name()
    if name == "sqlite":
        return "SQLite"
    if name == "postgresql":
        return "PostgreSQL"
    return name.upper()


def sqlite_database_path() -> Path:
    url = database_url()
    database = url.database or ""
    path = Path(database)
    return path if path.is_absolute() else Path.cwd() / path


def safe_database_name() -> str:
    url = database_url()
    if database_engine_name() == "sqlite":
        return Path(url.database or "database.sqlite").name
    return url.database or "-"


def database_size_bytes(db: Session) -> int:
    if database_engine_name() == "sqlite":
        path = sqlite_database_path()
        return path.stat().st_size if path.exists() else 0
    if database_engine_name() == "postgresql":
        try:
            return int(db.execute(text("SELECT pg_database_size(current_database())")).scalar_one() or 0)
        except Exception:
            return 0
    return 0


def user_table_names() -> list[str]:
    inspector = inspect(engine)
    return [name for name in inspector.get_table_names() if not name.startswith("sqlite_")]


def quote_table(table_name: str) -> str:
    return engine.dialect.identifier_preparer.quote(table_name)


def table_count(db: Session, table_name: str) -> int:
    try:
        return int(db.execute(text(f"SELECT COUNT(*) FROM {quote_table(table_name)}")).scalar_one() or 0)
    except Exception:
        return 0


def table_size_mb(db: Session, table_name: str) -> float:
    if database_engine_name() == "postgresql":
        try:
            value = int(db.execute(text("SELECT pg_total_relation_size(:name)"), {"name": table_name}).scalar_one() or 0)
            return round(value / 1024 / 1024, 2)
        except Exception:
            return 0
    return 0


def table_category(table_name: str) -> tuple[str, str]:
    if table_name in TABLE_CATEGORIES:
        return TABLE_CATEGORIES[table_name]
    if table_name.startswith("request_") or table_name.endswith("_requests"):
        return ("الطلبات والموافقات", "جدول مرتبط بالطلبات")
    if table_name.startswith("internal_message"):
        return ("المراسلات", "جدول مرتبط بالمراسلات")
    if "setting" in table_name:
        return ("الإعدادات", "جدول إعدادات")
    if "log" in table_name or "audit" in table_name:
        return ("السجلات والتدقيق", "جدول سجلات")
    return ("النظام", "جدول نظام")


def database_status(db: Session) -> dict:
    started = time.perf_counter()
    status = "healthy"
    try:
        db.execute(text("SELECT 1")).scalar_one()
    except Exception:
        status = "critical"
    latency_ms = int((time.perf_counter() - started) * 1000)
    tables = user_table_names()
    records_count = sum(table_count(db, table) for table in tables)
    last_backup = db.scalar(select(DatabaseBackup.created_at).order_by(DatabaseBackup.created_at.desc()).limit(1))
    last_restore = db.scalar(select(DatabaseRestoreJob.completed_at).where(DatabaseRestoreJob.status == "success").order_by(DatabaseRestoreJob.completed_at.desc()).limit(1))
    last_maintenance = db.scalar(select(DatabaseMaintenanceLog.executed_at).order_by(DatabaseMaintenanceLog.executed_at.desc()).limit(1))
    return {
        "status": status,
        "database_type": database_type_label(),
        "database_name": safe_database_name(),
        "size_mb": round(database_size_bytes(db) / 1024 / 1024, 2),
        "tables_count": len(tables),
        "records_count": records_count,
        "last_backup_at": last_backup,
        "last_restore_at": last_restore,
        "last_maintenance_at": last_maintenance,
        "latency_ms": latency_ms,
    }


def database_tables(db: Session) -> list[dict]:
    rows = []
    for table in user_table_names():
        category, description = table_category(table)
        rows.append(
            {
                "table_name": table,
                "category": category,
                "records_count": table_count(db, table),
                "size_mb": table_size_mb(db, table),
                "last_updated_at": None,
                "description": description,
            }
        )
    return sorted(rows, key=lambda item: (item["category"], item["table_name"]))
