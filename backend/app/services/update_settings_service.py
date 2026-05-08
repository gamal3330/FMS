from __future__ import annotations

import hashlib
import json
import os
import shutil
import tarfile
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import select, text
from sqlalchemy.orm import Session, selectinload

from app.core.config import get_settings
from app.core.security import verify_password
from app.models.audit import AuditLog
from app.models.enums import UserRole
from app.models.update import RollbackPoint, SystemVersion, UpdateJob, UpdateLog, UpdatePackage, UpdateSettings
from app.models.user import User
from app.services.audit import write_audit
from app.services.database_backup_service import create_backup
from app.services.database_status_service import PROJECT_ROOT, database_status
from app.services.update_manager import apply_available_update, ensure_current_version, normalize_version, pending_migrations, read_current_version_file, validate_version, version_key

settings = get_settings()
MAX_UPDATE_PACKAGE_BYTES = 1024 * 1024 * 1024
ALLOWED_PACKAGE_SUFFIXES = (".zip", ".tar.gz", ".tgz")
PROTECTED_NAMES = {".env", ".venv", ".venv-runtime", ".venv312", "node_modules", "__pycache__", ".git", "uploads", "backups"}


def update_settings(db: Session) -> UpdateSettings:
    item = db.scalar(select(UpdateSettings).limit(1))
    if item:
        return item
    item = UpdateSettings()
    db.add(item)
    db.flush()
    return item


def update_temp_dir() -> Path:
    path = PROJECT_ROOT / "updates" / "temp"
    path.mkdir(parents=True, exist_ok=True)
    return path


def release_staging_dir() -> Path:
    path = PROJECT_ROOT / "updates" / "releases" / "staged"
    path.mkdir(parents=True, exist_ok=True)
    return path


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def is_supported_package(filename: str) -> bool:
    lower = filename.lower()
    return lower.endswith(ALLOWED_PACKAGE_SUFFIXES)


def assert_safe_member(name: str) -> None:
    pure = PurePosixPath(name)
    if pure.is_absolute() or ".." in pure.parts or not str(pure).strip():
        raise HTTPException(status_code=400, detail="حزمة التحديث تحتوي على مسار غير آمن")


def package_members(path: Path) -> list[str]:
    if path.name.lower().endswith(".zip"):
        with zipfile.ZipFile(path) as archive:
            names = archive.namelist()
    else:
        with tarfile.open(path, "r:*") as archive:
            names = archive.getnames()
    for name in names:
        assert_safe_member(name)
    return names


def read_package_text(path: Path, name: str, limit: int = 1024 * 1024) -> str | None:
    try:
        if path.name.lower().endswith(".zip"):
            with zipfile.ZipFile(path) as archive:
                with archive.open(name) as handle:
                    return handle.read(limit).decode("utf-8")
        with tarfile.open(path, "r:*") as archive:
            member = archive.getmember(name)
            extracted = archive.extractfile(member)
            return extracted.read(limit).decode("utf-8") if extracted else None
    except Exception:
        return None


def common_root(names: list[str]) -> str:
    roots = {PurePosixPath(name).parts[0] for name in names if PurePosixPath(name).parts}
    return next(iter(roots)) if len(roots) == 1 and not next(iter(roots)).endswith((".json", ".md")) else ""


def strip_common_root(names: list[str], root: str) -> set[str]:
    result = set()
    for name in names:
        pure = PurePosixPath(name)
        parts = pure.parts
        if root and parts and parts[0] == root:
            parts = parts[1:]
        if parts:
            result.add("/".join(parts))
    return result


def package_file_path(row: UpdatePackage) -> Path:
    path = Path(row.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="ملف حزمة التحديث غير موجود")
    return path


