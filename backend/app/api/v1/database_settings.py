from __future__ import annotations

from pathlib import Path
import tempfile

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import require_roles
from app.core.security import verify_password
from app.db.session import get_db
from app.models.audit import AuditLog
from app.models.database import DatabaseBackupSettings, DatabaseJob
from app.models.enums import UserRole
from app.models.user import User
from app.schemas.database import (
    AdminPasswordConfirmRequest,
    DatabaseActivityLogResponse,
    DatabaseBackupCreateRequest,
    DatabaseBackupDeleteRequest,
    DatabaseBackupResponse,
    DatabaseBackupSettingsRead,
    DatabaseBackupSettingsUpdate,
    DatabaseJobResponse,
    DatabaseStatusResponse,
    DatabaseTableInfoResponse,
    ResetConfirmRequest,
    ResetPreviewResponse,
    RestoreConfirmRequest,
    RestoreValidateResponse,
)
from app.services.audit import write_audit
from app.services.database_backup_service import backup_settings, backup_to_dict, create_backup, decrypt_file, delete_backup, get_backup, list_backups, verify_backup
from app.services.database_jobs_service import job_to_dict, list_jobs
from app.services.database_maintenance_service import (
    analyze_database,
    check_integrity,
    check_orphan_attachments,
    clean_temp_files,
    migration_status,
    optimize_database,
    reindex_database,
    run_connection_test,
    run_migrations,
)
from app.services.database_reset_service import reset_preview, execute_reset
from app.services.database_restore_service import confirm_restore, validate_restore_upload
from app.services.database_status_service import database_status, database_tables

router = APIRouter(prefix="/settings/database", tags=["Database Control Center"])
DatabaseViewer = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.DEPARTMENT_MANAGER))
DatabaseAdmin = Depends(require_roles(UserRole.SUPER_ADMIN))

DATABASE_AUDIT_ACTIONS = {
    "database_status_viewed",
    "backup_created",
    "backup_downloaded",
    "backup_decrypted",
    "backup_verified",
    "backup_deleted",
    "restore_validated",
    "restore_started",
    "restore_completed",
    "reset_preview_viewed",
    "reset_completed",
    "maintenance_run",
    "migration_run",
    "backup_settings_saved",
}


def ensure_password(actor: User, password: str) -> None:
    if not verify_password(password, actor.hashed_password):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="كلمة مرور مدير النظام غير صحيحة")


@router.get("/status", response_model=DatabaseStatusResponse)
def get_database_status(db: Session = Depends(get_db), actor: User = DatabaseViewer):
    result = database_status(db)
    write_audit(db, "database_status_viewed", "database", actor=actor, metadata={"status": result["status"]})
    db.commit()
    return result


@router.get("/backups", response_model=list[DatabaseBackupResponse])
def get_database_backups(db: Session = Depends(get_db), _: User = DatabaseViewer):
    return list_backups(db)


@router.post("/backup", response_model=DatabaseBackupResponse)
def create_database_backup(payload: DatabaseBackupCreateRequest, db: Session = Depends(get_db), actor: User = DatabaseAdmin):
    row, _job_id = create_backup(db, actor, payload.backup_type)
    return row


@router.get("/backups/{backup_id}/download")
def download_database_backup(backup_id: int, db: Session = Depends(get_db), actor: User = DatabaseAdmin):
    row = get_backup(db, backup_id)
    path = Path(row.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="ملف النسخة غير موجود على الخادم")
    write_audit(db, "backup_downloaded", "database", actor=actor, entity_id=str(row.id), metadata={"file_name": row.file_name})
    db.commit()
    return FileResponse(path, media_type="application/zip", filename=row.file_name, headers={"Content-Disposition": f'attachment; filename="{row.file_name}"'})


@router.post("/backups/{backup_id}/decrypt-download")
def decrypt_download_database_backup(backup_id: int, payload: AdminPasswordConfirmRequest, db: Session = Depends(get_db), actor: User = DatabaseAdmin):
    ensure_password(actor, payload.admin_password)
    row = get_backup(db, backup_id)
    if not (row.metadata_json or {}).get("encrypted") and not row.file_name.endswith(".enc"):
        raise HTTPException(status_code=422, detail="هذه النسخة غير مشفرة")
    path = Path(row.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="ملف النسخة غير موجود على الخادم")
    temp_file = tempfile.NamedTemporaryFile(prefix="qib-decrypted-", suffix=".zip", delete=False)
    temp_path = Path(temp_file.name)
    temp_file.close()
    decrypt_file(path, temp_path)
    output_name = row.file_name.removesuffix(".enc")
    write_audit(db, "backup_decrypted", "database", actor=actor, entity_id=str(row.id), metadata={"file_name": row.file_name, "download_name": output_name})
    db.commit()
    return FileResponse(
        temp_path,
        media_type="application/zip",
        filename=output_name,
        headers={"Content-Disposition": f'attachment; filename="{output_name}"'},
        background=BackgroundTask(lambda: temp_path.unlink(missing_ok=True)),
    )


@router.post("/backups/{backup_id}/verify", response_model=DatabaseBackupResponse)
def verify_database_backup(backup_id: int, db: Session = Depends(get_db), actor: User = DatabaseAdmin):
    return verify_backup(db, backup_id, actor)


