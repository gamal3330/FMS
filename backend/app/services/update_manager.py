from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil
import time

from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.update import AppliedMigration, SystemVersion, UpdateHistory

SEMVER_RE = re.compile(r"^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$")


@dataclass(frozen=True)
class MigrationFile:
    migration_id: str
    version: str
    name: str
    path: Path
    checksum: str


def project_root() -> Path:
    return Path.cwd().parent if Path.cwd().name == "backend" else Path.cwd()


def configured_path(value: str) -> Path:
    path = Path(value)
    if path.is_absolute():
        return path
    return (Path.cwd() / path).resolve()


def updates_root() -> Path:
    path = configured_path(get_settings().updates_dir)
    path.mkdir(parents=True, exist_ok=True)
    (path / "migrations").mkdir(parents=True, exist_ok=True)
    (path / "releases").mkdir(parents=True, exist_ok=True)
    return path


def read_current_version_file() -> str:
    path = configured_path(get_settings().system_version_file)
    try:
        value = path.read_text(encoding="utf-8").strip()
    except OSError:
        value = "v1.0.0"
    return normalize_version(value)


def normalize_version(value: str | None) -> str:
    if not value:
        return "v1.0.0"
    cleaned = str(value).strip()
    if cleaned.endswith("-local"):
        cleaned = cleaned.removesuffix("-local")
    if not cleaned.startswith("v"):
        cleaned = f"v{cleaned}"
    return cleaned


def validate_version(value: str) -> None:
    if not SEMVER_RE.match(value):
        raise HTTPException(status_code=400, detail="رقم الإصدار يجب أن يكون بصيغة مثل v1.1.0")


def version_key(value: str) -> tuple[int, int, int, str]:
    normalized = normalize_version(value).lstrip("v")
    base, _, suffix = normalized.partition("-")
    parts = base.split(".")
    try:
        major, minor, patch = [int(part) for part in parts[:3]]
    except ValueError:
        major, minor, patch = (0, 0, 0)
    return major, minor, patch, suffix


def ensure_current_version(db: Session) -> SystemVersion:
    current = db.scalar(select(SystemVersion).where(SystemVersion.is_current.is_(True)).order_by(SystemVersion.installed_at.desc()))
    if current:
        return current
    version = read_current_version_file()
    current = SystemVersion(version=version, is_current=True, source="version.txt", notes="نسخة أولية من ملف version.txt")
    db.add(current)
    db.flush()
    return current


def read_manifest() -> dict:
    path = configured_path(get_settings().update_manifest_file)
    if not path.exists():
        return {"version": read_current_version_file(), "notes": "لا يوجد ملف update-manifest.json"}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="ملف update-manifest.json غير صالح") from exc
    data["version"] = normalize_version(data.get("version") or read_current_version_file())
    return data


def discover_migrations() -> list[MigrationFile]:
    migrations_dir = updates_root() / "migrations"
    migrations: list[MigrationFile] = []
    for path in sorted(migrations_dir.glob("*.py")):
        if path.name.startswith("__"):
            continue
        text_content = path.read_text(encoding="utf-8")
        checksum = hashlib.sha256(text_content.encode("utf-8")).hexdigest()
        migration_id = path.stem
        version = normalize_version(migration_id.split("__", 1)[0].replace("_", "."))
        migrations.append(MigrationFile(migration_id=migration_id, version=version, name=path.stem, path=path, checksum=checksum))
    return migrations


def pending_migrations(db: Session, target_version: str | None = None) -> list[MigrationFile]:
    applied = set(db.scalars(select(AppliedMigration.migration_id).where(AppliedMigration.status == "success")).all())
    migrations = [item for item in discover_migrations() if item.migration_id not in applied]
    if target_version:
        target_key = version_key(target_version)
        migrations = [item for item in migrations if version_key(item.version) <= target_key]
    return migrations


def migration_to_dict(item: MigrationFile) -> dict:
    return {
        "migration_id": item.migration_id,
        "version": item.version,
        "name": item.name,
        "checksum": item.checksum,
    }


def system_update_status(db: Session) -> dict:
    current = ensure_current_version(db)
    manifest = read_manifest()
    latest_version = normalize_version(manifest.get("version"))
    last_update = db.scalar(select(UpdateHistory).order_by(UpdateHistory.started_at.desc(), UpdateHistory.id.desc()).limit(1))
    pending = pending_migrations(db, latest_version)
    return {
        "current_version": current.version,
        "latest_version": latest_version,
        "update_available": version_key(latest_version) > version_key(current.version) or bool(pending),
        "pending_migrations": [migration_to_dict(item) for item in pending],
        "last_update": history_to_dict(last_update) if last_update else None,
        "system_status": "جاهز للتحديث" if pending or version_key(latest_version) > version_key(current.version) else "محدّث",
        "manifest": manifest,
        "updates_dir": str(updates_root().relative_to(project_root())) if updates_root().is_relative_to(project_root()) else str(updates_root()),
    }


def history_to_dict(item: UpdateHistory) -> dict:
    return {
        "id": item.id,
        "from_version": item.from_version,
        "to_version": item.to_version,
        "status": item.status,
        "message": item.message,
        "details_json": item.details_json or {},
        "started_at": item.started_at.isoformat() if item.started_at else None,
        "finished_at": item.finished_at.isoformat() if item.finished_at else None,
    }


