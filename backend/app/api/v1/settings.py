from datetime import datetime
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tempfile
import zipfile

from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, oauth2_scheme, require_roles
from app.core.config import get_settings
from app.core.security import decode_access_token
from app.db.init_db import seed_database
from app.db.session import Base, SessionLocal, engine, get_db
from app.models.enums import UserRole
from app.models.settings import (
    IntegrationConfig,
    NotificationSettings,
    PortalSetting,
    RequestTypeConfig,
    RequestTypeSetting,
    SecurityPolicy,
    SettingsDepartment,
    SettingsGeneral,
    SpecializedSection,
    SlaConfig,
    SlaRule,
    WorkflowApprovalConfig,
    WorkflowStep,
    WorkflowTemplate,
)
from app.models.user import User
from app.schemas.settings import (
    BackupSettingsPayload,
    BackupSettingsRead,
    IntegrationConfigPayload,
    IntegrationConfigRead,
    NotificationSettingsPayload,
    NotificationSettingsRead,
    PortalSettingPayload,
    PortalSettingRead,
    RequestTypeConfigPayload,
    RequestTypeConfigRead,
    SecurityPolicyPayload,
    SecurityPolicyRead,
    SettingsGeneralPayload,
    SettingsGeneralRead,
    SettingsDepartmentCreate,
    SettingsDepartmentRead,
    SpecializedSectionPayload,
    SpecializedSectionRead,
    SlaConfigPayload,
    SlaConfigRead,
    WorkflowApprovalPayload,
    WorkflowApprovalRead,
)
from app.services.audit import write_audit
from app.services.update_manager import ensure_current_version, normalize_version, version_key

router = APIRouter(prefix="/settings", tags=["Settings"])
workflows_router = APIRouter(prefix="/workflows", tags=["Workflow Settings"])
request_types_router = APIRouter(prefix="/request-types", tags=["Request Type Settings"])
sla_rules_router = APIRouter(prefix="/sla-rules", tags=["SLA Settings"])
SettingsActor = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.IT_MANAGER))
settings = get_settings()
BACKUP_SETTINGS_CATEGORY = "database"
BACKUP_SETTINGS_KEY = "backup_settings"
DEFAULT_BACKUP_SETTINGS = BackupSettingsPayload().model_dump()
LOCAL_UPDATES_DIR = (Path.cwd() / settings.upload_dir / "local_updates").resolve()
LOCAL_UPDATE_MAX_BYTES = 1024 * 1024 * 1024
LOCAL_UPDATE_REQUIRED_ROOTS = {"backend", "frontend", "scripts", "updates"}
PROJECT_ROOT = Path.cwd().parent if Path.cwd().name == "backend" else Path.cwd()
LOCAL_UPDATE_PRESERVE_NAMES = {
    "backend": {".env", ".env.example", ".venv", ".venv-mac", ".venv312", "qib_local.db", "uploads", "backups", "uvicorn.err.log", "uvicorn.out.log"},
    "frontend": {"node_modules", "dist", ".env", ".env.local"},
    "scripts": set(),
    "updates": {"releases"},
}
LOCAL_UPDATE_ROOT_FILES = {"version.txt", "update-manifest.json", "README.md", "INSTALL.md", "docker-compose.yml"}


def database_reset_plan() -> list[dict[str, int | str]]:
    plan = []
    with engine.connect() as connection:
        for table in reversed(Base.metadata.sorted_tables):
            count = connection.execute(text(f'SELECT COUNT(*) FROM "{table.name}"')).scalar_one()
            plan.append({"table": table.name, "rows": int(count or 0)})
    return plan


def require_super_admin_token(token: str = Depends(oauth2_scheme)) -> dict:
    try:
      payload = decode_access_token(token)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials") from exc
    if payload.get("role") != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only Super Admin can run database maintenance")
    return payload


def sqlite_database_path() -> Path:
    url = make_url(settings.database_url)
    if url.drivername != "sqlite":
        raise HTTPException(status_code=409, detail="النسخ الاحتياطي والاسترداد من هذه الشاشة متاحان فقط عند استخدام SQLite")
    database = url.database
    if not database:
        raise HTTPException(status_code=409, detail="SQLite database path is not configured")
    path = Path(database)
    return path if path.is_absolute() else Path.cwd() / path


def validate_sqlite_backup(path: Path) -> None:
    try:
        connection = sqlite3.connect(path)
        try:
            result = connection.execute("PRAGMA integrity_check").fetchone()
            if not result or result[0] != "ok":
                raise HTTPException(status_code=400, detail="Backup file failed integrity check")
            tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
            required = {"users", "departments", "service_requests"}
            if not required.issubset(tables):
                raise HTTPException(status_code=400, detail="Backup file does not match this system database")
        finally:
            connection.close()
    except sqlite3.Error as exc:
        raise HTTPException(status_code=400, detail="Uploaded file is not a valid SQLite backup") from exc


def reseed_database() -> None:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed_database(db)
    finally:
        db.close()


def get_or_create_singleton(db: Session, model):
    item = db.scalar(select(model).limit(1))
    if not item:
        item = model()
        db.add(item)
        db.flush()
    return item


def logo_upload_dir() -> Path:
    path = Path(settings.upload_dir) / "logos"
    path.mkdir(parents=True, exist_ok=True)
    return path


def logo_url(filename: str) -> str:
    return f"{settings.api_v1_prefix}/settings/logo/{filename}"


def local_updates_dir() -> Path:
    LOCAL_UPDATES_DIR.mkdir(parents=True, exist_ok=True)
    return LOCAL_UPDATES_DIR


def display_path(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(PROJECT_ROOT.resolve()))
    except ValueError:
        return str(path.resolve())


