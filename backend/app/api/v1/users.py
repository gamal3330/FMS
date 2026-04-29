from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.core.security import get_password_hash
from app.db.session import get_db
from app.models.enums import UserRole
from app.models.settings import PortalSetting, SecurityPolicy, SpecializedSection
from app.models.user import Department, User
from app.schemas.settings import SettingsDepartmentCreate
from app.schemas.user import DepartmentRead, PasswordReset, UserCreate, UserRead, UserUpdate
from app.services.audit import write_audit

router = APIRouter(prefix="/users", tags=["Users"])


SCREEN_DEFINITIONS = [
    {"key": "dashboard", "label": "إحصائيات"},
    {"key": "requests", "label": "الطلبات"},
    {"key": "approvals", "label": "الموافقات"},
    {"key": "reports", "label": "التقارير"},
    {"key": "request_types", "label": "إدارة أنواع الطلبات"},
    {"key": "users", "label": "المستخدمون والصلاحيات"},
    {"key": "departments", "label": "الإدارات"},
    {"key": "specialized_sections", "label": "الأقسام المختصة"},
    {"key": "health_monitoring", "label": "مراقبة صحة النظام"},
    {"key": "settings", "label": "الإعدادات"},
]

ALL_SCREEN_KEYS = {item["key"] for item in SCREEN_DEFINITIONS}
MANAGEMENT_SCREEN_KEYS = {"dashboard", "requests", "approvals", "reports", "request_types", "users", "departments", "specialized_sections", "health_monitoring", "settings"}
EMPLOYEE_SCREEN_KEYS = {"dashboard", "requests", "approvals"}


class ScreenPermissionsPayload(BaseModel):
    screens: list[str]


class ScreenPermissionsRead(BaseModel):
    screens: list[str]
    available_screens: list[dict[str, str]]


def default_screens_for_role(role: UserRole) -> list[str]:
    if role in {UserRole.SUPER_ADMIN, UserRole.IT_MANAGER}:
        return sorted(MANAGEMENT_SCREEN_KEYS)
    if role in {UserRole.EXECUTIVE, UserRole.INFOSEC, UserRole.IT_STAFF}:
        return ["dashboard", "requests", "approvals", "reports"]
    return sorted(EMPLOYEE_SCREEN_KEYS)


def get_screen_permission_setting(db: Session, user_id: int) -> PortalSetting | None:
    return db.scalar(select(PortalSetting).where(PortalSetting.category == "screen_permissions", PortalSetting.setting_key == str(user_id)))


def read_user_screens(db: Session, user: User) -> list[str]:
    setting = get_screen_permission_setting(db, user.id)
    if not setting:
        return default_screens_for_role(user.role)
    screens = setting.setting_value.get("screens", []) if isinstance(setting.setting_value, dict) else []
    clean_screens = [screen for screen in screens if screen in ALL_SCREEN_KEYS]
    if user.role in {UserRole.SUPER_ADMIN, UserRole.IT_MANAGER} and "settings" in clean_screens and "health_monitoring" not in clean_screens:
        clean_screens.append("health_monitoring")
    return clean_screens


def save_user_screens(db: Session, user: User, screens: list[str], actor: User) -> None:
    clean_screens = sorted({screen for screen in screens if screen in ALL_SCREEN_KEYS})
    setting = get_screen_permission_setting(db, user.id)
    if not setting:
        setting = PortalSetting(category="screen_permissions", setting_key=str(user.id), setting_value={})
        db.add(setting)
    setting.setting_value = {"screens": clean_screens}
    setting.updated_by_id = actor.id


def validate_user_links(db: Session, payload: UserCreate | UserUpdate, user_id: int | None = None) -> None:
    if payload.department_id and not db.get(Department, payload.department_id):
        raise HTTPException(status_code=400, detail="Department not found")
    if payload.manager_id:
        if user_id and payload.manager_id == user_id:
            raise HTTPException(status_code=400, detail="User cannot be their own direct manager")
        manager = db.get(User, payload.manager_id)
        if not manager or not manager.is_active:
            raise HTTPException(status_code=400, detail="Direct manager not found or inactive")
        if manager.role not in {UserRole.DIRECT_MANAGER, UserRole.IT_MANAGER, UserRole.SUPER_ADMIN, UserRole.EXECUTIVE}:
            raise HTTPException(status_code=400, detail="Direct manager must have a manager-level role")
        if payload.department_id and manager.role == UserRole.DIRECT_MANAGER and manager.department_id != payload.department_id:
            raise HTTPException(status_code=400, detail="Direct manager must belong to the same department")
    if payload.role == UserRole.IT_STAFF and not payload.administrative_section:
        raise HTTPException(status_code=400, detail="Administrative section is required for IT staff")
    if payload.administrative_section:
        section = db.scalar(select(SpecializedSection).where(SpecializedSection.code == payload.administrative_section, SpecializedSection.is_active == True))
        if not section:
            raise HTTPException(status_code=400, detail="القسم المختص غير موجود أو غير نشط")


