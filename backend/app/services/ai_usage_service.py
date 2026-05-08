from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models.ai import AIHealthCheck, AIUsageLog
from app.models.user import User


def log_ai_usage(
    db: Session,
    user_id: int | None,
    feature_code: str,
    input_length: int,
    output_length: int = 0,
    latency_ms: int = 0,
    status: str = "success",
    entity_type: str | None = None,
    entity_id: str | None = None,
    error_message: str | None = None,
    prompt_text: str | None = None,
    output_text: str | None = None,
) -> AIUsageLog:
    log = AIUsageLog(
        user_id=user_id,
        feature=feature_code,
        feature_code=feature_code,
        entity_type=entity_type,
        entity_id=entity_id,
        input_length=input_length,
        output_length=output_length,
        latency_ms=latency_ms,
        status=status,
        error_message=(error_message or "")[:1000] or None,
        prompt_text=prompt_text,
        output_text=output_text,
    )
    db.add(log)
    db.flush()
    return log


def ai_usage_dashboard(db: Session) -> dict:
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = now - timedelta(days=7)
    usage_today = db.scalar(select(func.count()).select_from(AIUsageLog).where(AIUsageLog.created_at >= today_start)) or 0
    usage_week = db.scalar(select(func.count()).select_from(AIUsageLog).where(AIUsageLog.created_at >= week_start)) or 0
    feature_expr = func.coalesce(AIUsageLog.feature_code, AIUsageLog.feature)
    most_used = db.execute(
        select(feature_expr.label("feature"), func.count().label("count"))
        .group_by(feature_expr)
        .order_by(func.count().desc())
        .limit(1)
    ).first()
    top_users_rows = db.execute(
        select(User.full_name_ar, func.count(AIUsageLog.id).label("count"))
        .join(User, User.id == AIUsageLog.user_id, isouter=True)
        .where(AIUsageLog.created_at >= week_start)
        .group_by(User.full_name_ar)
        .order_by(func.count(AIUsageLog.id).desc())
        .limit(5)
    ).all()
    average_latency = db.scalar(select(func.avg(AIUsageLog.latency_ms)).where(AIUsageLog.created_at >= week_start)) or 0
    errors_count = db.scalar(select(func.count()).select_from(AIUsageLog).where(AIUsageLog.status != "success", AIUsageLog.created_at >= week_start)) or 0
    latest_health = db.scalar(select(AIHealthCheck).order_by(AIHealthCheck.checked_at.desc()).limit(1))
    logs = db.scalars(
        select(AIUsageLog)
        .options(selectinload(AIUsageLog.user))
        .order_by(AIUsageLog.created_at.desc())
        .limit(200)
    ).all()
    return {
        "usage_today": int(usage_today),
        "usage_last_7_days": int(usage_week),
        "most_used_feature": most_used[0] if most_used else None,
        "top_users": [{"name": row[0] or "-", "count": int(row[1])} for row in top_users_rows],
        "average_latency_ms": int(average_latency or 0),
        "errors_count": int(errors_count),
        "model_status": latest_health.status if latest_health else "unknown",
        "logs": logs,
    }
