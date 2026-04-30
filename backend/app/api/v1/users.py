from datetime import datetime, timezone
from io import BytesIO

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from openpyxl import Workbook, load_workbook
from pydantic import BaseModel, ValidationError
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


IMPORT_COLUMNS = [
    ("employee_id", "الرقم الوظيفي", True),
    ("username", "اسم المستخدم", False),
    ("full_name_ar", "الاسم العربي", True),
    ("full_name_en", "الاسم الإنجليزي", True),
    ("email", "البريد الإلكتروني", True),
    ("mobile", "رقم الجوال", False),
    ("role", "الصلاحية", True),
    ("department_code", "كود الإدارة", True),
    ("manager_employee_id", "الرقم الوظيفي للمدير المباشر", False),
    ("administrative_section", "كود القسم المختص", False),
    ("password", "كلمة المرور المؤقتة", False),
    ("is_active", "حساب نشط", False),
]
IMPORT_HEADER_ALIASES = {key: key for key, _, _ in IMPORT_COLUMNS} | {label: key for key, label, _ in IMPORT_COLUMNS}
DEFAULT_IMPORTED_PASSWORD = "Change@12345"


def cell_text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value)).strip()
    return str(value).strip()


def parse_bool(value, default: bool = True) -> bool:
    text = cell_text(value).lower()
    if not text:
        return default
    if text in {"1", "true", "yes", "y", "active", "نشط", "نعم"}:
        return True
    if text in {"0", "false", "no", "n", "inactive", "disabled", "معطل", "لا"}:
        return False
    raise ValueError("قيمة حالة الحساب يجب أن تكون نعم/لا أو true/false")


def import_error(row: int, field: str, message: str) -> dict[str, str | int]:
    return {"row": row, "field": field, "message": message}


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


@router.get("/import-template")
def download_users_import_template(db: Session = Depends(get_db), _: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.IT_MANAGER))):
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "users"
    sheet.append([label for _, label, _ in IMPORT_COLUMNS])
    sheet.append([
        "1001",
        "sample.user",
        "مستخدم تجريبي",
        "Sample User",
        "sample.user@example.com",
        "555000000",
        UserRole.EMPLOYEE.value,
        "IT",
        "",
        "",
        DEFAULT_IMPORTED_PASSWORD,
        "نعم",
    ])

    notes = workbook.create_sheet("instructions")
    notes.append(["الحقل", "إلزامي", "ملاحظات"])
    notes.append(["الصلاحية", "نعم", "استخدم إحدى القيم من ورقة roles"])
    notes.append(["كود الإدارة", "نعم", "استخدم code من ورقة departments أو رقم id"])
    notes.append(["الرقم الوظيفي للمدير المباشر", "لا", "يمكن أن يشير إلى مستخدم موجود أو صف آخر داخل نفس الملف"])
    notes.append(["كود القسم المختص", "لموظف تقنية المعلومات فقط", "مطلوب عند role = it_staff، استخدم ورقة specialized_sections"])
    notes.append(["كلمة المرور المؤقتة", "لا", f"إذا تركت فارغة سيتم استخدام {DEFAULT_IMPORTED_PASSWORD}"])
    notes.append(["حساب نشط", "لا", "القيم المقبولة: نعم/لا أو true/false أو 1/0"])

    roles_sheet = workbook.create_sheet("roles")
    roles_sheet.append(["role"])
    for role in UserRole:
        roles_sheet.append([role.value])

    departments_sheet = workbook.create_sheet("departments")
    departments_sheet.append(["id", "code", "name_ar", "name_en"])
    for department in db.scalars(select(Department).order_by(Department.name_ar)).all():
        departments_sheet.append([department.id, department.code or "", department.name_ar, department.name_en])

    sections_sheet = workbook.create_sheet("specialized_sections")
    sections_sheet.append(["code", "name_ar", "name_en"])
    for section in db.scalars(select(SpecializedSection).where(SpecializedSection.is_active == True).order_by(SpecializedSection.name_ar)).all():
        sections_sheet.append([section.code, section.name_ar, section.name_en])

    buffer = BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="users-import-template.xlsx"'},
    )