def validate_package_file(path: Path, current_version: str | None = None) -> dict:
    if not is_supported_package(path.name):
        raise HTTPException(status_code=400, detail="يجب رفع حزمة بصيغة ZIP أو TAR.GZ")
    try:
        names = package_members(path)
    except (zipfile.BadZipFile, tarfile.TarError) as exc:
        raise HTTPException(status_code=400, detail="ملف التحديث غير صالح أو تالف") from exc
    root = common_root(names)
    normalized_names = strip_common_root(names, root)
    errors: list[str] = []
    warnings: list[str] = []
    if "manifest.json" not in normalized_names:
        errors.append("manifest.json غير موجود")
    if "release_notes.md" not in normalized_names:
        errors.append("release_notes.md غير موجود")
    manifest_text = read_package_text(path, f"{root + '/' if root else ''}manifest.json")
    manifest: dict[str, Any] = {}
    if manifest_text:
        try:
            manifest = json.loads(manifest_text)
        except json.JSONDecodeError:
            errors.append("manifest.json غير صالح")
    version = normalize_version(manifest.get("version") if manifest else None)
    if manifest:
        try:
            validate_version(version)
        except HTTPException as exc:
            errors.append(str(exc.detail))
        min_current = normalize_version(manifest.get("min_current_version") or "v0.0.0")
        if current_version and version_key(current_version) < version_key(min_current):
            errors.append(f"يتطلب التحديث إصداراً لا يقل عن {min_current}")
        if current_version and version_key(version) <= version_key(current_version):
            warnings.append(f"الإصدار {version} ليس أحدث من الإصدار الحالي {current_version}")
    includes_backend = "backend" in {PurePosixPath(name).parts[0] for name in normalized_names if PurePosixPath(name).parts}
    includes_frontend = "frontend" in {PurePosixPath(name).parts[0] for name in normalized_names if PurePosixPath(name).parts}
    includes_uploads = "uploads" in {PurePosixPath(name).parts[0] for name in normalized_names if PurePosixPath(name).parts}
    has_migrations = any(name.startswith("migrations/") or name.startswith("updates/migrations/") for name in normalized_names)
    if not (includes_backend or includes_frontend or has_migrations):
        warnings.append("الحزمة لا تحتوي على backend أو frontend أو migrations")
    release_notes = read_package_text(path, f"{root + '/' if root else ''}release_notes.md", limit=20000) or ""
    return {
        "valid": not errors,
        "errors": errors,
        "warnings": warnings,
        "root": root,
        "manifest": manifest,
        "release_notes": release_notes,
        "version": version,
        "release_date": manifest.get("release_date") if manifest else None,
        "requires_migration": bool(manifest.get("requires_migration") or has_migrations),
        "requires_restart": bool(manifest.get("requires_restart", True)),
        "includes_backend": bool(manifest.get("includes_backend", includes_backend)),
        "includes_frontend": bool(manifest.get("includes_frontend", includes_frontend)),
        "includes_uploads": bool(manifest.get("includes_uploads", includes_uploads)),
        "has_migrations": has_migrations,
        "files_count": len([name for name in normalized_names if not name.endswith("/")]),
    }


async def save_update_upload(db: Session, file: UploadFile, actor: User) -> dict:
    cfg = update_settings(db)
    if not cfg.allow_local_update_upload:
        raise HTTPException(status_code=403, detail="رفع التحديث المحلي غير مفعل من إعدادات النظام")
    filename = Path(file.filename or "").name
    if not is_supported_package(filename):
        raise HTTPException(status_code=400, detail="يجب رفع حزمة بصيغة ZIP أو TAR.GZ")
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    suffix = ".tar.gz" if filename.lower().endswith((".tar.gz", ".tgz")) else ".zip"
    target = update_temp_dir() / f"update-{timestamp}-{actor.id}{suffix}"
    size = 0
    with target.open("wb") as handle:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_UPDATE_PACKAGE_BYTES:
                target.unlink(missing_ok=True)
                raise HTTPException(status_code=400, detail="حزمة التحديث أكبر من الحد المسموح")
            handle.write(chunk)
    checksum = sha256_file(target)
    current = ensure_current_version(db).version
    validation = validate_package_file(target, current)
    row = UpdatePackage(
        file_name=filename,
        file_path=str(target),
        version=validation["version"],
        checksum=checksum,
        status="validated" if validation["valid"] else "uploaded_with_errors",
        uploaded_by=actor.id,
        validated_at=datetime.now(timezone.utc) if validation["valid"] else None,
        metadata_json={**validation, "checksum": checksum, "size_bytes": size},
    )
    db.add(row)
    db.flush()
    write_audit(db, "update_package_uploaded", "system_update", actor=actor, entity_id=str(row.id), metadata={"version": row.version, "valid": validation["valid"]})
    db.commit()
    db.refresh(row)
    return package_to_dict(row)


