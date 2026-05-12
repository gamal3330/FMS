from __future__ import annotations

import shutil
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.database import DatabaseMaintenanceLog
from app.models.message import InternalMessageAttachment
from app.models.request import Attachment
from app.models.user import User
from app.services.audit import write_audit
from app.services.database_backup_service import create_backup
from app.services.database_jobs_service import create_job, finish_job
from app.services.database_status_service import database_engine_name

settings = get_settings()


def log_maintenance(db: Session, action: str, status: str, message: str, actor: User, details: dict | None = None) -> dict:
    row = DatabaseMaintenanceLog(action=action, status=status, message=message, details_json=details or {}, executed_by=actor.id)
    db.add(row)
    write_audit(db, "maintenance_run", "database", actor=actor, entity_id=action, metadata={"status": status, "message": message, **(details or {})})
    db.commit()
    return {"action": action, "status": status, "message": message, "details": details or {}}


def run_connection_test(db: Session, actor: User) -> dict:
    try:
        db.execute(text("SELECT 1")).scalar_one()
        return log_maintenance(db, "test_connection", "success", "الاتصال بقاعدة البيانات ناجح", actor)
    except Exception as exc:
        return log_maintenance(db, "test_connection", "failed", "فشل الاتصال بقاعدة البيانات", actor, {"error": str(exc)[:300]})


def check_integrity(db: Session, actor: User) -> dict:
    engine_name = database_engine_name()
    if engine_name == "sqlite":
        result = db.execute(text("PRAGMA integrity_check")).scalar_one()
        return log_maintenance(db, "check_integrity", "success" if result == "ok" else "failed", str(result), actor)
    db.execute(text("SELECT 1")).scalar_one()
    return log_maintenance(db, "check_integrity", "success", "تم تنفيذ فحص اتصال وسلامة أساسي لقواعد PostgreSQL", actor)


def execute_maintenance_command(db: Session, command: str) -> None:
    bind = db.get_bind()
    with bind.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
        connection.execute(text(command))


def optimize_database(db: Session, actor: User) -> dict:
    engine_name = database_engine_name()
    job = create_job(db, "maintenance", actor, "جاري تحسين قاعدة البيانات")
    db.commit()
    try:
        if engine_name == "sqlite":
            execute_maintenance_command(db, "VACUUM")
        elif engine_name == "postgresql":
            execute_maintenance_command(db, "ANALYZE")
        else:
            db.execute(text("SELECT 1"))
        job = db.merge(job)
        finish_job(db, job, "success", "تم تحسين قاعدة البيانات")
        return log_maintenance(db, "optimize", "success", "تم تحسين قاعدة البيانات", actor, {"job_id": job.id})
    except Exception as exc:
        db.rollback()
        job = db.merge(job)
        finish_job(db, job, "failed", str(exc)[:500])
        db.commit()
        raise HTTPException(status_code=500, detail="فشل تحسين قاعدة البيانات") from exc


def reindex_database(db: Session, actor: User) -> dict:
    if database_engine_name() == "sqlite":
        db.execute(text("REINDEX"))
        return log_maintenance(db, "reindex", "success", "تمت إعادة بناء الفهارس", actor)
    return log_maintenance(db, "reindex", "warning", "PostgreSQL REINDEX عملية طويلة؛ نفذها من نافذة صيانة مخصصة عند الحاجة", actor)


def analyze_database(db: Session, actor: User) -> dict:
    db.execute(text("ANALYZE"))
    return log_maintenance(db, "analyze", "success", "تم تحديث إحصائيات قاعدة البيانات", actor)


def clean_temp_files(db: Session, actor: User) -> dict:
    temp_dir = Path(settings.upload_dir) / "restore_temp"
    removed = 0
    if temp_dir.exists():
        for item in temp_dir.iterdir():
            if item.is_file():
                item.unlink(missing_ok=True)
                removed += 1
            elif item.is_dir():
                shutil.rmtree(item, ignore_errors=True)
                removed += 1
    return log_maintenance(db, "clean_temp", "success", "تم تنظيف الملفات المؤقتة", actor, {"removed": removed})


def check_orphan_attachments(db: Session, actor: User) -> dict:
    uploads = Path(settings.upload_dir)
    if not uploads.is_absolute():
        uploads = Path.cwd() / uploads
    stored = set(db.scalars(select(Attachment.stored_name)).all()) | set(db.scalars(select(InternalMessageAttachment.stored_name)).all())
    files = {item.name for item in uploads.rglob("*") if item.is_file()} if uploads.exists() else set()
    missing = [name for name in stored if name and name not in files]
    orphan = [name for name in files if name not in stored and "database_backups" not in name]
    return log_maintenance(db, "check_orphan_attachments", "success", "تم فحص المرفقات", actor, {"missing": missing[:100], "orphan": orphan[:100], "missing_count": len(missing), "orphan_count": len(orphan)})


def migration_status(db: Session) -> dict:
    return {"status": "healthy", "pending": [], "message": "لا توجد ترحيلات معلقة معروفة من داخل النظام"}


def run_migrations(db: Session, actor: User) -> dict:
    job = create_job(db, "migration", actor, "جاري التحضير لتشغيل الترحيلات")
    create_backup(db, actor, "full_backup")
    finish_job(db, job, "success", "لا توجد ترحيلات معلقة للتنفيذ", details={"pending": []})
    write_audit(db, "migration_run", "database", actor=actor, metadata={"status": "success", "pending": []})
    db.commit()
    return {"message": "لا توجد ترحيلات معلقة للتنفيذ", "job_id": job.id, "pending": []}
