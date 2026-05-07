from __future__ import annotations

from collections import defaultdict
from html import unescape
import re

from fastapi import WebSocket

from app.models.message import InternalMessage
from app.models.user import User


TAG_RE = re.compile(r"<[^>]+>")


class NotificationConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[int, set[WebSocket]] = defaultdict(set)

    async def connect(self, user_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections[user_id].add(websocket)

    def disconnect(self, user_id: int, websocket: WebSocket) -> None:
        sockets = self._connections.get(user_id)
        if not sockets:
            return
        sockets.discard(websocket)
        if not sockets:
            self._connections.pop(user_id, None)

    async def send_to_user(self, user_id: int, payload: dict) -> None:
        sockets = list(self._connections.get(user_id, set()))
        for websocket in sockets:
            try:
                await websocket.send_json(payload)
            except Exception:
                self.disconnect(user_id, websocket)

    async def broadcast_to_users(self, user_ids: list[int], payload: dict) -> None:
        for user_id in sorted(set(user_ids)):
            await self.send_to_user(user_id, payload)


notification_manager = NotificationConnectionManager()


def message_notification_payload(message: InternalMessage, sender: User) -> dict:
    preview = unescape(TAG_RE.sub(" ", message.body or ""))
    preview = " ".join(preview.split())[:160]
    return {
        "type": "new_message",
        "title": "رسالة جديدة",
        "body": f"وصلت رسالة من {sender.full_name_ar}",
        "message_id": message.id,
        "message_uid": message.message_uid,
        "subject": message.subject,
        "sender_id": sender.id,
        "sender_name": sender.full_name_ar,
        "preview": preview,
        "created_at": message.created_at.isoformat() if message.created_at else None,
    }