def local_update_metadata_path(package_path: Path) -> Path:
    return package_path.with_suffix(".json")


def safe_zip_member_name(name: str) -> bool:
    path = Path(name)
    return not path.is_absolute() and ".." not in path.parts and bool(path.parts)


def read_zip_text(zipped: zipfile.ZipFile, name: str, limit: int = 64 * 1024) -> str | None:
    try:
        with zipped.open(name) as stream:
            content = stream.read(limit + 1)
    except KeyError:
        return None
    if len(content) > limit:
        return None
    return content.decode("utf-8", errors="replace").strip()


def analyze_local_update_zip(path: Path) -> dict:
    try:
        with zipfile.ZipFile(path) as zipped:
            entries = [item for item in zipped.infolist() if not item.is_dir()]
            if not entries:
                raise HTTPException(status_code=400, detail="ملف التحديث فارغ")

            unsafe_entries = [item.filename for item in entries if not safe_zip_member_name(item.filename)]
            if unsafe_entries:
                raise HTTPException(status_code=400, detail="ملف التحديث يحتوي على مسارات غير آمنة")

            roots = {Path(item.filename).parts[0] for item in entries if Path(item.filename).parts}
            missing_roots = sorted(LOCAL_UPDATE_REQUIRED_ROOTS - roots)
            total_uncompressed = sum(max(item.file_size, 0) for item in entries)

            manifest = None
            version = None
            manifest_text = read_zip_text(zipped, "update-manifest.json")
            if manifest_text:
                try:
                    manifest = json.loads(manifest_text)
                    version = manifest.get("version") or manifest.get("release")
                except json.JSONDecodeError:
                    raise HTTPException(status_code=400, detail="ملف update-manifest.json غير صالح")
            if not version:
                version = read_zip_text(zipped, "version.txt", limit=1024)
            if version:
                version = normalize_version(version)

            return {
                "valid": not missing_roots,
                "missing_roots": missing_roots,
                "roots": sorted(roots),
                "files_count": len(entries),
                "compressed_size_bytes": path.stat().st_size,
                "uncompressed_size_bytes": total_uncompressed,
                "version": version or "غير محدد",
                "manifest": manifest,
            }
    except zipfile.BadZipFile as exc:
        raise HTTPException(status_code=400, detail="الملف المرفوع ليس ملف ZIP صالح") from exc


def list_local_update_packages() -> list[dict]:
    packages = []
    for metadata_path in sorted(local_updates_dir().glob("*.json"), reverse=True):
        try:
            packages.append(json.loads(metadata_path.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError):
            continue
    return packages[:10]


def local_update_package_path(package_id: str) -> Path:
    safe_id = Path(package_id).name
    if safe_id != package_id:
        raise HTTPException(status_code=400, detail="معرف حزمة التحديث غير صالح")
    path = (local_updates_dir() / f"{safe_id}.zip").resolve()
    if not path.exists():
        raise HTTPException(status_code=404, detail="حزمة التحديث غير موجودة")
    return path


def add_preflight_check(checks: list[dict], name: str, passed: bool, message: str) -> None:
    checks.append({"name": name, "passed": passed, "message": message})


def run_local_update_preflight(package_path: Path, db: Session | None = None) -> dict:
    analysis = analyze_local_update_zip(package_path)
    checks: list[dict] = []
    warnings: list[str] = []
    current_version = None
    if db:
        current_version = ensure_current_version(db).version

    add_preflight_check(
        checks,
        "بنية الحزمة",
        analysis["valid"],
        "المجلدات الأساسية موجودة" if analysis["valid"] else f"المجلدات الناقصة: {', '.join(analysis['missing_roots'])}",
    )

    with tempfile.TemporaryDirectory(prefix="qib-update-preflight-") as temp:
        temp_path = Path(temp)
        with zipfile.ZipFile(package_path) as zipped:
            zipped.extractall(temp_path)

        def exists(relative_path: str) -> bool:
            return (temp_path / relative_path).exists()

        add_preflight_check(checks, "ملف نسخة التحديث", exists("version.txt") or exists("update-manifest.json"), "تم العثور على ملف تعريف النسخة" if exists("version.txt") or exists("update-manifest.json") else "يجب إضافة version.txt أو update-manifest.json")
        add_preflight_check(checks, "متطلبات الباكند", exists("backend/requirements.txt"), "backend/requirements.txt موجود" if exists("backend/requirements.txt") else "ملف backend/requirements.txt غير موجود")
        add_preflight_check(checks, "مدخل الباكند", exists("backend/app/main.py"), "backend/app/main.py موجود" if exists("backend/app/main.py") else "ملف backend/app/main.py غير موجود")
        add_preflight_check(checks, "ملف الواجهة", exists("frontend/package.json"), "frontend/package.json موجود" if exists("frontend/package.json") else "ملف frontend/package.json غير موجود")
        add_preflight_check(checks, "سكربتات التشغيل", exists("scripts/install-local.sh") or exists("scripts/install-local.ps1"), "تم العثور على سكربت تثبيت محلي" if exists("scripts/install-local.sh") or exists("scripts/install-local.ps1") else "يفضل وجود scripts/install-local.sh أو scripts/install-local.ps1")

        package_json_path = temp_path / "frontend/package.json"
        package_json_valid = False
        if package_json_path.exists():
            try:
                json.loads(package_json_path.read_text(encoding="utf-8"))
                package_json_valid = True
            except json.JSONDecodeError:
                package_json_valid = False
        add_preflight_check(checks, "صحة package.json", package_json_valid, "ملف package.json صالح" if package_json_valid else "ملف frontend/package.json غير صالح أو غير موجود")

        manifest_path = temp_path / "update-manifest.json"
        if manifest_path.exists():
            try:
                json.loads(manifest_path.read_text(encoding="utf-8"))
                add_preflight_check(checks, "صحة ملف التعريف", True, "update-manifest.json صالح")
            except json.JSONDecodeError:
                add_preflight_check(checks, "صحة ملف التعريف", False, "update-manifest.json غير صالح")

        add_preflight_check(checks, "مجلد تحديثات قاعدة البيانات", exists("updates/migrations"), "updates/migrations موجود" if exists("updates/migrations") else "يجب إرفاق مجلد updates/migrations مع الحزمة")

    disk_free = shutil.disk_usage(Path.cwd()).free
    required_space = int(analysis["uncompressed_size_bytes"] * 1.5)
    has_space = disk_free > required_space
    add_preflight_check(
        checks,
        "مساحة التخزين",
        has_space,
        f"المتاح {disk_free} بايت، والمطلوب التقريبي {required_space} بايت",
    )
    has_version = analysis["version"] != "غير محدد"
    add_preflight_check(
        checks,
        "رقم الإصدار",
        has_version,
        f"رقم الإصدار داخل الحزمة: {analysis['version']}" if has_version else "لم يتم تحديد رقم النسخة داخل الحزمة",
    )
    if current_version and has_version:
        is_newer = version_key(analysis["version"]) > version_key(current_version)
        add_preflight_check(
            checks,
            "تسلسل الإصدارات",
            is_newer,
            f"الحزمة أحدث من الإصدار الحالي {current_version}" if is_newer else f"الحزمة ليست أحدث من الإصدار الحالي {current_version}",
        )

    failed_checks = [check for check in checks if not check["passed"]]
    return {
        "package_id": package_path.stem,
        "ready": len(failed_checks) == 0,
        "checked_at": datetime.now().isoformat(),
        "version": analysis["version"],
        "files_count": analysis["files_count"],
        "compressed_size_bytes": analysis["compressed_size_bytes"],
        "uncompressed_size_bytes": analysis["uncompressed_size_bytes"],
        "checks": checks,
        "warnings": warnings,
        "summary": "الحزمة جاهزة للتطبيق" if not failed_checks else f"يوجد {len(failed_checks)} فحص لم ينجح",
    }


def copy_path(source: Path, destination: Path) -> None:
    if source.is_dir():
        shutil.copytree(source, destination)
    else:
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)