def applied_migration_to_dict(item: AppliedMigration) -> dict:
    return {
        "id": item.id,
        "migration_id": item.migration_id,
        "version": item.version,
        "name": item.name,
        "status": item.status,
        "message": item.message,
        "execution_ms": item.execution_ms,
        "applied_at": item.applied_at.isoformat() if item.applied_at else None,
    }


def load_migration_module(path: Path):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"Cannot load migration {path.name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if not hasattr(module, "upgrade"):
        raise RuntimeError(f"Migration {path.name} does not define upgrade(connection)")
    return module


def backup_database_if_sqlite() -> str | None:
    settings = get_settings()
    if not settings.database_url.startswith("sqlite"):
        return None
    database = settings.database_url.replace("sqlite:///", "", 1)
    db_path = Path(database)
    if not db_path.is_absolute():
        db_path = Path.cwd() / db_path
    if not db_path.exists():
        return None
    backup_dir = updates_root() / "releases" / "database-backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup_path = backup_dir / f"{db_path.stem}-{datetime.now().strftime('%Y%m%d-%H%M%S')}{db_path.suffix}"
    shutil.copy2(db_path, backup_path)
    return str(backup_path)


def apply_available_update(db: Session) -> dict:
    current = ensure_current_version(db)
    manifest = read_manifest()
    target_version = normalize_version(manifest.get("version"))
    validate_version(target_version)
    migrations = pending_migrations(db, target_version)
    if not migrations and version_key(target_version) <= version_key(current.version):
        return {"applied": False, "message": "لا يوجد تحديث جديد", **system_update_status(db)}

    history = UpdateHistory(from_version=current.version, to_version=target_version, status="running", message="بدأ تنفيذ التحديث")
    db.add(history)
    db.flush()
    backup_path = backup_database_if_sqlite()
    executed: list[dict] = []

    try:
        connection = db.connection()
        for migration in migrations:
            started = time.perf_counter()
            module = load_migration_module(migration.path)
            module.upgrade(connection)
            execution_ms = int((time.perf_counter() - started) * 1000)
            applied = AppliedMigration(
                migration_id=migration.migration_id,
                version=migration.version,
                name=migration.name,
                checksum=migration.checksum,
                status="success",
                message="تم التنفيذ",
                execution_ms=execution_ms,
            )
            db.add(applied)
            executed.append(applied_migration_to_dict(applied))

        db.query(SystemVersion).update({SystemVersion.is_current: False})
        target_record = db.scalar(select(SystemVersion).where(SystemVersion.version == target_version))
        if target_record:
            target_record.is_current = True
            target_record.source = "update-manifest.json"
            target_record.notes = manifest.get("notes")
        else:
            db.add(SystemVersion(version=target_version, is_current=True, source="update-manifest.json", notes=manifest.get("notes")))
        history.status = "success"
        history.message = "تم تنفيذ التحديث بنجاح"
        history.details_json = {"database_backup": backup_path, "migrations": [migration_to_dict(item) for item in migrations]}
        history.finished_at = datetime.now()
        db.commit()
        return {"applied": True, "message": history.message, "executed_migrations": executed, **system_update_status(db)}
    except Exception as exc:
        db.rollback()
        failure = UpdateHistory(
            from_version=current.version,
            to_version=target_version,
            status="failed",
            message=f"فشل التحديث: {exc}",
            details_json={"database_backup": backup_path, "failed_migrations": [migration_to_dict(item) for item in migrations]},
            finished_at=datetime.now(),
        )
        db.add(failure)
        db.commit()
        raise HTTPException(status_code=500, detail=f"فشل تنفيذ التحديث: {exc}") from exc


def update_history(db: Session, limit: int = 50) -> list[dict]:
    rows = db.scalars(select(UpdateHistory).order_by(UpdateHistory.started_at.desc(), UpdateHistory.id.desc()).limit(limit)).all()
    return [history_to_dict(row) for row in rows]


def applied_migrations_history(db: Session, limit: int = 100) -> list[dict]:
    rows = db.scalars(select(AppliedMigration).order_by(AppliedMigration.applied_at.desc(), AppliedMigration.id.desc()).limit(limit)).all()
    return [applied_migration_to_dict(row) for row in rows]


def create_performance_indexes(connection) -> None:
    dialect = connection.dialect.name
    indexes = [
        ("idx_service_requests_status_created", "service_requests", "status, created_at"),
        ("idx_service_requests_requester_created", "service_requests", "requester_id, created_at"),
        ("idx_service_requests_department_created", "service_requests", "department_id, created_at"),
        ("idx_approval_steps_role_action", "approval_steps", "role, action"),
        ("idx_approval_steps_request_action", "approval_steps", "request_id, action"),
        ("idx_request_approval_steps_status_order", "request_approval_steps", "request_id, status, sort_order"),
        ("idx_audit_logs_created_action", "audit_logs", "created_at, action"),
        ("idx_users_role_active", "users", "role, is_active"),
    ]
    for name, table, columns in indexes:
        if dialect == "postgresql":
            connection.execute(text(f'CREATE INDEX IF NOT EXISTS "{name}" ON "{table}" ({columns})'))
        else:
            connection.execute(text(f'CREATE INDEX IF NOT EXISTS "{name}" ON "{table}" ({columns})'))
