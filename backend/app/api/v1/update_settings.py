from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.db.session import get_db
from app.models.enums import UserRole
from app.models.user import User
from app.schemas.update_settings import RollbackConfirmPayload, UpdateConfirmPayload, UpdatePackageActionPayload, UpdateSettingsPayload
from app.services.audit import write_audit
from app.services.update_settings_service import (
    apply_local_package,
    list_jobs,
    list_packages,
    list_rollback_points,
    precheck,
    preview_package,
    release_notes,
    rollback_update,
    save_update_upload,
    update_audit_logs,
    update_overview,
    update_settings,
    update_versions,
    validate_existing_package,
)

router = APIRouter(prefix="/settings/updates", tags=["Update Management"])

ViewActor = Depends(require_roles(UserRole.IT_MANAGER))
EditActor = Depends(require_roles(UserRole.SUPER_ADMIN))


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


@router.get("/status")
def get_update_status(db: Session = Depends(get_db), _: User = ViewActor):
    return update_overview(db)


@router.get("/versions")
def get_versions(db: Session = Depends(get_db), _: User = ViewActor):
    return update_versions(db)


@router.get("/packages")
def get_packages(db: Session = Depends(get_db), _: User = ViewActor):
    return list_packages(db)


@router.get("/jobs")
def get_jobs(db: Session = Depends(get_db), _: User = ViewActor):
    return list_jobs(db)


@router.get("/jobs/{job_id}")
def get_job(job_id: int, db: Session = Depends(get_db), _: User = ViewActor):
    job = next((item for item in list_jobs(db) if item["id"] == job_id), None)
    if not job:
        raise HTTPException(status_code=404, detail="عملية التحديث غير موجودة")
    return job


@router.get("/rollback-points")
def get_rollback_points(db: Session = Depends(get_db), _: User = ViewActor):
    return list_rollback_points(db)


@router.get("/release-notes")
def get_release_notes(db: Session = Depends(get_db), _: User = ViewActor):
    return release_notes(db)


@router.get("/audit-logs")
def get_update_audit_logs(db: Session = Depends(get_db), _: User = ViewActor):
    return update_audit_logs(db)


@router.post("/precheck")
def run_precheck(request: Request, db: Session = Depends(get_db), actor: User = ViewActor):
    result = precheck(db)
    write_audit(db, "update_precheck_run", "system_update", actor=actor, ip_address=client_ip(request), metadata={"ready": result["ready"]})
    db.commit()
    return result


@router.post("/rollback/{rollback_point_id}")
def rollback(rollback_point_id: int, payload: RollbackConfirmPayload, db: Session = Depends(get_db), actor: User = EditActor):
    return rollback_update(db, rollback_point_id, actor, payload.admin_password, payload.confirmation_text)


@router.get("/settings")
def get_settings(db: Session = Depends(get_db), _: User = ViewActor):
    return update_settings(db)


@router.put("/settings")
def save_settings(payload: UpdateSettingsPayload, request: Request, db: Session = Depends(get_db), actor: User = EditActor):
    row = update_settings(db)
    for field, value in payload.model_dump().items():
        setattr(row, field, value)
    write_audit(db, "update_settings_saved", "system_update", actor=actor, ip_address=client_ip(request), metadata=payload.model_dump())
    db.commit()
    db.refresh(row)
    return row


@router.post("/local/upload")
async def upload_local_update(file: UploadFile = File(...), db: Session = Depends(get_db), actor: User = EditActor):
    return await save_update_upload(db, file, actor)


@router.post("/local/validate")
def validate_local_update(payload: UpdatePackageActionPayload, db: Session = Depends(get_db), _: User = ViewActor):
    return validate_existing_package(db, payload.package_id)


@router.post("/local/preview")
def preview_local_update(payload: UpdatePackageActionPayload, db: Session = Depends(get_db), _: User = ViewActor):
    return preview_package(db, payload.package_id)


@router.post("/local/apply")
def apply_local_update(payload: UpdateConfirmPayload, db: Session = Depends(get_db), actor: User = EditActor):
    if payload.package_id is None:
        raise HTTPException(status_code=422, detail="package_id مطلوب")
    return apply_local_package(db, payload.package_id, actor, payload.admin_password, payload.confirmation_text, payload.understood)
