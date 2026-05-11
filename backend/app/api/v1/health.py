from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
import resource
import shutil
import time

from fastapi import APIRouter, Depends, HTTPException
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import Session, selectinload

from app.api.deps import require_roles
from app.core.config import get_settings
from app.db.session import get_db
from app.models.audit import AuditLog
from app.models.database import DatabaseBackup, DatabaseBackupSettings, DatabaseJob, DatabaseMaintenanceLog
from app.models.enums import UserRole
from app.models.health import SystemHealthAlert, SystemHealthCheck, SystemHealthMetric, SystemHealthSettings
from app.models.message import InternalMessageAttachment
from app.models.request import Attachment
from app.models.update import RollbackPoint, UpdateJob
from app.models.user import User, UserImportBatch
from app.services.audit import write_audit
from app.services.database_backup_service import backup_settings, create_backup
from app.services.database_maintenance_service import migration_status
from app.services.database_status_service import database_status, database_type_label, safe_database_name
from app.services.update_manager import ensure_current_version, pending_migrations

router = APIRouter(prefix="/health", tags=["Health Monitoring"])
settings = get_settings()

HealthViewer = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.DEPARTMENT_MANAGER))
HealthAdmin = Depends(require_roles(UserRole.SUPER_ADMIN))


class HealthSettingsPayload(BaseModel):
    disk_warning_percent: int = Field(80, ge=1, le=100)
    disk_critical_percent: int = Field(90, ge=1, le=100)
    errors_warning_count: int = Field(10, ge=0)
    errors_critical_count: int = Field(50, ge=0)
    db_latency_warning_ms: int = Field(300, ge=1)
    db_latency_critical_ms: int = Field(1000, ge=1)
    auto_check_enabled: bool = True
    auto_check_interval_minutes: int = Field(15, ge=1)
    retention_days: int = Field(30, ge=1)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def format_dt(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def bytes_label(value: int | float | None) -> str:
    units = ["B", "KB", "MB", "GB", "TB"]
    size = float(value or 0)
    unit_index = 0
    while size >= 1024 and unit_index < len(units) - 1:
        size /= 1024
        unit_index += 1
    return f"{size:.1f} {units[unit_index]}" if unit_index else f"{int(size)} {units[unit_index]}"


def project_root() -> Path:
    return Path.cwd().parent if Path.cwd().name == "backend" else Path.cwd()


def resolve_project_path(value: str | None, fallback: str) -> Path:
    path = Path(value or fallback)
    return path if path.is_absolute() else project_root() / path


def uploads_root() -> Path:
    return resolve_project_path(settings.upload_dir, "uploads")


def backups_root(db: Session | None = None) -> Path:
    location = "backups"
    if db is not None:
        cfg = db.scalar(select(DatabaseBackupSettings).limit(1))
        if cfg and cfg.backup_location:
            location = cfg.backup_location
    return resolve_project_path(location, "backups")


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


def folder_writable(path: Path) -> bool:
    try:
        path.mkdir(parents=True, exist_ok=True)
        probe = path / ".health-write-test"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
        return True
    except OSError:
        return False


def memory_usage_bytes() -> int:
    usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    if usage < 10_000_000:
        usage *= 1024
    return int(usage)


def system_log_candidates() -> list[Path]:
    candidates = [
        project_root() / "backend" / "uvicorn.err.log",
        project_root() / "backend" / "uvicorn.out.log",
        project_root() / ".backend-local.log",
    ]
    unique: list[Path] = []
    seen: set[Path] = set()
    for path in candidates:
        resolved = path.resolve()
        if resolved not in seen:
            seen.add(resolved)
            unique.append(path)
    return unique


def health_settings(db: Session) -> SystemHealthSettings:
    item = db.scalar(select(SystemHealthSettings).limit(1))
    if item:
        return item
    item = SystemHealthSettings()
    db.add(item)
    db.flush()
    return item


def settings_to_dict(item: SystemHealthSettings) -> dict:
    return {
        "id": item.id,
        "disk_warning_percent": item.disk_warning_percent,
        "disk_critical_percent": item.disk_critical_percent,
        "errors_warning_count": item.errors_warning_count,
        "errors_critical_count": item.errors_critical_count,
        "db_latency_warning_ms": item.db_latency_warning_ms,
        "db_latency_critical_ms": item.db_latency_critical_ms,
        "auto_check_enabled": item.auto_check_enabled,
        "auto_check_interval_minutes": item.auto_check_interval_minutes,
        "retention_days": item.retention_days,
        "updated_at": item.updated_at,
    }


def threshold_status(value: int | float, warning: int | float, critical: int | float) -> str:
    if value >= critical:
        return "critical"
    if value >= warning:
        return "warning"
    return "healthy"


def overall_status(parts: list[dict]) -> str:
    statuses = {part.get("status") for part in parts}
    if "critical" in statuses:
        return "critical"
    if "warning" in statuses:
        return "warning"
    return "healthy"


def record_check(db: Session, check_name: str, category: str, status: str, latency_ms: int | None, message: str, details: dict) -> None:
    db.add(
        SystemHealthCheck(
            check_name=check_name,
            category=category,
            status=status,
            latency_ms=latency_ms,
            message=message,
            details_json=jsonable_encoder(details),
        )
    )


def record_metric(db: Session, name: str, value: float, unit: str, category: str) -> None:
    db.add(SystemHealthMetric(metric_name=name, metric_value=value, metric_unit=unit, category=category))


def upsert_alert(db: Session, alert_type: str, severity: str, title: str, message: str, recommended_action: str, related_route: str | None = None) -> None:
    existing = db.scalar(
        select(SystemHealthAlert).where(
            SystemHealthAlert.alert_type == alert_type,
            SystemHealthAlert.is_resolved.is_(False),
        )
    )
    if existing:
        existing.severity = severity
        existing.title = title
        existing.message = message
        existing.recommended_action = recommended_action
        existing.related_route = related_route
        return
    db.add(
        SystemHealthAlert(
            alert_type=alert_type,
            severity=severity,
            title=title,
            message=message,
            recommended_action=recommended_action,
            related_route=related_route,
            is_resolved=False,
        )
    )


def resolve_alerts_by_type(db: Session, alert_type: str) -> None:
    for alert in db.scalars(select(SystemHealthAlert).where(SystemHealthAlert.alert_type == alert_type, SystemHealthAlert.is_resolved.is_(False))).all():
        alert.is_resolved = True
        alert.resolved_at = now_utc()


def service_item(code: str, name: str, status: str, latency_ms: int | None, message: str, route: str | None = None) -> dict:
    return {
        "code": code,
        "name": name,
        "status": status,
        "latency_ms": latency_ms,
        "last_checked_at": now_utc(),
        "message": message,
        "related_route": route,
    }


def internal_services(db: Session) -> list[dict]:
    services: list[dict] = []
    started = time.perf_counter()
    services.append(service_item("backend", "Backend API", "healthy", int((time.perf_counter() - started) * 1000), "الخادم الخلفي يستجيب."))

    frontend_path = project_root() / "frontend"
    services.append(
        service_item(
            "frontend",
            "Frontend",
            "healthy" if frontend_path.exists() else "warning",
            None,
            "مجلد الواجهة موجود." if frontend_path.exists() else "تعذر العثور على مجلد الواجهة.",
        )
    )

    started = time.perf_counter()
    try:
        db.execute(text("SELECT 1")).scalar_one()
        services.append(service_item("database", "Database Connection", "healthy", int((time.perf_counter() - started) * 1000), "الاتصال بقاعدة البيانات ناجح."))
    except Exception as exc:
        services.append(service_item("database", "Database Connection", "critical", int((time.perf_counter() - started) * 1000), f"فشل الاتصال: {exc}"))

    for code, name, path in [
        ("uploads", "Uploads Directory", uploads_root()),
        ("backups", "Backups Directory", backups_root(db)),
    ]:
        writable = folder_writable(path)
        services.append(
            service_item(
                code,
                name,
                "healthy" if writable else "critical",
                None,
                "المجلد قابل للكتابة." if writable else "المجلد غير قابل للكتابة.",
            )
        )
    return services


def database_health(db: Session) -> dict:
    cfg = health_settings(db)
    status = database_status(db)
    latency = int(status.get("latency_ms") or 0)
    status["status"] = "critical" if status["status"] == "critical" else threshold_status(latency, cfg.db_latency_warning_ms, cfg.db_latency_critical_ms)
    try:
        migrations = migration_status(db)
    except Exception:
        migrations = {"pending": []}
    status["pending_migrations"] = len(migrations.get("pending") or [])
    status["last_integrity_check_at"] = db.scalar(
        select(DatabaseMaintenanceLog.executed_at)
        .where(DatabaseMaintenanceLog.action.in_(["check_integrity", "integrity_check"]))
        .order_by(DatabaseMaintenanceLog.executed_at.desc())
        .limit(1)
    )
    status["last_maintenance_at"] = status.get("last_maintenance_at")
    status["safe_database_type"] = database_type_label()
    status["safe_database_name"] = safe_database_name()
    return status


def known_attachment_files(db: Session) -> tuple[set[str], int]:
    names: set[str] = set()
    request_attachments = db.scalars(select(Attachment.stored_name)).all()
    message_attachments = db.scalars(select(InternalMessageAttachment.stored_name)).all()
    for name in [*request_attachments, *message_attachments]:
        if name:
            names.add(str(name))
    return names, len(request_attachments) + len(message_attachments)


def storage_health(db: Session) -> dict:
    cfg = health_settings(db)
    usage = shutil.disk_usage(project_root())
    used_percent = round((usage.used / usage.total) * 100, 1) if usage.total else 0
    status = threshold_status(used_percent, cfg.disk_warning_percent, cfg.disk_critical_percent)
    uploads = uploads_root()
    backups = backups_root(db)
    upload_writable = folder_writable(uploads)
    if not upload_writable:
        status = "critical"

    known_files, attachments_count = known_attachment_files(db)
    all_upload_files = {item.name for item in uploads.rglob("*") if item.is_file()} if uploads.exists() else set()
    missing = 0
    for name in known_files:
        if not any((root / name).exists() for root in [uploads, uploads / "messages"]):
            missing += 1
    orphan = len({name for name in all_upload_files if name not in known_files and not name.startswith(".")})
    if missing:
        status = "warning" if status == "healthy" else status
    return {
        "status": status,
        "disk_used_percent": used_percent,
        "disk_total_size": usage.total,
        "disk_total_label": bytes_label(usage.total),
        "disk_used_size": usage.used,
        "disk_used_label": bytes_label(usage.used),
        "disk_free_size": usage.free,
        "disk_free_label": bytes_label(usage.free),
        "uploads_folder_size": folder_size(uploads),
        "uploads_folder_size_label": bytes_label(folder_size(uploads)),
        "backups_folder_size": folder_size(backups),
        "backups_folder_size_label": bytes_label(folder_size(backups)),
        "attachments_count": attachments_count,
        "missing_attachment_files_count": missing,
        "orphan_files_count": orphan,
        "uploads_directory_writable": upload_writable,
        "message": "التخزين يعمل ضمن الحدود." if status == "healthy" else "التخزين يحتاج متابعة.",
    }


def backup_health(db: Session) -> dict:
    cfg = backup_settings(db)
    backup_dir = backups_root(db)
    latest = db.scalar(select(DatabaseBackup).order_by(DatabaseBackup.created_at.desc()).limit(1))
    failed_count = db.scalar(select(func.count()).select_from(DatabaseBackup).where(DatabaseBackup.status.in_(["failed", "error"]))) or 0
    backup_count = db.scalar(select(func.count()).select_from(DatabaseBackup)) or 0
    writable = folder_writable(backup_dir)
    status = "healthy"
    message = "النسخ الاحتياطي ضمن الحالة الطبيعية."
    if not writable:
        status = "critical"
        message = "مجلد النسخ الاحتياطي غير قابل للكتابة."
    elif latest and latest.status in {"failed", "error"}:
        status = "critical"
        message = "آخر نسخة احتياطية فشلت."
    elif not latest:
        status = "warning"
        message = "لا توجد نسخة احتياطية محفوظة."
    elif latest.created_at:
        age_hours = (now_utc() - latest.created_at.replace(tzinfo=latest.created_at.tzinfo or timezone.utc)).total_seconds() / 3600
        if age_hours >= 72:
            status = "critical"
            message = "آخر نسخة احتياطية أقدم من 72 ساعة."
        elif age_hours >= 24:
            status = "warning"
            message = "آخر نسخة احتياطية أقدم من 24 ساعة."
    return {
        "status": status,
        "last_backup_at": latest.created_at if latest else None,
        "last_backup_status": latest.status if latest else None,
        "last_backup_size": latest.file_size if latest else 0,
        "last_backup_size_label": bytes_label(latest.file_size if latest else 0),
        "backup_count": backup_count,
        "auto_backup_enabled": bool(cfg.auto_backup_enabled),
        "failed_backups_count": failed_count,
        "backup_directory_writable": writable,
        "message": message,
    }


def count_log_errors_last(hours: int) -> int:
    keywords = ("ERROR", "Traceback", "Exception", "CRITICAL", "sqlalchemy.exc")
    cutoff = now_utc() - timedelta(hours=hours)
    total = 0
    for path in system_log_candidates():
        if not path.exists():
            continue
        try:
            if datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc) < cutoff:
                continue
            with path.open("r", encoding="utf-8", errors="ignore") as handle:
                total += sum(1 for line in handle if any(keyword in line for keyword in keywords))
        except OSError:
            continue
    return total