def ensure_role_assignment_allowed(actor: User, role: UserRole) -> None:
    if actor.role != UserRole.SUPER_ADMIN and role == UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Only Super Admin can assign Super Admin role")


def ensure_user_unique(db: Session, payload: UserCreate | UserUpdate, user_id: int | None = None) -> None:
    conditions = [User.employee_id == payload.employee_id, User.email == str(payload.email)]
    if payload.username:
        conditions.append(User.username == payload.username)
    stmt = select(User).where(or_(*conditions))
    if user_id:
        stmt = stmt.where(User.id != user_id)
    duplicate = db.scalar(stmt)
    if not duplicate:
        return
    if duplicate.employee_id == payload.employee_id:
        raise HTTPException(status_code=409, detail="الرقم الوظيفي مستخدم من قبل")
    if duplicate.email == str(payload.email):
        raise HTTPException(status_code=409, detail="البريد الإلكتروني مستخدم من قبل")
    if payload.username and duplicate.username == payload.username:
        raise HTTPException(status_code=409, detail="اسم المستخدم مستخدم من قبل")


def security_policy(db: Session) -> SecurityPolicy:
    item = db.scalar(select(SecurityPolicy).limit(1))
    if not item:
        item = SecurityPolicy()
        db.add(item)
        db.flush()
    return item


def validate_password_policy(password: str, policy: SecurityPolicy) -> None:
    if len(password) < policy.password_min_length:
        raise HTTPException(status_code=422, detail=f"كلمة المرور يجب ألا تقل عن {policy.password_min_length} أحرف")
    if policy.require_uppercase and not any(char.isupper() for char in password):
        raise HTTPException(status_code=422, detail="كلمة المرور يجب أن تحتوي على حرف كبير")
    if policy.require_numbers and not any(char.isdigit() for char in password):
        raise HTTPException(status_code=422, detail="كلمة المرور يجب أن تحتوي على رقم")
    if policy.require_special_chars and not any(not char.isalnum() for char in password):
        raise HTTPException(status_code=422, detail="كلمة المرور يجب أن تحتوي على رمز خاص")


@router.get("", response_model=list[UserRead])
def list_users(db: Session = Depends(get_db), _: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.IT_MANAGER))):
    return db.scalars(select(User).order_by(User.full_name_ar)).all()


@router.get("/screen-permissions/me", response_model=ScreenPermissionsRead)
def my_screen_permissions(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return {"screens": read_user_screens(db, current_user), "available_screens": SCREEN_DEFINITIONS}


@router.get("/{user_id}/screen-permissions", response_model=ScreenPermissionsRead)
def get_user_screen_permissions(user_id: int, db: Session = Depends(get_db), _: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.IT_MANAGER))):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {"screens": read_user_screens(db, user), "available_screens": SCREEN_DEFINITIONS}


@router.put("/{user_id}/screen-permissions", response_model=ScreenPermissionsRead)
def update_user_screen_permissions(user_id: int, payload: ScreenPermissionsPayload, db: Session = Depends(get_db), actor: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.IT_MANAGER))):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if actor.role != UserRole.SUPER_ADMIN and user.role == UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Only Super Admin can update Super Admin permissions")
    save_user_screens(db, user, payload.screens, actor)
    write_audit(db, "user_screen_permissions_updated", "user", actor=actor, entity_id=str(user.id), metadata={"screens": payload.screens})
    db.commit()
    return {"screens": read_user_screens(db, user), "available_screens": SCREEN_DEFINITIONS}


@router.post("", response_model=UserRead)
def create_user(payload: UserCreate, db: Session = Depends(get_db), actor: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.IT_MANAGER))):
    ensure_role_assignment_allowed(actor, payload.role)
    validate_user_links(db, payload)
    ensure_user_unique(db, payload)
    validate_password_policy(payload.password, security_policy(db))
    user = User(
        employee_id=payload.employee_id,
        username=payload.username,
        full_name_ar=payload.full_name_ar,
        full_name_en=payload.full_name_en,
        email=str(payload.email),
        mobile=payload.mobile,
        hashed_password=get_password_hash(payload.password),
        password_changed_at=datetime.now(timezone.utc),
        role=payload.role,
        administrative_section=payload.administrative_section if payload.role == UserRole.IT_STAFF else None,
        department_id=payload.department_id,
        manager_id=payload.manager_id,
    )
    db.add(user)
    db.flush()
    write_audit(db, "user_created", "user", actor=actor, entity_id=str(user.id), metadata={"email": user.email})
    db.commit()
    db.refresh(user)
    return user


