from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.database import DatabaseJob
from app.models.user import User


def create_job(db: Session, job_type: str, actor: User | None, message: str = "") -> DatabaseJob:
    job = DatabaseJob(job_type=job_type, status="running", progress=5, message=message, started_by=actor.id if actor else None)
    db.add(job)
    db.flush()
    return job


def finish_job(db: Session, job: DatabaseJob, status: str, message: str, progress: int = 100, details: dict | None = None) -> DatabaseJob:
    job.status = status
    job.message = message
    job.progress = progress
    job.completed_at = datetime.now(timezone.utc)
    job.details_json = details or job.details_json or {}
    db.flush()
    return job


def job_to_dict(job: DatabaseJob) -> dict:
    return {
        "id": job.id,
        "job_type": job.job_type,
        "status": job.status,
        "progress": job.progress,
        "message": job.message,
        "started_by": job.started_by,
        "started_by_name": job.starter.full_name_ar if job.starter else None,
        "started_at": job.started_at,
        "completed_at": job.completed_at,
        "details_json": job.details_json or {},
    }


def list_jobs(db: Session, limit: int = 20) -> list[dict]:
    rows = db.scalars(select(DatabaseJob).options(selectinload(DatabaseJob.starter)).order_by(DatabaseJob.started_at.desc()).limit(limit)).all()
    return [job_to_dict(row) for row in rows]
