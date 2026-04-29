from datetime import datetime
from pathlib import Path
import shutil
import sqlite3
import tempfile

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

router = APIRouter(prefix="/settings", tags=["Settings"])
workflows_router = APIRouter(prefix="/workflows", tags=["Workflow Settings"])
request_types_router = APIRouter(prefix="/request-types", tags=["Request Type Settings"])
sla_rules_router = APIRouter(prefix="/sla-rules", tags=["SLA Settings"])
SettingsActor = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.IT_MANAGER))
settings = get_settings()
BACKUP_SETTINGS_CATEGORY = "database"
BACKUP_SETTINGS_KEY = "backup_settings"
DEFAULT_BACKUP_SETTINGS = BackupSettingsPayload().model_dump()


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
        raise HTTPException(status_code=409, detail="Database maintenance is currently available for SQLite deployments only")
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


@router.get("/public-profile")
def get_public_profile(db: Session = Depends(get_db)):
    item = get_or_create_singleton(db, SettingsGeneral)
    db.commit()
    db.refresh(item)
    return {"system_name": item.system_name, "language": item.language, "logo_url": item.logo_url, "brand_color": item.brand_color}


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
    database_path = sqlite_database_path()
    exists = database_path.exists()
    return {
        "engine": "SQLite",
        "database_name": database_path.name,
        "database_path": str(database_path),
        "exists": exists,
        "size_bytes": database_path.stat().st_size if exists else 0,
        "updated_at": datetime.fromtimestamp(database_path.stat().st_mtime).isoformat() if exists else None,
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
