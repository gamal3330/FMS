from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import require_roles
from app.db.session import get_db
from app.models.audit import AuditLog
from app.models.enums import UserRole
from app.models.user import User
from app.schemas.audit import AuditLogRead, LoginActivityRead

router = APIRouter(prefix="/audit-logs", tags=["Audit Logs"])

LOGIN_ACTIONS = {
    "login_success",
    "login_failed",
    "login_blocked",
    "login_blocked_locked",
    "login_locked_after_failures",
    "login_password_expired",
    "logout",
}


def login_activity_read(log: AuditLog) -> LoginActivityRead:
    metadata = log.metadata_json if isinstance(log.metadata_json, dict) else {}
    actor = log.actor
    return LoginActivityRead(
        id=log.id,
        actor_id=log.actor_id,
        actor_name=actor.full_name_ar if actor else None,
        actor_email=actor.email if actor else None,
        action=log.action,
        identifier=metadata.get("identifier"),
        ip_address=log.ip_address,
        user_agent=log.user_agent,
        failed_login_attempts=metadata.get("failed_login_attempts"),
        created_at=log.created_at,
    )


@router.get("/login-activity", response_model=list[LoginActivityRead])
def list_login_activity(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.IT_MANAGER)),
    limit: int = Query(default=80, ge=1, le=300),
):
    stmt = (
        select(AuditLog)
        .options(selectinload(AuditLog.actor))
        .where(AuditLog.action.in_(LOGIN_ACTIONS))
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
    )
    return [login_activity_read(log) for log in db.scalars(stmt).all()]


@router.get("", response_model=list[AuditLogRead])
def list_audit_logs(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.IT_MANAGER)),
    action: str | None = None,
    entity_type: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
):
    stmt = select(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if entity_type:
        stmt = stmt.where(AuditLog.entity_type == entity_type)
    return db.scalars(stmt).all()
