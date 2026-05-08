from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.config import get_settings
from app.models.database import DatabaseBackup, DatabaseBackupSettings
from app.models.user import User
from app.services.audit import write_audit
from app.services.database_jobs_service import create_job, finish_job
from app.services.database_status_service import PROJECT_ROOT, database_engine_name, database_status, database_tables, database_url, safe_database_name, sqlite_database_path

settings = get_settings()
BACKUP_TYPES = {"database_only", "attachments_only", "full_backup"}


def backup_settings(db: Session) -> DatabaseBackupSettings:
    item = db.scalar(select(DatabaseBackupSettings).limit(1))
    if item:
        return item
    item = DatabaseBackupSettings()
    db.add(item)
    db.flush()
    return item


def backups_root(db: Session | None = None) -> Path:
    location = "backups"
    if db is not None:
        location = backup_settings(db).backup_location or "backups"
    path = Path(location)
    if not path.is_absolute():
        path = PROJECT_ROOT / path
    path.mkdir(parents=True, exist_ok=True)
    return path


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def backup_to_dict(row: DatabaseBackup) -> dict:
    return {
        "id": row.id,
        "file_name": row.file_name,
        "backup_type": row.backup_type,
        "file_size": row.file_size,
        "checksum": row.checksum,
        "status": row.status,
        "created_by": row.created_by,
        "created_by_name": row.creator.full_name_ar if row.creator else None,
        "created_at": row.created_at,
        "verified_at": row.verified_at,
        "metadata_json": row.metadata_json or {},
    }


def list_backups(db: Session) -> list[dict]:
    rows = db.scalars(select(DatabaseBackup).options(selectinload(DatabaseBackup.creator)).order_by(DatabaseBackup.created_at.desc())).all()
    return [backup_to_dict(row) for row in rows]


