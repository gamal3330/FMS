from sqlalchemy.orm import Session

from app.models.audit import AuditLog
from app.models.user import User


def write_audit(
    db: Session,
    action: str,
    entity_type: str,
    actor: User | None = None,
    entity_id: str | None = None,
    metadata: dict | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> None:
    db.add(
        AuditLog(
            actor_id=actor.id if actor else None,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            ip_address=ip_address,
            user_agent=user_agent,
            metadata_json=metadata or {},
        )
    )
