from __future__ import annotations

import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.database import DatabaseBackup
from app.models.settings import SettingsGeneral
from app.services.database_backup_service import backup_settings, create_backup


_started = False
_lock = threading.Lock()


def system_timezone(db) -> ZoneInfo:
    general = db.scalar(select(SettingsGeneral).limit(1))
    timezone_name = general.timezone if general and general.timezone else "Asia/Qatar"
    try:
        return ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        return ZoneInfo("Asia/Qatar")


def period_key(value: datetime, frequency: str) -> str:
    if frequency == "weekly":
        year, week, _weekday = value.isocalendar()
        return f"{year}-W{week:02d}"
    if frequency == "monthly":
        return value.strftime("%Y-%m")
    return value.strftime("%Y-%m-%d")


def latest_auto_backup_period(db, frequency: str, tz: ZoneInfo) -> str | None:
    rows = db.scalars(select(DatabaseBackup).order_by(DatabaseBackup.created_at.desc()).limit(100)).all()
    for row in rows:
        metadata = row.metadata_json or {}
        if not metadata.get("auto_backup"):
            continue
        if row.status != "ready":
            continue
        created_at = row.created_at
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=tz)
        return period_key(created_at.astimezone(tz), frequency)
    return None


def backup_is_due(db, now: datetime | None = None) -> bool:
    cfg = backup_settings(db)
    if not cfg.auto_backup_enabled:
        return False
    tz = system_timezone(db)
    current = now.astimezone(tz) if now else datetime.now(tz)
    if current.strftime("%H:%M") < (cfg.backup_time or "02:00"):
        return False
    current_period = period_key(current, cfg.frequency or "daily")
    return latest_auto_backup_period(db, cfg.frequency or "daily", tz) != current_period


def run_scheduler_loop(interval_seconds: int = 60) -> None:
    while True:
        db = SessionLocal()
        try:
            if backup_is_due(db):
                create_backup(db, None, "full_backup", auto_backup=True)
        except Exception:
            db.rollback()
        finally:
            db.close()
        time.sleep(interval_seconds)


def start_backup_scheduler() -> None:
    global _started
    with _lock:
        if _started:
            return
        _started = True
    thread = threading.Thread(target=run_scheduler_loop, name="database-backup-scheduler", daemon=True)
    thread.start()
