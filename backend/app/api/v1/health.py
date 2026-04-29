from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path
import shutil
import time

from fastapi import APIRouter, Depends
from sqlalchemy import func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.core.config import get_settings
from app.db.session import get_db
from app.models.audit import AuditLog
from app.models.enums import UserRole
from app.models.health import SystemAlert, SystemHealthCheck
from app.models.user import User
from app.services.audit import write_audit

router = APIRouter(prefix="/health", tags=["Health Monitoring"])
settings = get_settings()
HealthActor = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.IT_MANAGER))


def now_local() -> datetime:
    return datetime.now()


def format_dt(value: datetime | None) -> str | None:
    return value.strftime("%Y-%m-%d %H:%M") if value else None


def folder_size(path: Path) -> int:
    if not path.exists():
        return 0
    total = 0
    for item in path.rglob("*"):
        if item.is_file():
            try:
                total += item.stat().st_size
            except OSError:
                continue
    return total


def bytes_label(value: int) -> str:
    units = ["B", "KB", "MB", "GB", "TB"]
    size = float(value or 0)
    unit_index = 0
    while size >= 1024 and unit_index < len(units) - 1:
        size /= 1024
        unit_index += 1
    return f"{size:.1f} {units[unit_index]}" if unit_index else f"{int(size)} {units[unit_index]}"


def sqlite_database_path() -> Path | None:
    url = make_url(settings.database_url)
    if url.drivername != "sqlite" or not url.database:
        return None
    path = Path(url.database)
    return path if path.is_absolute() else Path.cwd() / path


def backup_directories() -> list[Path]:
    candidates: list[Path] = []
    database_path = sqlite_database_path()
    if database_path:
        candidates.append(database_path.parent / "backups")
    candidates.append(Path.cwd() / "backups")
    seen: set[Path] = set()
    unique = []
    for path in candidates:
        resolved = path.resolve()
        if resolved not in seen:
            seen.add(resolved)
            unique.append(path)
    return unique


def latest_backup_file() -> Path | None:
    files: list[Path] = []
    for directory in backup_directories():
        if directory.exists():
            files.extend([item for item in directory.iterdir() if item.is_file()])
    return max(files, key=lambda item: item.stat().st_mtime, default=None)


def count_log_errors_last_24h() -> int:
    log_candidates = [Path.cwd() / "uvicorn.err.log", Path.cwd().parent / "backend" / "uvicorn.err.log"]
    keywords = ("ERROR", "Traceback", "Exception", "CRITICAL")
    cutoff = now_local() - timedelta(hours=24)
    total = 0
    for path in log_candidates:
        if not path.exists():
            continue
        try:
            if datetime.fromtimestamp(path.stat().st_mtime) < cutoff:
                continue
            with path.open("r", encoding="utf-8", errors="ignore") as handle:
                total += sum(1 for line in handle if any(keyword in line for keyword in keywords))
        except OSError:
            continue
    return total


def check_status_from_thresholds(value: int | float, warning: int | float, critical: int | float) -> str:
    if value > critical:
        return "critical"
    if value > warning:
        return "warning"
    return "healthy"


def overall_status(parts: list[dict]) -> str:
    statuses = {part.get("status") for part in parts}
    if "critical" in statuses:
        return "critical"
    if "warning" in statuses:
        return "warning"
    return "healthy"


def record_check(db: Session, check_name: str, status: str, latency_ms: int | None, message: str, details: dict) -> None:
    db.add(SystemHealthCheck(check_name=check_name, status=status, latency_ms=latency_ms, message=message, details_json=details))


def upsert_alert(db: Session, alert_type: str, severity: str, message: str) -> None:
    existing = db.scalar(
        select(SystemAlert).where(
            SystemAlert.alert_type == alert_type,
            SystemAlert.message == message,
            SystemAlert.is_resolved.is_(False),
        )
    )
    if existing:
        existing.severity = severity
        return
    db.add(SystemAlert(alert_type=alert_type, severity=severity, message=message, is_resolved=False))


def resolve_alerts(db: Session, alert_type: str) -> None:
    alerts = db.scalars(select(SystemAlert).where(SystemAlert.alert_type == alert_type, SystemAlert.is_resolved.is_(False))).all()
    for alert in alerts:
        alert.is_resolved = True
        alert.resolved_at = now_local()