@router.put("/{user_id}", response_model=UserRead)
def update_user(user_id: int, payload: UserUpdate, db: Session = Depends(get_db), actor: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.IT_MANAGER))):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if actor.role != UserRole.SUPER_ADMIN and user.role == UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Only Super Admin can update Super Admin users")
    ensure_role_assignment_allowed(actor, payload.role)
    validate_user_links(db, payload, user_id=user_id)
    ensure_user_unique(db, payload, user_id=user_id)
    payload_data = payload.model_dump()
    if payload.role != UserRole.IT_STAFF:
        payload_data["administrative_section"] = None
    for field, value in payload_data.items():
        if field == "email":
            value = str(value)
        setattr(user, field, value)
    write_audit(db, "user_updated", "user", actor=actor, entity_id=str(user.id))
    db.commit()
    db.refresh(user)
    return user


@router.post("/{user_id}/disable", response_model=UserRead)
def disable_user(user_id: int, db: Session = Depends(get_db), actor: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.IT_MANAGER))):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if actor.role != UserRole.SUPER_ADMIN and user.role == UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Only Super Admin can disable Super Admin users")
    user.is_active = False
    write_audit(db, "user_disabled", "user", actor=actor, entity_id=str(user.id))
    db.commit()
    db.refresh(user)
    return user


@router.post("/{user_id}/reset-password", status_code=status.HTTP_204_NO_CONTENT)
def reset_user_password(user_id: int, payload: PasswordReset, db: Session = Depends(get_db), actor: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.IT_MANAGER))):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if actor.role != UserRole.SUPER_ADMIN and user.role == UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Only Super Admin can reset Super Admin passwords")
    validate_password_policy(payload.password, security_policy(db))
    user.hashed_password = get_password_hash(payload.password)
    user.password_changed_at = datetime.now(timezone.utc)
    user.failed_login_attempts = 0
    user.locked_until = None
    write_audit(db, "user_password_reset", "user", actor=actor, entity_id=str(user.id))
    db.commit()


departments_router = APIRouter(prefix="/departments", tags=["Departments"])


@departments_router.get("", response_model=list[DepartmentRead])
def list_departments(db: Session = Depends(get_db), _: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.IT_MANAGER)), search: str | None = Query(default=None)):
    stmt = select(Department).order_by(Department.name_ar)
    if search:
        stmt = stmt.where(Department.name_ar.ilike(f"%{search}%") | Department.name_en.ilike(f"%{search}%"))
    return db.scalars(stmt).all()


@departments_router.post("", response_model=DepartmentRead, status_code=status.HTTP_201_CREATED)
def create_department(payload: SettingsDepartmentCreate, db: Session = Depends(get_db), actor: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.IT_MANAGER))):
    department = Department(
        name_ar=payload.name_ar,
        name_en=payload.name_en,
        code=payload.code,
        manager_id=payload.manager_id,
        is_active=payload.is_active,
    )
    db.add(department)
    db.flush()
    write_audit(db, "department_created", "department", actor=actor, entity_id=str(department.id))
    db.commit()
    db.refresh(department)
    return department


@departments_router.put("/{department_id}", response_model=DepartmentRead)
def update_department(department_id: int, payload: SettingsDepartmentCreate, db: Session = Depends(get_db), actor: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.IT_MANAGER))):
    department = db.get(Department, department_id)
    if not department:
        raise HTTPException(status_code=404, detail="Department not found")
    for field, value in payload.model_dump().items():
        setattr(department, field, value)
    write_audit(db, "department_updated", "department", actor=actor, entity_id=str(department.id))
    db.commit()
    db.refresh(department)
    return department


@departments_router.delete("/{department_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_department(department_id: int, db: Session = Depends(get_db), actor: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.IT_MANAGER))):
    department = db.get(Department, department_id)
    if not department:
        raise HTTPException(status_code=404, detail="Department not found")
    db.delete(department)
    write_audit(db, "department_deleted", "department", actor=actor, entity_id=str(department_id))
    db.commit()