def backup_path_if_exists(path: Path, rollback_root: Path, relative_path: Path) -> str | None:
    if not path.exists():
        return None
    backup_path = rollback_root / relative_path
    if backup_path.exists():
        return display_path(backup_path)
    backup_path.parent.mkdir(parents=True, exist_ok=True)
    copy_path(path, backup_path)
    return display_path(backup_path)


def apply_update_directory(source_root: Path, target_root: Path, rollback_root: Path, preserve_names: set[str]) -> dict:
    target_root.mkdir(parents=True, exist_ok=True)
    copied: list[str] = []
    removed: list[str] = []
    backed_up: list[str] = []

    source_names = {item.name for item in source_root.iterdir()}
    for target_item in target_root.iterdir():
        if target_item.name in preserve_names:
            continue
        relative = target_item.relative_to(PROJECT_ROOT)
        backup = backup_path_if_exists(target_item, rollback_root, relative)
        if backup:
            backed_up.append(backup)
        if target_item.is_dir():
            shutil.rmtree(target_item)
        else:
            target_item.unlink()
        if target_item.name not in source_names:
            removed.append(str(relative))

    for source_item in source_root.iterdir():
        if source_item.name in preserve_names:
            continue
        target_item = target_root / source_item.name
        copy_path(source_item, target_item)
        copied.append(display_path(target_item))

    return {"copied": copied, "removed": removed, "backed_up": backed_up}


def apply_local_update_package(package_path: Path) -> dict:
    db = SessionLocal()
    try:
        preflight = run_local_update_preflight(package_path, db)
    finally:
        db.close()
    if not preflight["ready"]:
        raise HTTPException(status_code=409, detail="لا يمكن تطبيق التحديث قبل نجاح فحص قابلية التطبيق")

    rollback_root = local_updates_dir() / "rollbacks" / f"{package_path.stem}-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    rollback_root.mkdir(parents=True, exist_ok=True)
    backup_files: list[str] = []
    applied_roots: dict[str, dict] = {}

    try:
        database_path = sqlite_database_path()
    except HTTPException:
        database_path = None
    if database_path and database_path.exists():
        database_backup = rollback_root / "database" / database_path.name
        database_backup.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(database_path, database_backup)
        backup_files.append(display_path(database_backup))

    with tempfile.TemporaryDirectory(prefix="qib-update-apply-") as temp:
        temp_path = Path(temp)
        with zipfile.ZipFile(package_path) as zipped:
            zipped.extractall(temp_path)

        for root_name in sorted(LOCAL_UPDATE_REQUIRED_ROOTS):
            source_root = temp_path / root_name
            target_root = PROJECT_ROOT / root_name
            applied_roots[root_name] = apply_update_directory(source_root, target_root, rollback_root, LOCAL_UPDATE_PRESERVE_NAMES.get(root_name, set()))

        for filename in sorted(LOCAL_UPDATE_ROOT_FILES):
            source_file = temp_path / filename
            if not source_file.exists():
                continue
            target_file = PROJECT_ROOT / filename
            backup = backup_path_if_exists(target_file, rollback_root, Path(filename))
            if backup:
                backup_files.append(backup)
            copy_path(source_file, target_file)

    return {
        "package_id": package_path.stem,
        "applied": True,
        "applied_at": datetime.now().isoformat(),
        "version": preflight["version"],
        "rollback_path": display_path(rollback_root),
        "database_backup": backup_files[0] if backup_files else None,
        "backup_files": backup_files,
        "applied_roots": applied_roots,
        "restart_required": True,
        "migrations_required": True,
        "next_steps": ["إعادة تشغيل الباكند", "فتح إدارة التحديثات", "فحص التحديثات", "تنفيذ التحديث"],
        "message": "تم تطبيق ملفات التحديث. أعد تشغيل النظام ثم نفّذ تحديثات قاعدة البيانات من إدارة التحديثات.",
    }