def run_health_checks(db: Session) -> dict:
    started = time.perf_counter()
    backend_latency = int((time.perf_counter() - started) * 1000)
    backend = {"status": "healthy", "latency_ms": backend_latency, "message": "واجهة API تعمل بشكل طبيعي"}
    record_check(db, "backend", "healthy", backend_latency, backend["message"], backend)
    resolve_alerts(db, "backend")

    database_started = time.perf_counter()
    try:
        db.execute(text("SELECT 1")).scalar_one()
        database_latency = int((time.perf_counter() - database_started) * 1000)
        database = {"status": "healthy", "latency_ms": database_latency, "message": "الاتصال بقاعدة البيانات ناجح"}
        resolve_alerts(db, "database")
    except Exception as exc:
        database_latency = int((time.perf_counter() - database_started) * 1000)
        database = {"status": "critical", "latency_ms": database_latency, "message": "فشل الاتصال بقاعدة البيانات"}
        upsert_alert(db, "database", "critical", f"فشل الاتصال بقاعدة البيانات: {exc}")
    record_check(db, "database", database["status"], database_latency, database["message"], database)

    disk = shutil.disk_usage(Path.cwd())
    disk_used_percent = round((disk.used / disk.total) * 100, 1) if disk.total else 0
    storage_status = check_status_from_thresholds(disk_used_percent, 80, 90)
    attachments_path = Path(settings.upload_dir)
    if not attachments_path.is_absolute():
        attachments_path = Path.cwd() / attachments_path
    attachments_size = folder_size(attachments_path)
    storage = {
        "status": storage_status,
        "disk_used_percent": disk_used_percent,
        "attachments_size_bytes": attachments_size,
        "attachments_size_label": bytes_label(attachments_size),
        "message": "مساحة التخزين ضمن الحدود" if storage_status == "healthy" else "مساحة التخزين تحتاج متابعة",
    }
    record_check(db, "storage", storage_status, None, storage["message"], storage)
    if storage_status == "healthy":
        resolve_alerts(db, "storage")
    else:
        upsert_alert(db, "storage", storage_status, f"استخدام القرص وصل إلى {disk_used_percent}%")

    backup_file = latest_backup_file()
    if backup_file:
        backup_at = datetime.fromtimestamp(backup_file.stat().st_mtime)
        backup = {
            "status": "healthy",
            "last_backup_at": format_dt(backup_at),
            "message": "آخر نسخة احتياطية متوفرة",
            "filename": backup_file.name,
        }
        resolve_alerts(db, "backup")
    else:
        backup = {"status": "warning", "last_backup_at": None, "message": "لا توجد نسخة احتياطية محفوظة"}
        upsert_alert(db, "backup", "warning", "لا توجد نسخة احتياطية محفوظة")
    record_check(db, "backup", backup["status"], None, backup["message"], backup)

    since = now_local() - timedelta(hours=24)
    audit_errors = db.scalar(select(func.count()).select_from(AuditLog).where(AuditLog.action.ilike("%error%"), AuditLog.created_at >= since)) or 0
    errors_count = int(audit_errors) + count_log_errors_last_24h()
    errors_status = check_status_from_thresholds(errors_count, 10, 50)
    errors = {"status": errors_status, "count": errors_count, "message": "عدد الأخطاء خلال آخر 24 ساعة"}
    record_check(db, "errors", errors_status, None, errors["message"], errors)
    if errors_status == "healthy":
        resolve_alerts(db, "errors")
    else:
        upsert_alert(db, "errors", errors_status, f"عدد الأخطاء خلال آخر 24 ساعة: {errors_count}")

    parts = [backend, database, storage, backup, errors]
    return {
        "status": overall_status(parts),
        "backend": backend,
        "database": database,
        "storage": storage,
        "backup": backup,
        "errors_last_24h": errors_count,
        "errors": errors,
    }


def latest_check_map(db: Session) -> dict[str, SystemHealthCheck]:
    checks = db.scalars(select(SystemHealthCheck).order_by(SystemHealthCheck.checked_at.desc(), SystemHealthCheck.id.desc()).limit(50)).all()
    latest: dict[str, SystemHealthCheck] = {}
    for check in checks:
        latest.setdefault(check.check_name, check)
    return latest


def check_to_dict(check: SystemHealthCheck) -> dict:
    return {
        "id": check.id,
        "check_name": check.check_name,
        "status": check.status,
        "latency_ms": check.latency_ms,
        "message": check.message,
        "details_json": check.details_json or {},
        "checked_at": format_dt(check.checked_at),
    }


def summary_from_latest(db: Session) -> dict:
    latest = latest_check_map(db)
    if not latest:
        return run_health_checks(db)

    backend = latest.get("backend")
    database = latest.get("database")
    storage = latest.get("storage")
    backup = latest.get("backup")
    errors = latest.get("errors")
    backend_data = backend.details_json if backend else {"status": "warning", "latency_ms": None, "message": "لم يتم تنفيذ الفحص بعد"}
    database_data = database.details_json if database else {"status": "warning", "latency_ms": None, "message": "لم يتم تنفيذ الفحص بعد"}
    storage_data = storage.details_json if storage else {"status": "warning", "disk_used_percent": None, "attachments_size_bytes": 0, "attachments_size_label": "0 B"}
    backup_data = backup.details_json if backup else {"status": "warning", "last_backup_at": None, "message": "لم يتم تنفيذ الفحص بعد"}
    errors_data = errors.details_json if errors else {"status": "healthy", "count": 0, "message": "عدد الأخطاء خلال آخر 24 ساعة"}
    parts = [backend_data, database_data, storage_data, backup_data, errors_data]
    return {
        "status": overall_status(parts),
        "backend": backend_data,
        "database": database_data,
        "storage": storage_data,
        "backup": backup_data,
        "errors_last_24h": errors_data.get("count", 0),
        "errors": errors_data,
    }


def enrich_summary(db: Session, summary: dict) -> dict:
    recent_checks = db.scalars(select(SystemHealthCheck).order_by(SystemHealthCheck.checked_at.desc(), SystemHealthCheck.id.desc()).limit(20)).all()
    alerts = db.scalars(select(SystemAlert).order_by(SystemAlert.is_resolved, SystemAlert.created_at.desc()).limit(20)).all()
    return {
        **summary,
        "recent_checks": [check_to_dict(check) for check in recent_checks],
        "alerts": [
            {
                "id": alert.id,
                "alert_type": alert.alert_type,
                "severity": alert.severity,
                "message": alert.message,
                "is_resolved": alert.is_resolved,
                "created_at": format_dt(alert.created_at),
                "resolved_at": format_dt(alert.resolved_at),
            }
            for alert in alerts
        ],
    }


@router.get("/summary")
def health_summary(db: Session = Depends(get_db), _: User = HealthActor):
    summary = summary_from_latest(db)
    db.commit()
    return enrich_summary(db, summary)


@router.post("/run-checks")
def run_checks(db: Session = Depends(get_db), actor: User = HealthActor):
    summary = run_health_checks(db)
    write_audit(db, "health_checks_run", "system_health", actor=actor, metadata={"status": summary["status"]})
    db.commit()
    return enrich_summary(db, summary)
