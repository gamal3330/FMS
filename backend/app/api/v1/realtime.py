from datetime import datetime, timezone

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect, status

from app.core.security import decode_access_token
from app.db.session import SessionLocal
from app.models.user import User
from app.services.realtime import notification_manager

router = APIRouter(tags=["Realtime Notifications"])


@router.websocket("/ws/notifications")
async def notification_websocket(websocket: WebSocket, token: str = Query(default="")):
    user = authenticate_websocket_user(token)
    if not user:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await notification_manager.connect(user.id, websocket)
    try:
        await websocket.send_json({"type": "connected", "user_id": user.id})
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        notification_manager.disconnect(user.id, websocket)
    except Exception:
        notification_manager.disconnect(user.id, websocket)
        await websocket.close()


def authenticate_websocket_user(token: str) -> User | None:
    if not token:
        return None
    try:
        payload = decode_access_token(token)
        user_id = int(payload.get("sub") or 0)
    except (TypeError, ValueError):
        return None

    db = SessionLocal()
    try:
        user = db.get(User, user_id)
        if not user or not user.is_active:
            return None
        if user.locked_until:
            locked_until = user.locked_until
            if locked_until.tzinfo is None:
                locked_until = locked_until.replace(tzinfo=timezone.utc)
            if locked_until > datetime.now(timezone.utc):
                return None
        db.expunge(user)
        return user
    finally:
        db.close()