def restart_backend_script_path() -> Path:
    return PROJECT_ROOT / "scripts" / "restart-backend.sh"


@router.get("/public-profile")
def get_public_profile(db: Session = Depends(get_db)):
    item = get_or_create_singleton(db, SettingsGeneral)
    db.commit()
    db.refresh(item)
    return {"system_name": item.system_name, "language": item.language, "timezone": item.timezone, "logo_url": item.logo_url, "brand_color": item.brand_color}


@router.get("/general-profile", response_model=SettingsGeneralRead)
def get_general_profile(db: Session = Depends(get_db), _: User = SettingsActor):
    item = get_or_create_singleton(db, SettingsGeneral)
    db.commit()
    db.refresh(item)
    return item


@router.put("/general-profile", response_model=SettingsGeneralRead)
def update_general_profile(payload: SettingsGeneralPayload, db: Session = Depends(get_db), actor: User = SettingsActor):
    item = get_or_create_singleton(db, SettingsGeneral)
    for field, value in payload.model_dump().items():
        setattr(item, field, value)
    write_audit(db, "general_settings_saved", "settings_general", actor=actor, entity_id=str(item.id))
    db.commit()
    db.refresh(item)
    return item


@router.post("/general-profile/logo", response_model=SettingsGeneralRead)
async def upload_system_logo(file: UploadFile = File(...), db: Session = Depends(get_db), actor: User = SettingsActor):
    allowed_types = {"image/png": ".png", "image/jpeg": ".jpg", "image/svg+xml": ".svg", "image/webp": ".webp"}
    suffix = allowed_types.get(file.content_type or "")
    if not suffix:
        raise HTTPException(status_code=400, detail="Logo must be PNG, JPG, SVG, or WEBP")
    content = await file.read()
    if len(content) > 2 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Logo file is too large")
    filename = f"{uuid4().hex}{suffix}"
    path = logo_upload_dir() / filename
    path.write_bytes(content)
    item = get_or_create_singleton(db, SettingsGeneral)
    item.logo_url = logo_url(filename)
    write_audit(db, "system_logo_uploaded", "settings_general", actor=actor, entity_id=str(item.id))
    db.commit()
    db.refresh(item)
    return item


@router.get("/logo/{filename}")
def get_system_logo(filename: str):
    path = logo_upload_dir() / Path(filename).name
    if not path.exists():
        raise HTTPException(status_code=404, detail="Logo not found")
    return FileResponse(path)


@router.get("/general", response_model=list[PortalSettingRead])
def list_general_settings(db: Session = Depends(get_db), _: User = SettingsActor):
    return db.scalars(select(PortalSetting).where(PortalSetting.category == "general").order_by(PortalSetting.setting_key)).all()


@router.put("/general/{setting_key}", response_model=PortalSettingRead)
def upsert_general_setting(setting_key: str, payload: PortalSettingPayload, db: Session = Depends(get_db), actor: User = SettingsActor):
    setting = db.scalar(select(PortalSetting).where(PortalSetting.category == "general", PortalSetting.setting_key == setting_key))
    if not setting:
        setting = PortalSetting(category="general", setting_key=setting_key, setting_value=payload.setting_value, updated_by_id=actor.id)
        db.add(setting)
    else:
        setting.setting_value = payload.setting_value
        setting.updated_by_id = actor.id
    db.flush()
    write_audit(db, "setting_saved", "portal_setting", actor=actor, entity_id=str(setting.id), metadata={"key": setting_key})
    db.commit()
    db.refresh(setting)
    return setting


@router.get("/departments", response_model=list[SettingsDepartmentRead])
def list_settings_departments(db: Session = Depends(get_db), _: User = SettingsActor, search: str | None = None):
    stmt = select(SettingsDepartment).order_by(SettingsDepartment.name_ar)
    if search:
        stmt = stmt.where(SettingsDepartment.name_ar.ilike(f"%{search}%") | SettingsDepartment.name_en.ilike(f"%{search}%") | SettingsDepartment.code.ilike(f"%{search}%"))
    return db.scalars(stmt).all()


@router.get("/specialized-sections", response_model=list[SpecializedSectionRead])
def list_specialized_sections(db: Session = Depends(get_db), _: User = SettingsActor, active_only: bool = False, search: str | None = None):
    stmt = select(SpecializedSection).order_by(SpecializedSection.name_ar)
    if active_only:
        stmt = stmt.where(SpecializedSection.is_active == True)
    if search:
        stmt = stmt.where(
            SpecializedSection.name_ar.ilike(f"%{search}%")
            | SpecializedSection.name_en.ilike(f"%{search}%")
            | SpecializedSection.code.ilike(f"%{search}%")
        )
    return db.scalars(stmt).all()


@router.post("/specialized-sections", response_model=SpecializedSectionRead, status_code=status.HTTP_201_CREATED)
def create_specialized_section(payload: SpecializedSectionPayload, db: Session = Depends(get_db), actor: User = SettingsActor):
    exists = db.scalar(select(SpecializedSection).where(SpecializedSection.code == payload.code))
    if exists:
        raise HTTPException(status_code=409, detail="رمز القسم المختص مستخدم من قبل")
    item = SpecializedSection(**payload.model_dump())
    db.add(item)
    db.flush()
    write_audit(db, "specialized_section_created", "specialized_section", actor=actor, entity_id=str(item.id), metadata={"code": item.code})
    db.commit()
    db.refresh(item)
    return item


