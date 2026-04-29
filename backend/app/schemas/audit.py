from datetime import datetime

from pydantic import BaseModel


class AuditLogRead(BaseModel):
    id: int
    actor_id: int | None = None
    action: str
    entity_type: str
    entity_id: str | None = None
    ip_address: str | None = None
    user_agent: str | None = None
    metadata_json: dict
    created_at: datetime

    model_config = {"from_attributes": True}