@router.delete("/backups/{backup_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_database_backup(backup_id: int, payload: DatabaseBackupDeleteRequest, db: Session = Depends(get_db), actor: User = DatabaseAdmin):
    ensure_password(actor, payload.admin_password)
    if payload.confirmation_text != "DELETE BACKUP":
        raise HTTPException(status_code=422, detail="عبارة التأكيد غير صحيحة")
    delete_backup(db, backup_id, actor)


@router.post("/restore/validate", response_model=RestoreValidateResponse)
async def validate_restore(file: UploadFile = File(...), db: Session = Depends(get_db), actor: User = DatabaseAdmin):
    return await validate_restore_upload(db, file, actor)


@router.post("/restore/confirm")
def restore_confirm(payload: RestoreConfirmRequest, db: Session = Depends(get_db), actor: User = DatabaseAdmin):
    write_audit(db, "restore_started", "database", actor=actor, metadata={"restore_token": payload.restore_token})
    return confirm_restore(db, payload, actor)


@router.get("/reset-preview", response_model=ResetPreviewResponse)
def get_reset_preview(scope: str = Query(...), db: Session = Depends(get_db), actor: User = DatabaseAdmin):
    preview = reset_preview(db, scope)
    write_audit(db, "reset_preview_viewed", "database", actor=actor, metadata={"scope": scope})
    db.commit()
    return preview


@router.post("/reset")
def reset_database(payload: ResetConfirmRequest, db: Session = Depends(get_db), actor: User = DatabaseAdmin):
    return execute_reset(db, payload, actor)


@router.post("/maintenance/test-connection")
def maintenance_test_connection(db: Session = Depends(get_db), actor: User = DatabaseViewer):
    return run_connection_test(db, actor)


@router.post("/maintenance/check-integrity")
def maintenance_check_integrity(db: Session = Depends(get_db), actor: User = DatabaseAdmin):
    return check_integrity(db, actor)


@router.post("/maintenance/optimize")
def maintenance_optimize(db: Session = Depends(get_db), actor: User = DatabaseAdmin):
    return optimize_database(db, actor)


@router.post("/maintenance/reindex")
def maintenance_reindex(db: Session = Depends(get_db), actor: User = DatabaseAdmin):
    return reindex_database(db, actor)


@router.post("/maintenance/analyze")
def maintenance_analyze(db: Session = Depends(get_db), actor: User = DatabaseAdmin):
    return analyze_database(db, actor)


@router.post("/maintenance/clean-temp")
def maintenance_clean_temp(db: Session = Depends(get_db), actor: User = DatabaseAdmin):
    return clean_temp_files(db, actor)


@router.post("/maintenance/check-orphan-attachments")
def maintenance_check_orphan_attachments(db: Session = Depends(get_db), actor: User = DatabaseAdmin):
    return check_orphan_attachments(db, actor)


@router.get("/migrations/status")
def get_migration_status(db: Session = Depends(get_db), _: User = DatabaseViewer):
    return migration_status(db)


@router.post("/migrations/run")
def run_pending_migrations(payload: AdminPasswordConfirmRequest, db: Session = Depends(get_db), actor: User = DatabaseAdmin):
    ensure_password(actor, payload.admin_password)
    if payload.confirmation_text != "RUN MIGRATIONS":
        raise HTTPException(status_code=422, detail="عبارة التأكيد غير صحيحة")
    return run_migrations(db, actor)


@router.get("/tables", response_model=list[DatabaseTableInfoResponse])
def get_database_tables(db: Session = Depends(get_db), _: User = DatabaseViewer):
    return database_tables(db)


@router.get("/activity-log", response_model=list[DatabaseActivityLogResponse])
def get_database_activity_log(db: Session = Depends(get_db), _: User = DatabaseViewer):
    rows = db.scalars(
        select(AuditLog)
        .options(selectinload(AuditLog.actor))
        .where((AuditLog.entity_type == "database") | (AuditLog.action.in_(DATABASE_AUDIT_ACTIONS)))
        .order_by(AuditLog.created_at.desc())
        .limit(200)
    ).all()
    return [
        {
            "id": row.id,
            "action": row.action,
            "user": row.actor.full_name_ar if row.actor else None,
            "created_at": row.created_at,
            "ip_address": row.ip_address,
            "result": "فشل" if (row.metadata_json or {}).get("status") == "failed" else "ناجح",
            "details": row.metadata_json or {},
        }
        for row in rows
    ]


@router.get("/backup-settings", response_model=DatabaseBackupSettingsRead)
def get_database_backup_settings(db: Session = Depends(get_db), _: User = DatabaseViewer):
    return backup_settings(db)


@router.put("/backup-settings", response_model=DatabaseBackupSettingsRead)
def update_database_backup_settings(payload: DatabaseBackupSettingsUpdate, db: Session = Depends(get_db), actor: User = DatabaseAdmin):
    item = backup_settings(db)
    for key, value in payload.model_dump().items():
        setattr(item, key, value)
    write_audit(db, "backup_settings_saved", "database", actor=actor, metadata=payload.model_dump())
    db.commit()
    db.refresh(item)
    return item


@router.get("/jobs", response_model=list[DatabaseJobResponse])
def get_database_jobs(db: Session = Depends(get_db), _: User = DatabaseViewer):
    return list_jobs(db)


@router.get("/jobs/{job_id}", response_model=DatabaseJobResponse)
def get_database_job(job_id: int, db: Session = Depends(get_db), _: User = DatabaseViewer):
    job = db.scalar(select(DatabaseJob).options(selectinload(DatabaseJob.starter)).where(DatabaseJob.id == job_id))
    if not job:
        raise HTTPException(status_code=404, detail="المهمة غير موجودة")
    return job_to_dict(job)