@router.put("/specialized-sections/{section_id}", response_model=SpecializedSectionRead)
def update_specialized_section(section_id: int, payload: SpecializedSectionPayload, db: Session = Depends(get_db), actor: User = SettingsActor):
    item = db.get(SpecializedSection, section_id)
    if not item:
        raise HTTPException(status_code=404, detail="القسم المختص غير موجود")
    duplicate = db.scalar(select(SpecializedSection).where(SpecializedSection.code == payload.code, SpecializedSection.id != section_id))
    if duplicate:
        raise HTTPException(status_code=409, detail="رمز القسم المختص مستخدم من قبل")
    for field, value in payload.model_dump().items():
        setattr(item, field, value)
    write_audit(db, "specialized_section_updated", "specialized_section", actor=actor, entity_id=str(item.id), metadata={"code": item.code})
    db.commit()
    db.refresh(item)
    return item


@router.delete("/specialized-sections/{section_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_specialized_section(section_id: int, db: Session = Depends(get_db), actor: User = SettingsActor):
    item = db.get(SpecializedSection, section_id)
    if not item:
        raise HTTPException(status_code=404, detail="القسم المختص غير موجود")
    in_use = db.scalar(select(User).where(User.administrative_section == item.code).limit(1))
    if in_use:
        raise HTTPException(status_code=409, detail="لا يمكن حذف قسم مرتبط بمستخدمين. قم بتعطيله بدلاً من الحذف.")
    db.delete(item)
    write_audit(db, "specialized_section_deleted", "specialized_section", actor=actor, entity_id=str(section_id))
    db.commit()


@router.get("/notifications", response_model=NotificationSettingsRead)
def get_notification_settings(db: Session = Depends(get_db), _: User = SettingsActor):
    item = get_or_create_singleton(db, NotificationSettings)
    db.commit()
    db.refresh(item)
    return item


@router.put("/notifications", response_model=NotificationSettingsRead)
def update_notification_settings(payload: NotificationSettingsPayload, db: Session = Depends(get_db), actor: User = SettingsActor):
    item = get_or_create_singleton(db, NotificationSettings)
    for field, value in payload.model_dump().items():
        setattr(item, field, value)
    write_audit(db, "notification_settings_saved", "notification_settings", actor=actor, entity_id=str(item.id))
    db.commit()
    db.refresh(item)
    return item


@router.get("/security", response_model=SecurityPolicyRead)
def get_security_policy(db: Session = Depends(get_db), _: User = SettingsActor):
    item = get_or_create_singleton(db, SecurityPolicy)
    db.commit()
    db.refresh(item)
    return item


@router.put("/security", response_model=SecurityPolicyRead)
def update_security_policy(payload: SecurityPolicyPayload, db: Session = Depends(get_db), actor: User = SettingsActor):
    item = get_or_create_singleton(db, SecurityPolicy)
    for field, value in payload.model_dump().items():
        setattr(item, field, value)
    write_audit(db, "security_policy_saved", "security_policies", actor=actor, entity_id=str(item.id))
    db.commit()
    db.refresh(item)
    return item


@router.get("/database/status")
def get_database_status(_: User = SettingsActor):
    url = make_url(settings.database_url)
    if url.drivername != "sqlite":
        return {
            "engine": url.drivername.split("+", 1)[0].upper(),
            "database_name": url.database or "-",
            "database_path": url.host or "-",
            "exists": True,
            "size_bytes": 0,
            "updated_at": None,
            "maintenance_supported": False,
            "maintenance_message": "النسخ الاحتياطي والاسترداد من هذه الشاشة متاحان فقط لقواعد SQLite. عند استخدام PostgreSQL استخدم أوامر pg_dump أو نسخ Docker.",
        }

    database_path = sqlite_database_path()
    exists = database_path.exists()
    return {
        "engine": "SQLite",
        "database_name": database_path.name,
        "database_path": str(database_path),
        "exists": exists,
        "size_bytes": database_path.stat().st_size if exists else 0,
        "updated_at": datetime.fromtimestamp(database_path.stat().st_mtime).isoformat() if exists else None,
        "maintenance_supported": True,
        "maintenance_message": None,
    }


@router.get("/local-updates/status")
def get_local_updates_status(_: User = Depends(require_roles(UserRole.SUPER_ADMIN))):
    return {
        "required_roots": sorted(LOCAL_UPDATE_REQUIRED_ROOTS),
        "max_size_bytes": LOCAL_UPDATE_MAX_BYTES,
        "packages": list_local_update_packages(),
    }


@router.post("/local-updates/upload")
async def upload_local_update_package(file: UploadFile = File(...), db: Session = Depends(get_db), actor: User = Depends(require_roles(UserRole.SUPER_ADMIN))):
    filename = Path(file.filename or "").name
    if not filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="يجب رفع ملف تحديث بصيغة ZIP")

    update_dir = local_updates_dir()
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    package_id = f"{timestamp}-{uuid4().hex[:8]}"
    package_path = update_dir / f"{package_id}.zip"
    temp_path = update_dir / f"{package_id}.tmp"

    size = 0
    try:
        with temp_path.open("wb") as buffer:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > LOCAL_UPDATE_MAX_BYTES:
                    raise HTTPException(status_code=400, detail="ملف التحديث أكبر من الحد المسموح")
                buffer.write(chunk)

        analysis = analyze_local_update_zip(temp_path)
        if not analysis["valid"]:
            missing = "، ".join(analysis["missing_roots"])
            raise HTTPException(status_code=400, detail=f"ملف التحديث غير مكتمل. المجلدات الناقصة: {missing}")
        if analysis["version"] == "غير محدد":
            raise HTTPException(status_code=400, detail="يجب تحديد رقم الإصدار داخل version.txt أو update-manifest.json")
        current_version = ensure_current_version(db).version
        if version_key(analysis["version"]) <= version_key(current_version):
            raise HTTPException(status_code=409, detail=f"رقم إصدار الحزمة {analysis['version']} ليس أحدث من الإصدار الحالي {current_version}")

        temp_path.rename(package_path)
        metadata = {
            "id": package_id,
            "original_filename": filename,
            "stored_filename": package_path.name,
            "uploaded_at": datetime.now().isoformat(),
            "uploaded_by": actor.full_name_ar or actor.email,
            "status": "جاهز للفحص النهائي",
            **analysis,
        }
        local_update_metadata_path(package_path).write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
        write_audit(db, "local_update_uploaded", "system_update", actor=actor, metadata={"package_id": package_id, "filename": filename, "version": metadata["version"]})
        db.commit()
        return metadata
    finally:
        temp_path.unlink(missing_ok=True)


