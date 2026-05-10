from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.notification import Notification
from app.models.user import User
from app.services.audit import write_audit

router = APIRouter(prefix="/notifications", tags=["Notifications"])


def client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


def notification_summary(notification: Notification) -> dict:
    return {
        "id": notification.id,
        "title": notification.title,
        "body": notification.body,
        "channel": notification.channel,
        "is_read": notification.is_read,
        "created_at": notification.created_at,
    }


@router.get("")
def list_notifications(
    limit: int = Query(default=20, ge=1, le=100),
    unread_only: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = select(Notification).where(Notification.user_id == current_user.id).order_by(Notification.created_at.desc())
    if unread_only:
        query = query.where(Notification.is_read == False)
    rows = db.scalars(query.limit(limit)).all()
    return [notification_summary(row) for row in rows]


@router.get("/unread-count")
def unread_count(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    count = db.scalar(
        select(func.count()).select_from(Notification).where(Notification.user_id == current_user.id, Notification.is_read == False)
    ) or 0
    return {"count": count}


@router.post("/{notification_id:int}/read")
def mark_notification_read(
    notification_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    notification = db.scalar(select(Notification).where(Notification.id == notification_id, Notification.user_id == current_user.id))
    if not notification:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="الإشعار غير موجود")
    notification.is_read = True
    write_audit(
        db,
        "notification_read",
        "notification",
        actor=current_user,
        entity_id=str(notification.id),
        ip_address=client_ip(request),
        metadata={"title": notification.title},
    )
    db.commit()
    return notification_summary(notification)


@router.post("/mark-all-read")
def mark_all_notifications_read(request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    updated = (
        db.query(Notification)
        .filter(Notification.user_id == current_user.id, Notification.is_read == False)
        .update({"is_read": True})
    )
    write_audit(
        db,
        "notifications_marked_read",
        "notification",
        actor=current_user,
        ip_address=client_ip(request),
        metadata={"updated": updated},
    )
    db.commit()
    return {"updated": updated}