def package_to_dict(row: UpdatePackage) -> dict:
    return {
        "id": row.id,
        "file_name": row.file_name,
        "version": row.version,
        "checksum": row.checksum,
        "status": row.status,
        "uploaded_by": row.uploaded_by,
        "uploaded_by_name": row.uploader.full_name_ar if row.uploader else None,
        "uploaded_at": row.uploaded_at,
        "validated_at": row.validated_at,
        "metadata_json": row.metadata_json or {},
    }


def job_to_dict(row: UpdateJob) -> dict:
    return {
        "id": row.id,
        "job_type": row.job_type,
        "from_version": row.from_version,
        "to_version": row.to_version,
        "status": row.status,
        "progress": row.progress,
        "message": row.message,
        "started_by": row.started_by,
        "started_by_name": row.starter.full_name_ar if row.starter else None,
        "started_at": row.started_at,
        "completed_at": row.completed_at,
        "details_json": row.details_json or {},
    }


def rollback_to_dict(row: RollbackPoint) -> dict:
    return {
        "id": row.id,
        "version": row.version,
        "database_backup_id": row.database_backup_id,
        "uploads_backup_id": row.uploads_backup_id,
        "config_backup_path": bool(row.config_backup_path),
        "created_by": row.created_by,
        "created_by_name": row.creator.full_name_ar if row.creator else None,
        "created_at": row.created_at,
        "status": row.status,
        "details_json": row.details_json or {},
    }


def log_update_step(db: Session, job: UpdateJob | None, step: str, status_value: str, message: str) -> None:
    db.add(UpdateLog(update_job_id=job.id if job else None, step_name=step, status=status_value, message=message))
    if job:
        job.message = message


def active_update_job(db: Session) -> UpdateJob | None:
    return db.scalar(select(UpdateJob).where(UpdateJob.status.in_(["pending", "running"])).order_by(UpdateJob.started_at.desc()).limit(1))


def update_overview(db: Session) -> dict:
    current = ensure_current_version(db)
    db_status = database_status(db)
    latest_job = db.scalar(select(UpdateJob).order_by(UpdateJob.started_at.desc()).limit(1))
    running_job = active_update_job(db)
    last_backup = db_status.get("last_backup_at")
    pending = pending_migrations(db)
    return {
        "current_version": current.version,
        "build_number": current.build_number or "-",
        "environment": settings.environment,
        "backend_status": "healthy",
        "frontend_status": "healthy" if (PROJECT_ROOT / "frontend").exists() else "warning",
        "database_status": db_status.get("status", "unknown"),
        "last_backup_at": last_backup,
        "last_update_at": latest_job.completed_at if latest_job else current.installed_at,
        "last_health_check_at": datetime.now(timezone.utc),
        "pending_migrations": len(pending),
        "active_job": job_to_dict(running_job) if running_job else None,
    }


def update_versions(db: Session) -> list[dict]:
    rows = db.scalars(select(SystemVersion).order_by(SystemVersion.installed_at.desc())).all()
    return [
        {
            "id": row.id,
            "version": row.version,
            "build_number": row.build_number or "-",
            "commit_hash": row.commit_hash,
            "release_date": row.installed_at,
            "installed_by": row.deployed_by,
            "installed_by_name": row.deployer.full_name_ar if row.deployer else None,
            "installed_at": row.installed_at,
            "status": "current" if row.is_current else row.status,
            "notes": row.notes,
        }
        for row in rows
    ]