@router.post("/local-updates/{package_id}/preflight")
def preflight_local_update_package(package_id: str, db: Session = Depends(get_db), actor: User = Depends(require_roles(UserRole.SUPER_ADMIN))):
    package_path = local_update_package_path(package_id)
    result = run_local_update_preflight(package_path, db)

    metadata_path = local_update_metadata_path(package_path)
    if metadata_path.exists():
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            metadata = {"id": package_id, "stored_filename": package_path.name}
    else:
        metadata = {"id": package_id, "stored_filename": package_path.name}

    metadata["last_preflight"] = result
    metadata["status"] = "جاهز للتطبيق" if result["ready"] else "يحتاج معالجة قبل التطبيق"
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")

    write_audit(
        db,
        "local_update_preflight_checked",
        "system_update",
        actor=actor,
        metadata={"package_id": package_id, "ready": result["ready"], "summary": result["summary"]},
    )
    db.commit()
    return result


@router.post("/local-updates/{package_id}/apply")
def apply_local_update(package_id: str, db: Session = Depends(get_db), actor: User = Depends(require_roles(UserRole.SUPER_ADMIN))):
    package_path = local_update_package_path(package_id)
    result = apply_local_update_package(package_path)

    metadata_path = local_update_metadata_path(package_path)
    if metadata_path.exists():
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            metadata = {"id": package_id, "stored_filename": package_path.name}
    else:
        metadata = {"id": package_id, "stored_filename": package_path.name}

    metadata["last_apply"] = result
    metadata["status"] = "تم التطبيق - بانتظار إعادة التشغيل"
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")

    write_audit(
        db,
        "local_update_applied",
        "system_update",
        actor=actor,
        metadata={"package_id": package_id, "version": result["version"], "rollback_path": result["rollback_path"]},
    )
    db.commit()
    return result