@router.post("/import")
async def import_users_from_excel(file: UploadFile = File(...), db: Session = Depends(get_db), actor: User = Depends(require_roles(UserRole.SUPER_ADMIN, UserRole.IT_MANAGER))):
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(status_code=400, detail="يرجى رفع ملف Excel بصيغة .xlsx")

    try:
        workbook = load_workbook(BytesIO(await file.read()), data_only=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="تعذر قراءة ملف Excel") from exc

    sheet = workbook["users"] if "users" in workbook.sheetnames else workbook.active
    headers = [IMPORT_HEADER_ALIASES.get(cell_text(value), "") for value in next(sheet.iter_rows(min_row=1, max_row=1, values_only=True), [])]
    missing_headers = [label for key, label, required in IMPORT_COLUMNS if required and key not in headers]
    if missing_headers:
        raise HTTPException(status_code=400, detail=f"الأعمدة الإلزامية غير موجودة: {', '.join(missing_headers)}")

    rows: list[dict] = []
    errors: list[dict] = []
    departments = db.scalars(select(Department)).all()
    department_by_key = {}
    for department in departments:
        for key in [department.id, department.code, department.name_ar, department.name_en]:
            if key is not None and cell_text(key):
                department_by_key[cell_text(key).lower()] = department
    active_sections = {section.code for section in db.scalars(select(SpecializedSection).where(SpecializedSection.is_active == True)).all()}
    existing_users = db.scalars(select(User)).all()
    existing_by_employee = {user.employee_id: user for user in existing_users}
    existing_emails = {user.email.lower() for user in existing_users}
    existing_usernames = {user.username.lower() for user in existing_users if user.username}
    seen_employee_ids: set[str] = set()
    seen_emails: set[str] = set()
    seen_usernames: set[str] = set()
    policy = security_policy(db)

    for row_number, values in enumerate(sheet.iter_rows(min_row=2, values_only=True), start=2):
        if not any(cell_text(value) for value in values):
            continue
        row = {headers[index]: values[index] if index < len(values) else None for index in range(len(headers)) if headers[index]}
        employee_id = cell_text(row.get("employee_id"))
        username = cell_text(row.get("username")) or None
        email = cell_text(row.get("email")).lower()
        role_text = cell_text(row.get("role"))
        department_key = cell_text(row.get("department_code")).lower()
        password = cell_text(row.get("password")) or DEFAULT_IMPORTED_PASSWORD
        manager_employee_id = cell_text(row.get("manager_employee_id")) or None
        administrative_section = cell_text(row.get("administrative_section")) or None

        for key, label, required in IMPORT_COLUMNS:
            if required and not cell_text(row.get(key)):
                errors.append(import_error(row_number, label, "الحقل إلزامي"))

        department = department_by_key.get(department_key)
        if department_key and not department:
            errors.append(import_error(row_number, "كود الإدارة", "الإدارة غير موجودة"))

        try:
            role = UserRole(role_text)
        except ValueError:
            role = None
            errors.append(import_error(row_number, "الصلاحية", "الصلاحية غير صحيحة"))

        if role == UserRole.IT_STAFF and not administrative_section:
            errors.append(import_error(row_number, "كود القسم المختص", "القسم المختص مطلوب لموظف تقنية المعلومات"))
        if administrative_section and administrative_section not in active_sections:
            errors.append(import_error(row_number, "كود القسم المختص", "القسم المختص غير موجود أو غير نشط"))

        if employee_id:
            if employee_id in existing_by_employee or employee_id in seen_employee_ids:
                errors.append(import_error(row_number, "الرقم الوظيفي", "الرقم الوظيفي مكرر"))
            seen_employee_ids.add(employee_id)
        if email:
            if email in existing_emails or email in seen_emails:
                errors.append(import_error(row_number, "البريد الإلكتروني", "البريد الإلكتروني مكرر"))
            seen_emails.add(email)
        if username:
            username_key = username.lower()
            if username_key in existing_usernames or username_key in seen_usernames:
                errors.append(import_error(row_number, "اسم المستخدم", "اسم المستخدم مكرر"))
            seen_usernames.add(username_key)

        try:
            is_active = parse_bool(row.get("is_active"), default=True)
        except ValueError as exc:
            is_active = True
            errors.append(import_error(row_number, "حساب نشط", str(exc)))

        try:
            validate_password_policy(password, policy)
        except HTTPException as exc:
            errors.append(import_error(row_number, "كلمة المرور المؤقتة", str(exc.detail)))

        payload_data = {
            "employee_id": employee_id,
            "username": username,
            "full_name_ar": cell_text(row.get("full_name_ar")),
            "full_name_en": cell_text(row.get("full_name_en")),
            "email": email,
            "mobile": cell_text(row.get("mobile")) or None,
            "password": password,
            "role": role_text,
            "department_id": department.id if department else None,
            "manager_id": None,
            "administrative_section": administrative_section if role == UserRole.IT_STAFF else None,
        }
        try:
            payload = UserCreate.model_validate(payload_data)
            if role:
                ensure_role_assignment_allowed(actor, payload.role)
        except (ValidationError, HTTPException) as exc:
            message = str(exc.detail) if isinstance(exc, HTTPException) else "; ".join(error["msg"] for error in exc.errors())
            errors.append(import_error(row_number, "البيانات", message))
            payload = None

        rows.append({"row_number": row_number, "payload": payload, "manager_employee_id": manager_employee_id, "is_active": is_active})

    new_employee_ids = {item["payload"].employee_id for item in rows if item["payload"]}
    for item in rows:
        payload = item["payload"]
        manager_employee_id = item["manager_employee_id"]
        if not payload or not manager_employee_id:
            continue
        if manager_employee_id not in existing_by_employee and manager_employee_id not in new_employee_ids:
            errors.append(import_error(item["row_number"], "الرقم الوظيفي للمدير المباشر", "المدير غير موجود في النظام أو الملف"))

    if errors:
        raise HTTPException(status_code=422, detail={"message": "لم يتم إنشاء أي مستخدم بسبب وجود أخطاء في الملف", "errors": errors})

    created_users: list[User] = []
    created_by_employee: dict[str, User] = {}
    try:
        for item in rows:
            payload = item["payload"]
            if not payload:
                continue
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
                is_active=item["is_active"],
            )
            db.add(user)
            db.flush()
            created_users.append(user)
            created_by_employee[user.employee_id] = user

        all_managers = {**existing_by_employee, **created_by_employee}
        for item in rows:
            payload = item["payload"]
            manager_employee_id = item["manager_employee_id"]
            if not payload or not manager_employee_id:
                continue
            user = created_by_employee[payload.employee_id]
            manager = all_managers[manager_employee_id]
            payload_with_manager = UserCreate(
                **payload.model_dump(exclude={"manager_id"}),
                manager_id=manager.id,
            )
            validate_user_links(db, payload_with_manager, user_id=user.id)
            user.manager_id = manager.id

        for user in created_users:
            write_audit(db, "user_imported", "user", actor=actor, entity_id=str(user.id), metadata={"email": user.email})
        db.commit()
    except Exception:
        db.rollback()
        raise

    return {"created": len(created_users), "skipped": 0, "errors": []}


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