def precheck(db: Session) -> dict:
    checks: list[dict] = []

    def add(code: str, label: str, status_value: str, message: str, critical: bool = False) -> None:
        checks.append({"code": code, "label": label, "status": status_value, "message": message, "critical": critical})

    try:
        db.execute(text("SELECT 1")).scalar_one()
        add("database", "Database connection", "passed", "الاتصال بقاعدة البيانات يعمل", True)
    except Exception as exc:
        add("database", "Database connection", "failed", f"فشل الاتصال: {exc}", True)
    usage = shutil.disk_usage(PROJECT_ROOT)
    free_gb = round(usage.free / 1024 / 1024 / 1024, 2)
    add("disk", "Disk space", "passed" if free_gb >= 1 else "warning", f"المساحة الحرة {free_gb} GB", free_gb < 0.5)
    for code, folder in [("backups", PROJECT_ROOT / "backups"), ("uploads", PROJECT_ROOT / settings.upload_dir), ("updates", PROJECT_ROOT / "updates")]:
        try:
            folder.mkdir(parents=True, exist_ok=True)
            probe = folder / ".write-test"
            probe.write_text("ok", encoding="utf-8")
            probe.unlink(missing_ok=True)
            add(code, folder.name, "passed", "المجلد قابل للكتابة")
        except Exception as exc:
            add(code, folder.name, "failed", f"المجلد غير قابل للكتابة: {exc}", True)
    add("backend", "Backend health", "passed", "الخلفية تعمل")
    add("frontend", "Frontend availability", "passed" if (PROJECT_ROOT / "frontend").exists() else "warning", "تم العثور على مجلد الواجهة")
    pending = pending_migrations(db)
    add("migrations", "Pending migrations", "warning" if pending else "passed", f"عدد الترحيلات المعلقة: {len(pending)}")
    ready = not any(item["status"] == "failed" and item["critical"] for item in checks)
    return {"ready": ready, "checks": checks, "summary": "جاهز للتحديث" if ready else "يوجد فشل حرج يمنع التحديث"}


def list_packages(db: Session) -> list[dict]:
    rows = db.scalars(select(UpdatePackage).options(selectinload(UpdatePackage.uploader)).order_by(UpdatePackage.uploaded_at.desc())).all()
    return [package_to_dict(row) for row in rows]


def list_jobs(db: Session) -> list[dict]:
    rows = db.scalars(select(UpdateJob).options(selectinload(UpdateJob.starter)).order_by(UpdateJob.started_at.desc())).all()
    return [job_to_dict(row) for row in rows]


def list_rollback_points(db: Session) -> list[dict]:
    rows = db.scalars(select(RollbackPoint).options(selectinload(RollbackPoint.creator)).order_by(RollbackPoint.created_at.desc())).all()
    return [rollback_to_dict(row) for row in rows]


def release_notes(db: Session) -> list[dict]:
    notes = []
    for package in db.scalars(select(UpdatePackage).order_by(UpdatePackage.uploaded_at.desc())).all():
        metadata = package.metadata_json or {}
        notes.append(
            {
                "version": package.version,
                "release_date": metadata.get("release_date"),
                "notes": metadata.get("release_notes") or "",
                "new_features": metadata.get("manifest", {}).get("new_features", []),
                "improvements": metadata.get("manifest", {}).get("improvements", []),
                "bug_fixes": metadata.get("manifest", {}).get("bug_fixes", []),
                "database_changes": metadata.get("manifest", {}).get("database_changes", []),
                "security_notes": metadata.get("manifest", {}).get("security_notes", []),
            }
        )
    return notes


def validate_existing_package(db: Session, package_id: int) -> dict:
    row = db.get(UpdatePackage, package_id)
    if not row:
        raise HTTPException(status_code=404, detail="حزمة التحديث غير موجودة")
    current = ensure_current_version(db).version
    result = validate_package_file(package_file_path(row), current)
    row.version = result["version"]
    row.status = "validated" if result["valid"] else "validation_failed"
    row.validated_at = datetime.now(timezone.utc) if result["valid"] else None
    row.metadata_json = {**(row.metadata_json or {}), **result, "checksum": row.checksum}
    db.commit()
    db.refresh(row)
    return package_to_dict(row)


def preview_package(db: Session, package_id: int) -> dict:
    row = db.get(UpdatePackage, package_id)
    if not row:
        raise HTTPException(status_code=404, detail="حزمة التحديث غير موجودة")
    metadata = row.metadata_json or validate_existing_package(db, package_id).get("metadata_json", {})
    current = ensure_current_version(db).version
    return {
        "current_version": current,
        "target_version": row.version or metadata.get("version"),
        "release_date": metadata.get("release_date"),
        "requires_migration": metadata.get("requires_migration", False),
        "requires_restart": metadata.get("requires_restart", True),
        "includes_backend": metadata.get("includes_backend", False),
        "includes_frontend": metadata.get("includes_frontend", False),
        "includes_uploads": metadata.get("includes_uploads", False),
        "estimated_services": ["backend" if metadata.get("includes_backend") else None, "frontend" if metadata.get("includes_frontend") else None, "database" if metadata.get("requires_migration") else None],
        "release_notes_summary": (metadata.get("release_notes") or "")[:1200],
        "warnings": metadata.get("warnings", []),
        "errors": metadata.get("errors", []),
        "can_apply": bool(metadata.get("valid", False)),
    }