@router.post("/local-updates/restart")
def restart_local_backend(db: Session = Depends(get_db), actor: User = Depends(require_roles(UserRole.SUPER_ADMIN))):
    script_path = restart_backend_script_path()
    if not script_path.exists():
        raise HTTPException(status_code=409, detail="سكريبت إعادة التشغيل غير موجود على هذا الخادم")

    env = os.environ.copy()
    env["PROJECT_ROOT"] = str(PROJECT_ROOT)
    env["CURRENT_BACKEND_PID"] = str(os.getpid())
    env.setdefault("BACKEND_PORT", "8000")

    try:
        subprocess.Popen(
            ["bash", str(script_path)],
            cwd=str(PROJECT_ROOT),
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    except OSError as exc:
        raise HTTPException(status_code=500, detail="تعذر تشغيل سكريبت إعادة التشغيل") from exc

    write_audit(db, "local_update_restart_requested", "system_update", actor=actor, metadata={"script": str(script_path)})
    db.commit()
    return {"message": "تم إرسال أمر إعادة التشغيل. انتظر عدة ثوان ثم حدّث الصفحة.", "restart_requested": True}


@router.get("/database/reset-preview")
def get_database_reset_preview(_: dict = Depends(require_super_admin_token)):
    tables = database_reset_plan()
    return {
        "tables": tables,
        "table_count": len(tables),
        "total_rows": sum(item["rows"] for item in tables),
    }


@router.get("/database/backup-settings", response_model=BackupSettingsRead)
def get_backup_settings(db: Session = Depends(get_db), _: User = SettingsActor):
    item = db.scalar(select(PortalSetting).where(PortalSetting.category == BACKUP_SETTINGS_CATEGORY, PortalSetting.setting_key == BACKUP_SETTINGS_KEY))
    if not item:
        return DEFAULT_BACKUP_SETTINGS
    return {**DEFAULT_BACKUP_SETTINGS, **(item.setting_value or {})}


@router.put("/database/backup-settings", response_model=BackupSettingsRead)
def update_backup_settings(payload: BackupSettingsPayload, db: Session = Depends(get_db), actor: User = SettingsActor):
    item = db.scalar(select(PortalSetting).where(PortalSetting.category == BACKUP_SETTINGS_CATEGORY, PortalSetting.setting_key == BACKUP_SETTINGS_KEY))
    if not item:
        item = PortalSetting(category=BACKUP_SETTINGS_CATEGORY, setting_key=BACKUP_SETTINGS_KEY, setting_value={})
        db.add(item)
    item.setting_value = payload.model_dump()
    item.updated_by_id = actor.id
    write_audit(db, "backup_settings_saved", "database", actor=actor, metadata=item.setting_value)
    db.commit()
    return item.setting_value


@router.get("/database/backup")
def download_database_backup(actor: User = Depends(require_roles(UserRole.SUPER_ADMIN))):
    database_path = sqlite_database_path()
    if not database_path.exists():
        raise HTTPException(status_code=404, detail="Database file not found")

    backup_dir = database_path.parent / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = backup_dir / f"{database_path.stem}-backup-{timestamp}{database_path.suffix}"
    shutil.copy2(database_path, backup_path)

    db = SessionLocal()
    try:
        write_audit(db, "database_backup_exported", "database", actor=actor, metadata={"filename": backup_path.name})
        db.commit()
    finally:
        db.close()

    return FileResponse(
        backup_path,
        media_type="application/octet-stream",
        filename=backup_path.name,
        headers={"Content-Disposition": f'attachment; filename="{backup_path.name}"'},
    )


@router.post("/database/restore")
async def restore_database_backup(
    confirmation: str = Form(...),
    file: UploadFile = File(...),
    _: dict = Depends(require_super_admin_token),
):
    if confirmation.strip() != "استرداد النسخة":
        raise HTTPException(status_code=400, detail="Confirmation text is invalid")

    database_path = sqlite_database_path()
    suffix = Path(file.filename or "backup.db").suffix or ".db"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
        temp_path = Path(temp_file.name)
        while chunk := await file.read(1024 * 1024):
            temp_file.write(chunk)

    try:
        validate_sqlite_backup(temp_path)
        engine.dispose()
        database_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(temp_path, database_path)
        reseed_database()
    finally:
        temp_path.unlink(missing_ok=True)

    return {"message": "Database backup restored successfully"}


@router.post("/database/reset")
def reset_database(payload: dict, _: dict = Depends(require_super_admin_token)):
    if payload.get("confirmation", "").strip() != "حذف جميع البيانات":
        raise HTTPException(status_code=400, detail="Confirmation text is invalid")

    if engine.dialect.name == "sqlite":
        with engine.begin() as connection:
            connection.execute(text("PRAGMA foreign_keys=OFF"))
            for table in reversed(Base.metadata.sorted_tables):
                connection.execute(table.delete())
            connection.execute(text("PRAGMA foreign_keys=ON"))
    else:
        with engine.begin() as connection:
            for table in reversed(Base.metadata.sorted_tables):
                connection.execute(table.delete())

    reseed_database()
    return {"message": "Database reset successfully"}


@workflows_router.get("")
def list_workflows(db: Session = Depends(get_db), _: User = SettingsActor):
    templates = db.scalars(select(WorkflowTemplate).order_by(WorkflowTemplate.request_type)).all()
    result = []
    for template in templates:
        steps = db.scalars(select(WorkflowStep).where(WorkflowStep.workflow_template_id == template.id).order_by(WorkflowStep.step_order)).all()
        result.append({"id": template.id, "request_type": template.request_type, "name": template.name, "is_active": template.is_active, "steps": steps})
    return result


@workflows_router.post("")
def save_workflow(payload: dict, db: Session = Depends(get_db), actor: User = SettingsActor):
    request_type = payload.get("request_type")
    if not request_type:
        raise HTTPException(status_code=422, detail="request_type is required")
    template = db.scalar(select(WorkflowTemplate).where(WorkflowTemplate.request_type == request_type))
    if not template:
        template = WorkflowTemplate(request_type=request_type, name=payload.get("name") or request_type, is_active=True)
        db.add(template)
        db.flush()
    else:
        template.name = payload.get("name") or template.name
        db.query(WorkflowStep).filter(WorkflowStep.workflow_template_id == template.id).delete()
        db.flush()
    for index, step in enumerate(payload.get("steps", []), start=1):
        db.add(
            WorkflowStep(
                workflow_template_id=template.id,
                step_order=step.get("step_order") or index,
                approver_role=step.get("approver_role"),
                is_mandatory=step.get("is_mandatory", True),
                sla_hours=step.get("sla_hours", 8),
            )
        )
    write_audit(db, "workflow_saved", "workflow_template", actor=actor, entity_id=str(template.id))
    db.commit()
    return {"id": template.id, "message": "Workflow saved"}


@request_types_router.get("")
def list_request_types(db: Session = Depends(get_db), _: User = SettingsActor):
    return db.scalars(select(RequestTypeSetting).order_by(RequestTypeSetting.label_ar)).all()


@request_types_router.post("")
def save_request_type(payload: dict, db: Session = Depends(get_db), actor: User = SettingsActor):
    request_type = payload.get("request_type")
    item = db.scalar(select(RequestTypeSetting).where(RequestTypeSetting.request_type == request_type))
    if not item:
        item = RequestTypeSetting(request_type=request_type, label_ar=payload.get("label_ar") or request_type)
        db.add(item)
    item.label_ar = payload.get("label_ar") or item.label_ar
    item.is_enabled = payload.get("is_enabled", item.is_enabled)
    item.require_attachment = payload.get("require_attachment", item.require_attachment)
    db.flush()
    write_audit(db, "request_type_saved", "request_types", actor=actor, entity_id=str(item.id))
    db.commit()
    db.refresh(item)
    return item


@sla_rules_router.get("")
def list_sla_rules(db: Session = Depends(get_db), _: User = SettingsActor):
    return db.scalars(select(SlaRule).order_by(SlaRule.request_type)).all()


@sla_rules_router.post("")
def create_sla_rule(payload: dict, db: Session = Depends(get_db), actor: User = SettingsActor):
    item = SlaRule(
        request_type=payload.get("request_type"),
        response_time_hours=payload.get("response_time_hours"),
        resolution_time_hours=payload.get("resolution_time_hours"),
        escalation_user_id=payload.get("escalation_user_id"),
    )
    db.add(item)
    db.flush()
    write_audit(db, "sla_rule_created", "sla_rules", actor=actor, entity_id=str(item.id))
    db.commit()
    db.refresh(item)
    return item


@router.post("/departments", response_model=SettingsDepartmentRead, status_code=status.HTTP_201_CREATED)
def create_settings_department(payload: SettingsDepartmentCreate, db: Session = Depends(get_db), actor: User = SettingsActor):
    item = SettingsDepartment(**payload.model_dump())
    db.add(item)
    db.flush()
    write_audit(db, "settings_department_created", "settings_department", actor=actor, entity_id=str(item.id), metadata={"code": item.code})
    db.commit()
    db.refresh(item)
    return item


@router.put("/departments/{department_id}", response_model=SettingsDepartmentRead)
def update_settings_department(department_id: int, payload: SettingsDepartmentCreate, db: Session = Depends(get_db), actor: User = SettingsActor):
    item = db.get(SettingsDepartment, department_id)
    if not item:
        raise HTTPException(status_code=404, detail="Department not found")
    for field, value in payload.model_dump().items():
        setattr(item, field, value)
    write_audit(db, "settings_department_updated", "settings_department", actor=actor, entity_id=str(item.id))
    db.commit()
    db.refresh(item)
    return item


@router.delete("/departments/{department_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_settings_department(department_id: int, db: Session = Depends(get_db), actor: User = SettingsActor):
    item = db.get(SettingsDepartment, department_id)
    if not item:
        raise HTTPException(status_code=404, detail="Department not found")
    db.delete(item)
    write_audit(db, "settings_department_deleted", "settings_department", actor=actor, entity_id=str(department_id))
    db.commit()


@router.get("/workflow-approvals", response_model=list[WorkflowApprovalRead])
def list_workflow_approvals(db: Session = Depends(get_db), _: User = SettingsActor, request_type: str | None = None):
    stmt = select(WorkflowApprovalConfig).order_by(WorkflowApprovalConfig.request_type, WorkflowApprovalConfig.step_order)
    if request_type:
        stmt = stmt.where(WorkflowApprovalConfig.request_type == request_type)
    return db.scalars(stmt).all()


@router.post("/workflow-approvals", response_model=WorkflowApprovalRead, status_code=status.HTTP_201_CREATED)
def create_workflow_approval(payload: WorkflowApprovalPayload, db: Session = Depends(get_db), actor: User = SettingsActor):
    item = WorkflowApprovalConfig(**payload.model_dump())
    db.add(item)
    db.flush()
    write_audit(db, "workflow_step_created", "workflow_approval_config", actor=actor, entity_id=str(item.id))
    db.commit()
    db.refresh(item)
    return item


@router.delete("/workflow-approvals/{step_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workflow_approval(step_id: int, db: Session = Depends(get_db), actor: User = SettingsActor):
    item = db.get(WorkflowApprovalConfig, step_id)
    if not item:
        raise HTTPException(status_code=404, detail="Workflow step not found")
    db.delete(item)
    write_audit(db, "workflow_step_deleted", "workflow_approval_config", actor=actor, entity_id=str(step_id))
    db.commit()


@router.get("/request-types", response_model=list[RequestTypeConfigRead])
def list_request_type_configs(db: Session = Depends(get_db), _: User = SettingsActor):
    return db.scalars(select(RequestTypeConfig).order_by(RequestTypeConfig.label_ar)).all()


@router.post("/request-types", response_model=RequestTypeConfigRead, status_code=status.HTTP_201_CREATED)
def create_request_type_config(payload: RequestTypeConfigPayload, db: Session = Depends(get_db), actor: User = SettingsActor):
    item = RequestTypeConfig(**payload.model_dump())
    db.add(item)
    db.flush()
    write_audit(db, "request_type_config_created", "request_type_config", actor=actor, entity_id=str(item.id))
    db.commit()
    db.refresh(item)
    return item


@router.get("/sla", response_model=list[SlaConfigRead])
def list_sla_configs(db: Session = Depends(get_db), _: User = SettingsActor):
    return db.scalars(select(SlaConfig).order_by(SlaConfig.request_type)).all()


@router.post("/sla", response_model=SlaConfigRead, status_code=status.HTTP_201_CREATED)
def create_sla_config(payload: SlaConfigPayload, db: Session = Depends(get_db), actor: User = SettingsActor):
    item = SlaConfig(**payload.model_dump())
    db.add(item)
    db.flush()
    write_audit(db, "sla_config_created", "sla_config", actor=actor, entity_id=str(item.id))
    db.commit()
    db.refresh(item)
    return item


@router.get("/integrations", response_model=list[IntegrationConfigRead])
def list_integrations(db: Session = Depends(get_db), _: User = SettingsActor):
    return db.scalars(select(IntegrationConfig).order_by(IntegrationConfig.integration_name)).all()


@router.put("/integrations/{integration_name}", response_model=IntegrationConfigRead)
def upsert_integration(integration_name: str, payload: IntegrationConfigPayload, db: Session = Depends(get_db), actor: User = SettingsActor):
    item = db.scalar(select(IntegrationConfig).where(IntegrationConfig.integration_name == integration_name))
    if not item:
        item = IntegrationConfig(integration_name=integration_name, is_enabled=payload.is_enabled, settings_json=payload.settings_json, notes=payload.notes)
        db.add(item)
    else:
        item.is_enabled = payload.is_enabled
        item.settings_json = payload.settings_json
        item.notes = payload.notes
    db.flush()
    write_audit(db, "integration_config_saved", "integration_config", actor=actor, entity_id=str(item.id), metadata={"name": integration_name})
    db.commit()
    db.refresh(item)
    return item