def latest_error_logs(db: Session, limit: int = 50) -> list[dict]:
    logs: list[dict] = []
    keywords = ("ERROR", "Traceback", "Exception", "CRITICAL", "sqlalchemy.exc")
    for path in system_log_candidates():
        if not path.exists():
            continue
        try:
            lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
            modified_at = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
        except OSError:
            continue
        for line_number, line in reversed(list(enumerate(lines, start=1))):
            message = line.strip()
            if not message or not any(keyword in message for keyword in keywords):
                continue
            level = "critical" if "CRITICAL" in message or "Traceback" in message else "error"
            logs.append(
                {
                    "id": f"{path.name}-{line_number}",
                    "created_at": modified_at,
                    "level": level,
                    "source": path.name,
                    "message": message[:700],
                    "user": None,
                    "ip_address": None,
                }
            )
            if len(logs) >= limit:
                break
        if len(logs) >= limit:
            break

    audit_errors = db.scalars(
        select(AuditLog)
        .options(selectinload(AuditLog.actor))
        .where(AuditLog.action.ilike("%error%"))
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(limit)
    ).all()
    for row in audit_errors:
        logs.append(
            {
                "id": f"audit-{row.id}",
                "created_at": row.created_at,
                "level": "warning",
                "source": "audit_logs",
                "message": row.action,
                "user": row.actor.full_name_ar if row.actor else None,
                "ip_address": row.ip_address,
            }
        )
    return sorted(logs, key=lambda item: item["created_at"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)[:limit]


def errors_health(db: Session) -> dict:
    cfg = health_settings(db)
    since_24h = now_utc() - timedelta(hours=24)
    since_7d = now_utc() - timedelta(days=7)
    audit_24h = db.scalar(select(func.count()).select_from(AuditLog).where(AuditLog.action.ilike("%error%"), AuditLog.created_at >= since_24h)) or 0
    audit_7d = db.scalar(select(func.count()).select_from(AuditLog).where(AuditLog.action.ilike("%error%"), AuditLog.created_at >= since_7d)) or 0
    errors_24h = int(audit_24h) + count_log_errors_last(24)
    errors_7d = int(audit_7d) + count_log_errors_last(24 * 7)
    critical = len([item for item in latest_error_logs(db, 100) if item.get("level") == "critical"])
    return {
        "status": threshold_status(errors_24h, cfg.errors_warning_count, cfg.errors_critical_count),
        "errors_last_24h": errors_24h,
        "errors_last_7d": errors_7d,
        "critical_errors_count": critical,
        "latest_error_logs": latest_error_logs(db),
        "errors_by_source": errors_by_source(db),
        "message": "مؤشرات الأخطاء ضمن الحدود." if errors_24h < cfg.errors_warning_count else "عدد الأخطاء يحتاج متابعة.",
    }


def errors_by_source(db: Session) -> list[dict]:
    counts: dict[str, int] = {}
    for item in latest_error_logs(db, 200):
        source = item.get("source") or "unknown"
        counts[source] = counts.get(source, 0) + 1
    return [{"source": source, "count": count} for source, count in sorted(counts.items(), key=lambda item: item[1], reverse=True)]


def jobs_health(db: Session) -> dict:
    db_jobs = db.scalars(select(DatabaseJob).options(selectinload(DatabaseJob.starter)).order_by(DatabaseJob.started_at.desc()).limit(50)).all()
    update_jobs = db.scalars(select(UpdateJob).options(selectinload(UpdateJob.starter)).order_by(UpdateJob.started_at.desc()).limit(50)).all()
    import_jobs = db.scalars(select(UserImportBatch).options(selectinload(UserImportBatch.uploader)).order_by(UserImportBatch.uploaded_at.desc()).limit(20)).all()
    rows = []
    for row in db_jobs:
        rows.append(
            {
                "id": f"database-{row.id}",
                "job_type": row.job_type,
                "status": row.status,
                "progress": row.progress,
                "started_by_name": row.starter.full_name_ar if row.starter else None,
                "started_at": row.started_at,
                "completed_at": row.completed_at,
                "message": row.message,
            }
        )
    for row in update_jobs:
        rows.append(
            {
                "id": f"update-{row.id}",
                "job_type": row.job_type,
                "status": row.status,
                "progress": row.progress,
                "started_by_name": row.starter.full_name_ar if row.starter else None,
                "started_at": row.started_at,
                "completed_at": row.completed_at,
                "message": row.message,
            }
        )
    for row in import_jobs:
        rows.append(
            {
                "id": f"import-{row.id}",
                "job_type": "user_import",
                "status": row.status,
                "progress": 100 if row.status in {"imported", "confirmed"} else 50,
                "started_by_name": row.uploader.full_name_ar if row.uploader else None,
                "started_at": row.uploaded_at,
                "completed_at": row.confirmed_at,
                "message": f"{row.imported_rows}/{row.total_rows} مستخدم",
            }
        )
    rows.sort(key=lambda item: item.get("started_at") or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    active = [row for row in rows if row["status"] in {"pending", "running"}]
    failed = [row for row in rows if row["status"] in {"failed", "error"}]
    return {"status": "critical" if failed else "warning" if active else "healthy", "active_jobs": len(active), "failed_jobs": len(failed), "jobs": rows[:80]}


def updates_health(db: Session) -> dict:
    current = ensure_current_version(db)
    latest_job = db.scalar(select(UpdateJob).order_by(UpdateJob.started_at.desc()).limit(1))
    active_job = db.scalar(select(UpdateJob).where(UpdateJob.status.in_(["pending", "running"])).order_by(UpdateJob.started_at.desc()).limit(1))
    latest_rollback = db.scalar(select(RollbackPoint).order_by(RollbackPoint.created_at.desc()).limit(1))
    pending = pending_migrations(db)
    status = "critical" if latest_job and latest_job.status == "failed" else "warning" if pending else "healthy"
    return {
        "status": status,
        "current_version": current.version,
        "last_update_time": latest_job.completed_at if latest_job else current.installed_at,
        "last_update_status": latest_job.status if latest_job else current.status,
        "last_post_update_health_check": db.scalar(select(SystemHealthCheck.checked_at).order_by(SystemHealthCheck.checked_at.desc()).limit(1)),
        "pending_migrations": len(pending),
        "active_update_job": {
            "id": active_job.id,
            "status": active_job.status,
            "progress": active_job.progress,
            "message": active_job.message,
        }
        if active_job
        else None,
        "rollback_point_exists": bool(latest_rollback),
    }


def active_alerts_count(db: Session) -> int:
    return int(db.scalar(select(func.count()).select_from(SystemHealthAlert).where(SystemHealthAlert.is_resolved.is_(False))) or 0)


def apply_health_alerts(db: Session, summary_parts: dict[str, dict]) -> None:
    alert_meta = {
        "database": ("قاعدة البيانات", "راجع إعدادات قاعدة البيانات أو الاتصال بالخادم.", "/settings/database"),
        "storage": ("التخزين والمرفقات", "راجع مساحة القرص ومجلدات الرفع.", "/settings/health-monitoring"),
        "backups": ("النسخ الاحتياطية", "أنشئ نسخة احتياطية أو راجع إعدادات النسخ.", "/settings/database"),
        "errors": ("الأخطاء والسجلات", "راجع آخر الأخطاء لمعالجة السبب.", "/settings/health-monitoring"),
        "updates": ("التحديثات", "راجع حالة التحديثات والترحيلات من شاشة مراقبة صحة النظام.", "/settings/health-monitoring"),
    }
    for key, data in summary_parts.items():
        status = data.get("status", "healthy")
        if status in {"warning", "critical"}:
            title, action, route = alert_meta.get(key, (key, "راجع تفاصيل الفحص.", None))
            upsert_alert(db, key, status, title, data.get("message") or title, action, route)
        else:
            resolve_alerts_by_type(db, key)


def run_all_checks(db: Session) -> dict:
    cfg = health_settings(db)
    retention_cutoff = now_utc() - timedelta(days=cfg.retention_days)
    db.execute(delete(SystemHealthCheck).where(SystemHealthCheck.checked_at < retention_cutoff))
    db.execute(delete(SystemHealthMetric).where(SystemHealthMetric.recorded_at < retention_cutoff))
    services = internal_services(db)
    db_health = database_health(db)
    storage = storage_health(db)
    backups = backup_health(db)
    errors = errors_health(db)
    jobs = jobs_health(db)
    updates = updates_health(db)
    parts = {
        "backend": services[0],
        "database": db_health,
        "storage": storage,
        "backups": backups,
        "errors": errors,
        "jobs": jobs,
        "updates": updates,
    }
    for key, value in parts.items():
        record_check(db, key, key, value.get("status", "healthy"), value.get("latency_ms"), value.get("message") or key, value)
    record_metric(db, "disk_used_percent", storage["disk_used_percent"], "percent", "storage")
    record_metric(db, "errors_last_24h", errors["errors_last_24h"], "count", "errors")
    record_metric(db, "db_latency_ms", db_health["latency_ms"], "ms", "database")
    apply_health_alerts(db, {"database": db_health, "storage": storage, "backups": backups, "errors": errors, "updates": updates})
    return summary_payload(db, services, db_health, storage, backups, errors, jobs, updates)


def latest_check_map(db: Session) -> dict[str, SystemHealthCheck]:
    checks = db.scalars(select(SystemHealthCheck).order_by(SystemHealthCheck.checked_at.desc(), SystemHealthCheck.id.desc()).limit(100)).all()
    latest: dict[str, SystemHealthCheck] = {}
    for check in checks:
        latest.setdefault(check.check_name, check)
    return latest


def summary_from_latest(db: Session) -> dict:
    latest = latest_check_map(db)
    if not latest:
        return run_all_checks(db)
    services = internal_services(db)
    db_health = latest.get("database").details_json if latest.get("database") else database_health(db)
    storage = latest.get("storage").details_json if latest.get("storage") else storage_health(db)
    backups = latest.get("backups").details_json if latest.get("backups") else backup_health(db)
    errors = latest.get("errors").details_json if latest.get("errors") else errors_health(db)
    jobs = latest.get("jobs").details_json if latest.get("jobs") else jobs_health(db)
    updates = latest.get("updates").details_json if latest.get("updates") else updates_health(db)
    return summary_payload(db, services, db_health, storage, backups, errors, jobs, updates)


def check_to_dict(row: SystemHealthCheck) -> dict:
    return {
        "id": row.id,
        "check_name": row.check_name,
        "category": row.category,
        "status": row.status,
        "latency_ms": row.latency_ms,
        "message": row.message,
        "details_json": row.details_json or {},
        "checked_at": row.checked_at,
    }


def alert_to_dict(row: SystemHealthAlert) -> dict:
    return {
        "id": row.id,
        "alert_type": row.alert_type,
        "severity": row.severity,
        "title": row.title,
        "message": row.message,
        "recommended_action": row.recommended_action,
        "related_route": row.related_route,
        "is_resolved": row.is_resolved,
        "created_at": row.created_at,
        "resolved_at": row.resolved_at,
        "resolved_by": row.resolved_by,
    }


def summary_payload(
    db: Session,
    services: list[dict],
    db_health: dict,
    storage: dict,
    backups: dict,
    errors: dict,
    jobs: dict,
    updates: dict,
) -> dict:
    latest_check = db.scalar(select(SystemHealthCheck.checked_at).order_by(SystemHealthCheck.checked_at.desc()).limit(1))
    parts = [services[0] if services else {"status": "warning"}, db_health, storage, backups, errors, updates]
    status = overall_status(parts)
    recent_checks = db.scalars(select(SystemHealthCheck).order_by(SystemHealthCheck.checked_at.desc(), SystemHealthCheck.id.desc()).limit(30)).all()
    alerts = db.scalars(select(SystemHealthAlert).order_by(SystemHealthAlert.is_resolved, SystemHealthAlert.created_at.desc()).limit(50)).all()
    return {
        "status": status,
        "version": ensure_current_version(db).version,
        "backend": services[0] if services else {"status": "warning"},
        "database": db_health,
        "storage": storage,
        "backup": backups,
        "backups": backups,
        "errors": errors,
        "jobs": jobs,
        "updates": updates,
        "errors_last_24h": errors.get("errors_last_24h", 0),
        "last_health_check_at": latest_check,
        "active_alerts_count": active_alerts_count(db),
        "memory": {"status": "healthy", "used_bytes": memory_usage_bytes(), "used_label": bytes_label(memory_usage_bytes())},
        "services": services,
        "recent_checks": [check_to_dict(row) for row in recent_checks],
        "alerts": [alert_to_dict(row) for row in alerts],
        "system_logs": errors.get("latest_error_logs", []),
    }


def clear_displayed_logs(db: Session) -> dict[str, int]:
    cleared_files = 0
    for path in system_log_candidates():
        if not path.exists():
            continue
        try:
            path.write_text("", encoding="utf-8")
            cleared_files += 1
        except OSError:
            continue
    deleted_audit_logs = db.execute(delete(AuditLog).where(AuditLog.action.ilike("%error%"))).rowcount or 0
    return {"cleared_files": cleared_files, "deleted_audit_logs": int(deleted_audit_logs)}


@router.get("/summary")
def health_summary(db: Session = Depends(get_db), _: User = HealthViewer):
    result = summary_from_latest(db)
    db.commit()
    return result


@router.post("/run-checks")
def run_checks(db: Session = Depends(get_db), actor: User = HealthViewer):
    result = run_all_checks(db)
    write_audit(db, "health_checks_run", "system_health", actor=actor, metadata={"status": result["status"]})
    db.commit()
    return result


@router.get("/services")
def get_services(db: Session = Depends(get_db), _: User = HealthViewer):
    return internal_services(db)


@router.get("/database")
def get_database_health(db: Session = Depends(get_db), _: User = HealthViewer):
    return database_health(db)


@router.get("/storage")
def get_storage_health(db: Session = Depends(get_db), _: User = HealthViewer):
    return storage_health(db)


@router.get("/backups")
def get_backup_health(db: Session = Depends(get_db), _: User = HealthViewer):
    return backup_health(db)


@router.post("/backups/create")
def create_health_backup(db: Session = Depends(get_db), actor: User = HealthAdmin):
    row, _job_id = create_backup(db, actor, "full_backup")
    return row


@router.get("/errors")
def get_errors_health(db: Session = Depends(get_db), _: User = HealthViewer):
    return errors_health(db)


@router.get("/jobs")
def get_jobs_health(db: Session = Depends(get_db), _: User = HealthViewer):
    return jobs_health(db)


@router.get("/updates")
def get_updates_health(db: Session = Depends(get_db), _: User = HealthViewer):
    return updates_health(db)


@router.get("/alerts")
def get_health_alerts(db: Session = Depends(get_db), _: User = HealthViewer):
    rows = db.scalars(select(SystemHealthAlert).order_by(SystemHealthAlert.is_resolved, SystemHealthAlert.created_at.desc()).limit(200)).all()
    return [alert_to_dict(row) for row in rows]


@router.post("/alerts/{alert_id}/resolve")
def resolve_health_alert(alert_id: int, db: Session = Depends(get_db), actor: User = HealthAdmin):
    row = db.get(SystemHealthAlert, alert_id)
    if not row:
        raise HTTPException(status_code=404, detail="التنبيه غير موجود")
    row.is_resolved = True
    row.resolved_at = now_utc()
    row.resolved_by = actor.id
    write_audit(db, "health_alert_resolved", "system_health", actor=actor, entity_id=str(row.id), metadata={"alert_type": row.alert_type})
    db.commit()
    return alert_to_dict(row)


@router.get("/settings")
def get_health_settings(db: Session = Depends(get_db), _: User = HealthViewer):
    return settings_to_dict(health_settings(db))


@router.put("/settings")
def update_health_settings(payload: HealthSettingsPayload, db: Session = Depends(get_db), actor: User = HealthAdmin):
    if payload.disk_warning_percent >= payload.disk_critical_percent:
        raise HTTPException(status_code=422, detail="حد تحذير مساحة التخزين يجب أن يكون أقل من حد الخطر")
    if payload.errors_warning_count >= payload.errors_critical_count:
        raise HTTPException(status_code=422, detail="حد تحذير الأخطاء يجب أن يكون أقل من حد الخطر")
    if payload.db_latency_warning_ms >= payload.db_latency_critical_ms:
        raise HTTPException(status_code=422, detail="حد تحذير بطء قاعدة البيانات يجب أن يكون أقل من حد الخطر")
    item = health_settings(db)
    old_value = settings_to_dict(item)
    for key, value in payload.model_dump().items():
        setattr(item, key, value)
    write_audit(db, "health_settings_updated", "system_health", actor=actor, metadata={"old_value": old_value, "new_value": payload.model_dump()})
    db.commit()
    db.refresh(item)
    return settings_to_dict(item)


@router.post("/clear-logs")
def clear_logs(db: Session = Depends(get_db), actor: User = HealthAdmin):
    result = clear_displayed_logs(db)
    write_audit(db, "system_logs_cleared", "system_health", actor=actor, metadata=result)
    summary = run_all_checks(db)
    db.commit()
    return summary
