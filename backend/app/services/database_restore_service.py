from __future__ import annotations

import json
import shutil
import sqlite3
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import verify_password
from app.models.database import DatabaseRestoreJob
from app.models.user import User
from app.services.audit import write_audit
from app.services.database_backup_service import create_backup, sha256_file
from app.services.database_jobs_service import create_job, finish_job
from app.services.database_status_service import PROJECT_ROOT, database_engine_name, sqlite_database_path

settings = get_settings()
RESTORE_CONFIRMATION = "RESTORE DATABASE"


def restore_temp_dir() -> Path:
    path = PROJECT_ROOT / settings.upload_dir / "restore_temp"
    path.mkdir(parents=True, exist_ok=True)
    return path


def validate_sqlite_file(path: Path) -> None:
    try:
        connection = sqlite3.connect(path)
        try:
            result = connection.execute("PRAGMA integrity_check").fetchone()
            if not result or result[0] != "ok":
                raise HTTPException(status_code=400, detail="فشل فحص سلامة ملف SQLite")
            tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
            if not {"users", "service_requests"}.intersection(tables):
                raise HTTPException(status_code=400, detail="الملف لا يبدو نسخة متوافقة مع النظام")
        finally:
            connection.close()
    except sqlite3.Error as exc:
        raise HTTPException(status_code=400, detail="ملف SQLite غير صالح") from exc


def inspect_backup_file(path: Path) -> dict:
    suffix = path.suffix.lower()
    if suffix in {".db", ".sqlite", ".sqlite3"}:
        validate_sqlite_file(path)
        return {
            "backup_type": "database_only",
            "database_file": path.name,
            "contains_uploads": False,
            "tables": [],
            "compatible": True,
            "file_size": path.stat().st_size,
            "checksum": sha256_file(path),
        }
    if suffix != ".zip":
        raise HTTPException(status_code=400, detail="صيغة الملف غير مدعومة. استخدم ZIP أو SQLite")
    try:
        with zipfile.ZipFile(path) as archive:
            names = archive.namelist()
            if "metadata.json" not in names:
                raise HTTPException(status_code=400, detail="ملف النسخة لا يحتوي على metadata.json")
            metadata = json.loads(archive.read("metadata.json").decode("utf-8"))
            database_files = [name for name in names if name.startswith("database/")]
            upload_files = [name for name in names if name.startswith("uploads/")]
            return {
                **metadata,
                "database_files": database_files,
                "contains_uploads": bool(upload_files),
                "uploads_count": len(upload_files),
                "file_size": path.stat().st_size,
                "checksum": sha256_file(path),
                "compatible": bool(database_files or upload_files),
            }
    except zipfile.BadZipFile as exc:
        raise HTTPException(status_code=400, detail="ملف ZIP غير صالح") from exc


async def validate_restore_upload(db: Session, file: UploadFile, actor: User) -> dict:
    suffix = Path(file.filename or "backup.zip").suffix.lower()
    if suffix not in {".zip", ".db", ".sqlite", ".sqlite3"}:
        raise HTTPException(status_code=400, detail="امتداد ملف النسخة غير مدعوم")
    token = uuid4().hex
    temp_path = restore_temp_dir() / f"{token}{suffix}"
    with temp_path.open("wb") as handle:
        while chunk := await file.read(1024 * 1024):
            handle.write(chunk)
    metadata = inspect_backup_file(temp_path)
    preview = {
        "تاريخ النسخة": metadata.get("created_at") or "-",
        "نوع النسخة": metadata.get("backup_type") or "-",
        "حجم النسخة": metadata.get("file_size") or temp_path.stat().st_size,
        "الجداول الموجودة": len(metadata.get("tables") or []),
        "عدد السجلات المتوقع": (metadata.get("status") or {}).get("records_count"),
        "هل تحتوي على مرفقات": bool(metadata.get("contains_uploads")),
        "هل ستؤثر على المرفقات الحالية": bool(metadata.get("contains_uploads")),
        "checksum": metadata.get("checksum"),
    }
    job = DatabaseRestoreJob(
        status="validated",
        started_by=actor.id,
        result_message="تم التحقق الأولي من النسخة",
        details_json={"restore_token": token, "temp_path": str(temp_path), "metadata": metadata, "preview": preview},
    )
    db.add(job)
    write_audit(db, "restore_validated", "database", actor=actor, entity_id=token, metadata={"file_name": file.filename, "preview": preview})
    db.commit()
    return {"restore_token": token, "status": "validated", "message": "تم التحقق من النسخة. راجع المعاينة قبل الاستعادة.", "preview": preview}


def confirm_restore(db: Session, payload, actor: User) -> dict:
    if payload.confirmation_text != RESTORE_CONFIRMATION:
        raise HTTPException(status_code=422, detail="عبارة التأكيد غير صحيحة")
    if not verify_password(payload.admin_password, actor.hashed_password):
        raise HTTPException(status_code=403, detail="كلمة مرور مدير النظام غير صحيحة")
    restore_job = next((job for job in db.query(DatabaseRestoreJob).order_by(DatabaseRestoreJob.started_at.desc()).all() if (job.details_json or {}).get("restore_token") == payload.restore_token), None)
    if not restore_job:
        raise HTTPException(status_code=404, detail="رمز الاستعادة غير صالح أو منتهي")
    temp_path = Path((restore_job.details_json or {}).get("temp_path", ""))
    if not temp_path.exists():
        raise HTTPException(status_code=404, detail="ملف الاستعادة المؤقت غير موجود")
    job = create_job(db, "restore", actor, "جاري إنشاء نسخة أمان قبل الاستعادة")
    try:
        create_backup(db, actor, "full_backup")
        if database_engine_name() != "sqlite":
            raise HTTPException(status_code=409, detail="الاستعادة المباشرة من الواجهة متاحة حالياً لـ SQLite فقط. استخدم pg_restore لقواعد PostgreSQL من السيرفر.")
        target = sqlite_database_path()
        target.parent.mkdir(parents=True, exist_ok=True)
        if temp_path.suffix.lower() == ".zip":
            with tempfile.TemporaryDirectory() as tmp:
                with zipfile.ZipFile(temp_path) as archive:
                    db_files = [name for name in archive.namelist() if name.startswith("database/")]
                    if not db_files:
                        raise HTTPException(status_code=400, detail="النسخة لا تحتوي على ملف قاعدة بيانات")
                    extracted = Path(archive.extract(db_files[0], tmp))
                    validate_sqlite_file(extracted)
                    shutil.copy2(extracted, target)
        else:
            validate_sqlite_file(temp_path)
            shutil.copy2(temp_path, target)
        restore_job.status = "success"
        restore_job.completed_at = datetime.now(timezone.utc)
        restore_job.result_message = "تمت الاستعادة بنجاح"
        finish_job(db, job, "success", "تمت الاستعادة بنجاح", details={"restore_token": payload.restore_token})
        write_audit(db, "restore_completed", "database", actor=actor, entity_id=payload.restore_token, metadata={"status": "success"})
        return {"message": "تمت الاستعادة بنجاح", "job_id": job.id}
    except Exception as exc:
        restore_job.status = "failed"
        restore_job.completed_at = datetime.now(timezone.utc)
        restore_job.result_message = str(getattr(exc, "detail", exc))[:700]
        finish_job(db, job, "failed", restore_job.result_message)
        write_audit(db, "restore_completed", "database", actor=actor, entity_id=payload.restore_token, metadata={"status": "failed", "error": restore_job.result_message})
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(status_code=500, detail="فشلت عملية الاستعادة") from exc
    finally:
        temp_path.unlink(missing_ok=True)
        db.commit()