def extract_package(path: Path, destination: Path, root: str = "") -> None:
    destination.mkdir(parents=True, exist_ok=True)
    if path.name.lower().endswith(".zip"):
        with zipfile.ZipFile(path) as archive:
            for member in archive.namelist():
                assert_safe_member(member)
                pure = PurePosixPath(member)
                parts = pure.parts[1:] if root and pure.parts and pure.parts[0] == root else pure.parts
                if not parts:
                    continue
                target = (destination / Path(*parts)).resolve()
                if not str(target).startswith(str(destination.resolve())):
                    raise HTTPException(status_code=400, detail="حزمة التحديث تحتوي على مسار غير آمن")
                if member.endswith("/"):
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with archive.open(member) as source, target.open("wb") as output:
                        shutil.copyfileobj(source, output)
        return
    with tarfile.open(path, "r:*") as archive:
        for member in archive.getmembers():
            assert_safe_member(member.name)
            pure = PurePosixPath(member.name)
            parts = pure.parts[1:] if root and pure.parts and pure.parts[0] == root else pure.parts
            if not parts:
                continue
            target = (destination / Path(*parts)).resolve()
            if not str(target).startswith(str(destination.resolve())):
                raise HTTPException(status_code=400, detail="حزمة التحديث تحتوي على مسار غير آمن")
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                target.parent.mkdir(parents=True, exist_ok=True)
                source = archive.extractfile(member)
                if source:
                    with target.open("wb") as output:
                        shutil.copyfileobj(source, output)


def backup_existing_path(path: Path, rollback_root: Path, relative: Path) -> None:
    if not path.exists():
        return
    target = rollback_root / "files" / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    if path.is_dir():
        shutil.copytree(path, target, dirs_exist_ok=True, ignore=shutil.ignore_patterns(*PROTECTED_NAMES))
    else:
        shutil.copy2(path, target)


def copy_update_tree(source: Path, target: Path, rollback_root: Path, relative_root: Path) -> dict:
    copied = 0
    skipped = 0
    for item in source.rglob("*"):
        relative = item.relative_to(source)
        if any(part in PROTECTED_NAMES for part in relative.parts):
            skipped += 1
            continue
        destination = target / relative
        if item.is_dir():
            destination.mkdir(parents=True, exist_ok=True)
            continue
        backup_existing_path(destination, rollback_root, relative_root / relative)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(item, destination)
        copied += 1
    return {"copied": copied, "skipped": skipped}


def create_config_backup(rollback_root: Path) -> str:
    config_root = rollback_root / "config"
    config_root.mkdir(parents=True, exist_ok=True)
    for name in ["version.txt", "update-manifest.json", "docker-compose.yml", ".env", ".env.docker"]:
        source = PROJECT_ROOT / name
        if source.exists() and source.is_file():
            shutil.copy2(source, config_root / name)
    backend_env = PROJECT_ROOT / "backend" / ".env"
    if backend_env.exists():
        (config_root / "backend").mkdir(exist_ok=True)
        shutil.copy2(backend_env, config_root / "backend" / ".env")
    return str(config_root)


def ensure_super_admin_password(actor: User, password: str) -> None:
    if actor.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="هذه العملية متاحة لمدير النظام فقط")
    if not verify_password(password, actor.hashed_password):
        raise HTTPException(status_code=403, detail="كلمة مرور مدير النظام غير صحيحة")


