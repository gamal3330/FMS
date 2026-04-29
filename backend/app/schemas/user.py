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
    role: UserRole
    administrative_section: str | None = None
    department_id: int | None = None
    manager_id: int | None = None
    department: DepartmentRead | None = None
    failed_login_attempts: int = 0
    locked_until: datetime | None = None
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class UserCreate(BaseModel):
    employee_id: str
    username: str | None = None
    full_name_ar: str
    full_name_en: str
    email: EmailStr
    password: str
    role: UserRole
    administrative_section: str | None = None
    department_id: int | None = None
    manager_id: int | None = None
    mobile: str | None = None


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
    is_active: bool = True


class PasswordReset(BaseModel):
    password: str
