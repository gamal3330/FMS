from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.db.session import get_db
from app.models.enums import UserRole
from app.models.user import User
from app.services.audit import write_audit
from app.services.update_manager import (
    applied_migrations_history,
    apply_available_update,
    system_update_status,
    update_history,
)

router = APIRouter(prefix="/updates", tags=["System Updates"])
UpdateActor = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.IT_MANAGER))


@router.get("/status")
def get_update_status(db: Session = Depends(get_db), _: User = UpdateActor):
    status = system_update_status(db)
    db.commit()
    return status


@router.get("/history")
def get_update_history(db: Session = Depends(get_db), _: User = UpdateActor):
    return {
        "updates": update_history(db),
        "migrations": applied_migrations_history(db),
    }


@router.post("/check")
def check_updates(db: Session = Depends(get_db), actor: User = UpdateActor):
    status = system_update_status(db)
    write_audit(db, "updates_checked", "system_updates", actor=actor, metadata={"latest_version": status["latest_version"]})
    db.commit()
    return status


@router.post("/apply")
def apply_update(db: Session = Depends(get_db), actor: User = UpdateActor):
    result = apply_available_update(db)
    write_audit(db, "system_update_applied", "system_updates", actor=actor, metadata={"version": result.get("latest_version")})
    db.commit()
    return result