def apply_local_package(db: Session, package_id: int, actor: User, admin_password: str, confirmation_text: str, understood: bool) -> dict:
    ensure_super_admin_password(actor, admin_password)
    if confirmation_text != "APPLY UPDATE":
        raise HTTPException(status_code=422, detail="عبارة التأكيد غير صحيحة")
    if not understood:
        raise HTTPException(status_code=422, detail="يجب تأكيد فهم أثر التحديث")
    cfg = update_settings(db)
    if settings.environment == "production" and cfg.block_updates_in_production_without_flag and os.getenv("ALLOW_PRODUCTION_UPDATE") != "true":
        raise HTTPException(status_code=403, detail="التحديث في الإنتاج ممنوع بدون ALLOW_PRODUCTION_UPDATE=true")
    if active_update_job(db):
        raise HTTPException(status_code=409, detail="توجد عملية تحديث قيد التنفيذ")
    package = db.get(UpdatePackage, package_id)
    if not package:
        raise HTTPException(status_code=404, detail="حزمة التحديث غير موجودة")
    validation = validate_existing_package(db, package_id)
    metadata = validation["metadata_json"]
    if not metadata.get("valid"):
        raise HTTPException(status_code=422, detail="لا يمكن تطبيق حزمة لم تنجح في التحقق")
    pre = precheck(db)
    if not pre["ready"]:
        raise HTTPException(status_code=422, detail="فشل الفحص قبل التحديث")
    current = ensure_current_version(db)
    job = UpdateJob(job_type="local_update", from_version=current.version, to_version=package.version, status="running", progress=5, message="بدأ تطبيق التحديث", started_by=actor.id, details_json={"package_id": package.id})
    db.add(job)
    db.flush()
    rollback_root = PROJECT_ROOT / "updates" / "rollbacks" / f"rollback-{package.id}-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    rollback_root.mkdir(parents=True, exist_ok=True)
    try:
        log_update_step(db, job, "precheck", "success", "تم اجتياز الفحص قبل التحديث")
        database_backup_id = None
        if cfg.auto_backup_before_update:
            backup, _ = create_backup(db, actor, "full_backup")
            database_backup_id = backup["id"]
        config_backup_path = create_config_backup(rollback_root)
        rollback = RollbackPoint(version=current.version, database_backup_id=database_backup_id, config_backup_path=config_backup_path, created_by=actor.id, status="ready", details_json={"rollback_root": str(rollback_root), "package_id": package.id})
        db.add(rollback)
        db.flush()
        job.progress = 30
        log_update_step(db, job, "backup", "success", "تم إنشاء نقطة استرجاع قبل التحديث")
        with tempfile.TemporaryDirectory(prefix="qib-update-") as temp:
            temp_root = Path(temp)
            extract_package(package_file_path(package), temp_root, metadata.get("root") or "")
            applied: dict[str, Any] = {}
            for root_file in ["version.txt", "update-manifest.json", "release_notes.md", "checksums.json"]:
                source_file = temp_root / root_file
                if source_file.exists() and source_file.is_file():
                    backup_existing_path(PROJECT_ROOT / root_file, rollback_root, Path(root_file))
                    shutil.copy2(source_file, PROJECT_ROOT / root_file)
                    applied[root_file] = "copied"
            for folder_name in ["backend", "frontend", "scripts"]:
                source = temp_root / folder_name
                if source.exists():
                    applied[folder_name] = copy_update_tree(source, PROJECT_ROOT / folder_name, rollback_root, Path(folder_name))
            migrations_source = temp_root / "migrations"
            if not migrations_source.exists():
                migrations_source = temp_root / "updates" / "migrations"
            if migrations_source.exists():
                migrations_target = PROJECT_ROOT / "updates" / "migrations"
                migrations_target.mkdir(parents=True, exist_ok=True)
                applied["migrations"] = copy_update_tree(migrations_source, migrations_target, rollback_root, Path("updates") / "migrations")
            job.progress = 65
            log_update_step(db, job, "files", "success", "تم تطبيق ملفات التحديث")
            if metadata.get("requires_migration") or migrations_source.exists():
                migration_result = apply_available_update(db)
                applied["migration_result"] = migration_result
            else:
                db.query(SystemVersion).update({SystemVersion.is_current: False})
                db.add(SystemVersion(version=package.version or current.version, is_current=True, source="local_package", status="installed", notes=(metadata.get("release_notes") or "")[:2000], deployed_by=actor.id))
                db.flush()
            job.progress = 85
            log_update_step(db, job, "migrations", "success", "تم تحديث قاعدة البيانات أو رقم الإصدار")
        health = database_status(db)
        ok = health.get("status") == "healthy"
        job.status = "success" if ok else "failed"
        job.progress = 100
        job.completed_at = datetime.now(timezone.utc)
        job.message = "تم تطبيق التحديث بنجاح" if ok else "تم التطبيق لكن فحص الصحة فشل"
        job.details_json = {**(job.details_json or {}), "health": health, "rollback_point_id": rollback.id}
        package.status = "applied" if ok else "applied_health_failed"
        write_audit(db, "update_applied", "system_update", actor=actor, entity_id=str(job.id), metadata={"package_id": package.id, "version": package.version, "status": job.status})
        db.commit()
        return job_to_dict(job)
    except Exception as exc:
        job.status = "failed"
        job.progress = min(job.progress or 0, 95)
        job.completed_at = datetime.now(timezone.utc)
        job.message = str(getattr(exc, "detail", exc))[:1000]
        log_update_step(db, job, "apply", "failed", job.message)
        write_audit(db, "update_failed", "system_update", actor=actor, entity_id=str(job.id), metadata={"package_id": package.id, "error": job.message})
        db.commit()
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(status_code=500, detail="فشل تطبيق التحديث") from exc


