from datetime import datetime
from pydantic import BaseModel, EmailStr

from app.models.enums import UserRole


class DepartmentRead(BaseModel):
    id: int
    name_ar: str
    name_en: str
    code: str | None = None
    manager_id: int | None = None
    is_active: bool = True

    model_config = {"from_attributes": True}


class UserRead(BaseModel):
    id: int
    employee_id: str
    username: str | None = None
    full_name_ar: str
    full_name_en: str
    email: EmailStr
    mobile: str | None = None
    job_title: str | None = None
    role: UserRole
    role_id: int | None = None
    administrative_section: str | None = None
    specialized_section_id: int | None = None
    relationship_type: str | None = None
    department_id: int | None = None
    manager_id: int | None = None
    department: DepartmentRead | None = None
    failed_login_attempts: int = 0
    locked_until: datetime | None = None
    password_expires_at: datetime | None = None
    last_login_at: datetime | None = None
    is_locked: bool = False
    force_password_change: bool = False
    allowed_login_from_ip: str | None = None
    notes: str | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class UserCreate(BaseModel):
    employee_id: str
    username: str | None = None
    full_name_ar: str
    full_name_en: str
    email: EmailStr
    password: str | None = None
    role: UserRole
    administrative_section: str | None = None
    department_id: int | None = None
    manager_id: int | None = None
    mobile: str | None = None
    job_title: str | None = None
    relationship_type: str | None = "employee"
    role_id: int | None = None
    specialized_section_id: int | None = None
    force_password_change: bool = True
    password_expires_at: datetime | None = None
    allowed_login_from_ip: str | None = None
    notes: str | None = None


class UserUpdate(BaseModel):
    employee_id: str
    username: str | None = None
    full_name_ar: str
    full_name_en: str
    email: EmailStr
    role: UserRole
    administrative_section: str | None = None
    department_id: int | None = None
    manager_id: int | None = None
    mobile: str | None = None
    job_title: str | None = None
    relationship_type: str | None = "employee"
    role_id: int | None = None
    specialized_section_id: int | None = None
    force_password_change: bool = False
    password_expires_at: datetime | None = None
    allowed_login_from_ip: str | None = None
    notes: str | None = None
    is_active: bool = True


class PasswordReset(BaseModel):
    password: str | None = None
    admin_password: str | None = None