def pg_dump_file(output_path: Path) -> None:
    if not shutil.which("pg_dump"):
        raise HTTPException(status_code=409, detail="أداة pg_dump غير مثبتة على الخادم")
    url = database_url()
    command = ["pg_dump", "--format=custom", "--no-owner", "--no-privileges", "--file", str(output_path)]
    if url.host:
        command.extend(["--host", url.host])
    if url.port:
        command.extend(["--port", str(url.port)])
    if url.username:
        command.extend(["--username", url.username])
    if url.database:
        command.extend(["--dbname", url.database])
    env = os.environ.copy()
    if url.password:
        env["PGPASSWORD"] = url.password
    result = subprocess.run(command, env=env, cwd=str(PROJECT_ROOT), capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        raise HTTPException(status_code=500, detail=f"فشل إنشاء نسخة PostgreSQL: {result.stderr.strip() or result.stdout.strip()}")


def add_uploads_to_zip(archive: zipfile.ZipFile) -> int:
    uploads = Path(settings.upload_dir)
    if not uploads.is_absolute():
        uploads = PROJECT_ROOT / uploads
    count = 0
    if not uploads.exists():
        return 0
    for item in uploads.rglob("*"):
        if not item.is_file():
            continue
        if "database_backups" in item.parts or "restore_temp" in item.parts:
            continue
        archive.write(item, f"uploads/{item.relative_to(uploads)}")
        count += 1
    return count


def purge_old_backups(db: Session) -> None:
    retention = backup_settings(db).retention_count or 7
    rows = db.scalars(select(DatabaseBackup).order_by(DatabaseBackup.created_at.desc())).all()
    for row in rows[retention:]:
        try:
            Path(row.file_path).unlink(missing_ok=True)
        except Exception:
            pass
        row.status = "deleted_by_retention"


def create_backup(db: Session, actor: User, backup_type: str = "full_backup") -> tuple[dict, int]:
    if backup_type not in BACKUP_TYPES:
        raise HTTPException(status_code=422, detail="نوع النسخة غير صحيح")
    job = create_job(db, "backup", actor, "جاري إنشاء نسخة احتياطية")
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    archive_name = f"qib-{backup_type}-{timestamp}.zip"
    archive_path = backups_root(db) / archive_name
    metadata = {
        "backup_type": backup_type,
        "database_type": database_engine_name(),
        "database_name": safe_database_name(),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "system": "QIB Service Portal",
        "tables": database_tables(db),
        "status": database_status(db),
    }
    try:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                if backup_type in {"database_only", "full_backup"}:
                    if database_engine_name() == "sqlite":
                        db_path = sqlite_database_path()
                        if not db_path.exists():
                            raise HTTPException(status_code=404, detail="ملف قاعدة البيانات غير موجود")
                        archive.write(db_path, f"database/{db_path.name}")
                        metadata["database_file"] = f"database/{db_path.name}"
                    elif database_engine_name() == "postgresql":
                        dump_path = tmp_path / f"{safe_database_name()}.dump"
                        pg_dump_file(dump_path)
                        archive.write(dump_path, f"database/{dump_path.name}")
                        metadata["database_file"] = f"database/{dump_path.name}"
                    else:
                        raise HTTPException(status_code=409, detail="نوع قاعدة البيانات غير مدعوم للنسخ من الواجهة")
                if backup_type in {"attachments_only", "full_backup"}:
                    metadata["uploads_count"] = add_uploads_to_zip(archive)
                archive.writestr("metadata.json", json.dumps(metadata, ensure_ascii=False, indent=2))
        checksum = sha256_file(archive_path)
        row = DatabaseBackup(
            file_name=archive_name,
            file_path=str(archive_path),
            backup_type=backup_type,
            file_size=archive_path.stat().st_size,
            checksum=checksum,
            status="ready",
            created_by=actor.id,
            metadata_json={**metadata, "checksum": checksum},
        )
        db.add(row)
        db.flush()
        purge_old_backups(db)
        finish_job(db, job, "success", "تم إنشاء النسخة الاحتياطية", details={"backup_id": row.id, "file_name": row.file_name})
        write_audit(db, "backup_created", "database", actor=actor, entity_id=str(row.id), metadata={"backup_type": backup_type, "file_name": archive_name})
        db.commit()
        db.refresh(row)
        return backup_to_dict(row), job.id
    except Exception as exc:
        archive_path.unlink(missing_ok=True)
        finish_job(db, job, "failed", str(getattr(exc, "detail", exc))[:500])
        write_audit(db, "backup_created", "database", actor=actor, metadata={"status": "failed", "error": str(getattr(exc, "detail", exc))[:300]})
        db.commit()
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(status_code=500, detail="فشل إنشاء النسخة الاحتياطية") from exc


def get_backup(db: Session, backup_id: int) -> DatabaseBackup:
    row = db.get(DatabaseBackup, backup_id)
    if not row or row.status.startswith("deleted"):
        raise HTTPException(status_code=404, detail="النسخة الاحتياطية غير موجودة")
    return row


def verify_backup(db: Session, backup_id: int, actor: User) -> dict:
    row = get_backup(db, backup_id)
    path = Path(row.file_path)
    ok = path.exists() and sha256_file(path) == row.checksum
    if ok:
        try:
            with zipfile.ZipFile(path) as archive:
                ok = "metadata.json" in archive.namelist()
        except zipfile.BadZipFile:
            ok = False
    row.status = "ready" if ok else "corrupted"
    row.verified_at = datetime.now(timezone.utc) if ok else None
    write_audit(db, "backup_verified", "database", actor=actor, entity_id=str(row.id), metadata={"ok": ok})
    db.commit()
    db.refresh(row)
    return backup_to_dict(row)


def delete_backup(db: Session, backup_id: int, actor: User) -> None:
    row = get_backup(db, backup_id)
    Path(row.file_path).unlink(missing_ok=True)
    row.status = "deleted"
    write_audit(db, "backup_deleted", "database", actor=actor, entity_id=str(row.id), metadata={"file_name": row.file_name})
    db.commit()