def rollback_update(db: Session, rollback_point_id: int, actor: User, admin_password: str, confirmation_text: str) -> dict:
    ensure_super_admin_password(actor, admin_password)
    if confirmation_text != "ROLLBACK UPDATE":
        raise HTTPException(status_code=422, detail="عبارة التأكيد غير صحيحة")
    rollback = db.get(RollbackPoint, rollback_point_id)
    if not rollback or rollback.status != "ready":
        raise HTTPException(status_code=404, detail="نقطة الاسترجاع غير متاحة")
    if active_update_job(db):
        raise HTTPException(status_code=409, detail="توجد عملية تحديث قيد التنفيذ")
    current = ensure_current_version(db)
    job = UpdateJob(job_type="rollback", from_version=current.version, to_version=rollback.version, status="running", progress=10, message="بدأ الاسترجاع", started_by=actor.id, details_json={"rollback_point_id": rollback.id})
    db.add(job)
    db.flush()
    try:
        create_backup(db, actor, "full_backup")
        root = Path((rollback.details_json or {}).get("rollback_root") or "")
        files_root = root / "files"
        restored = 0
        if files_root.exists():
            for item in files_root.rglob("*"):
                if item.is_file():
                    relative = item.relative_to(files_root)
                    target = PROJECT_ROOT / relative
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(item, target)
                    restored += 1
        db.query(SystemVersion).update({SystemVersion.is_current: False})
        db.add(SystemVersion(version=rollback.version, is_current=True, source="rollback", status="rolled_back", notes=f"Rollback point #{rollback.id}", deployed_by=actor.id))
        rollback.status = "rolled_back"
        job.status = "rolled_back"
        job.progress = 100
        job.completed_at = datetime.now(timezone.utc)
        job.message = "تم تنفيذ الاسترجاع. قد تحتاج لإعادة تشغيل الخدمات."
        job.details_json = {"rollback_point_id": rollback.id, "restored_files": restored}
        write_audit(db, "update_rolled_back", "system_update", actor=actor, entity_id=str(job.id), metadata={"rollback_point_id": rollback.id})
        db.commit()
        return job_to_dict(job)
    except Exception as exc:
        job.status = "failed"
        job.completed_at = datetime.now(timezone.utc)
        job.message = str(exc)[:1000]
        write_audit(db, "update_rollback_failed", "system_update", actor=actor, entity_id=str(job.id), metadata={"rollback_point_id": rollback.id, "error": job.message})
        db.commit()
        raise HTTPException(status_code=500, detail="فشل الاسترجاع") from exc


def update_audit_logs(db: Session) -> list[dict]:
    rows = db.scalars(select(AuditLog).options(selectinload(AuditLog.actor)).where(AuditLog.entity_type == "system_update").order_by(AuditLog.created_at.desc()).limit(200)).all()
    return [
        {
            "id": row.id,
            "action": row.action,
            "user_name": row.actor.full_name_ar if row.actor else None,
            "created_at": row.created_at,
            "ip_address": row.ip_address,
            "details": row.metadata_json or {},
        }
        for row in rows
    ]
