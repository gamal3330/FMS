from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, Request, status
from fastapi.exceptions import HTTPException
from sqlalchemy import select
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.security import create_access_token, get_password_hash, verify_password
from app.db.session import get_db
from app.models.settings import SecurityPolicy, SettingsGeneral
from app.models.user import User, UserLoginAttempt, UserSession
from app.schemas.auth import ChangePasswordRequest, LoginRequest, TokenResponse
from app.schemas.user import UserRead
from app.services.audit import write_audit

router = APIRouter(prefix="/auth", tags=["Authentication"])


def get_singleton(db: Session, model):
    item = db.scalar(select(model).limit(1))
    if not item:
        item = model()
        db.add(item)
        db.flush()
    return item


def is_locked(user: User) -> bool:
    if not user.locked_until:
        return False
    locked_until = user.locked_until
    if locked_until.tzinfo is None:
        locked_until = locked_until.replace(tzinfo=timezone.utc)
    return locked_until > datetime.now(timezone.utc)


def password_expired(user: User, policy: SecurityPolicy) -> bool:
    changed_at = user.password_changed_at or user.created_at
    if changed_at.tzinfo is None:
        changed_at = changed_at.replace(tzinfo=timezone.utc)
    return changed_at + timedelta(days=policy.password_expiry_days) < datetime.now(timezone.utc)


def validate_password_policy(password: str, policy: SecurityPolicy) -> None:
    if len(password) < policy.password_min_length:
        raise HTTPException(status_code=422, detail=f"كلمة المرور يجب ألا تقل عن {policy.password_min_length} أحرف")
    if policy.require_uppercase and not any(char.isupper() for char in password):
        raise HTTPException(status_code=422, detail="كلمة المرور يجب أن تحتوي على حرف كبير")
    if policy.require_numbers and not any(char.isdigit() for char in password):
        raise HTTPException(status_code=422, detail="كلمة المرور يجب أن تحتوي على رقم")
    if policy.require_special_chars and not any(not char.isalnum() for char in password):
        raise HTTPException(status_code=422, detail="كلمة المرور يجب أن تحتوي على رمز خاص")


def find_login_user(db: Session, identifier: str, policy: SecurityPolicy) -> User | None:
    clean_identifier = identifier.strip()
    mode = policy.login_identifier_mode or "email_or_employee_id"
    if mode == "email":
        return db.scalar(select(User).where(User.email == clean_identifier.lower()))
    if mode == "employee_id":
        return db.scalar(select(User).where(User.employee_id == clean_identifier))
    return db.scalar(
        select(User).where(
            or_(
                User.email == clean_identifier.lower(),
                User.employee_id == clean_identifier,
            )
        )
    )


def login_identifier_error(policy: SecurityPolicy) -> str:
    mode = policy.login_identifier_mode or "email_or_employee_id"
    if mode == "employee_id":
        return "الرقم الوظيفي أو كلمة المرور غير صحيحة"
    if mode == "email":
        return "البريد الإلكتروني أو كلمة المرور غير صحيحة"
    return "البريد الإلكتروني أو الرقم الوظيفي أو كلمة المرور غير صحيحة"


def request_user_agent(request: Request) -> str | None:
    value = request.headers.get("user-agent")
    return value[:255] if value else None


def record_login_attempt(
    db: Session,
    *,
    identifier: str,
    user: User | None,
    ip_address: str | None,
    user_agent: str | None,
    success: bool,
    failure_reason: str | None = None,
) -> None:
    db.add(
        UserLoginAttempt(
            email_or_username=identifier,
            user_id=user.id if user else None,
            ip_address=ip_address,
            user_agent=user_agent,
            success=success,
            failure_reason=failure_reason,
        )
    )


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)) -> TokenResponse:
    policy = get_singleton(db, SecurityPolicy)
    general = get_singleton(db, SettingsGeneral)
    identifier = payload.email.strip()
    user = find_login_user(db, identifier, policy)
    ip_address = request.client.host if request.client else None
    user_agent = request_user_agent(request)
    invalid_login_message = login_identifier_error(policy)

    if user and not user.is_active:
        record_login_attempt(db, identifier=identifier, user=user, ip_address=ip_address, user_agent=user_agent, success=False, failure_reason="inactive_account")
        write_audit(db, "login_blocked", "user", actor=user, entity_id=str(user.id), metadata={"identifier": identifier}, ip_address=ip_address, user_agent=user_agent)
        db.commit()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="الحساب غير نشط. يرجى التواصل مع مدير النظام")

    if user and (user.is_locked or is_locked(user)):
        record_login_attempt(db, identifier=identifier, user=user, ip_address=ip_address, user_agent=user_agent, success=False, failure_reason="locked_account")
        write_audit(db, "login_blocked_locked", "user", actor=user, entity_id=str(user.id), metadata={"identifier": identifier}, ip_address=ip_address, user_agent=user_agent)
        db.commit()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="تم قفل الحساب مؤقتاً بسبب تجاوز عدد محاولات الدخول الفاشلة")

    if not user:
        record_login_attempt(db, identifier=identifier, user=None, ip_address=ip_address, user_agent=user_agent, success=False, failure_reason="user_not_found")
        write_audit(db, "login_failed", "user", metadata={"identifier": identifier}, ip_address=ip_address, user_agent=user_agent)
        db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=invalid_login_message)

    if not verify_password(payload.password, user.hashed_password):
        user.failed_login_attempts = (user.failed_login_attempts or 0) + 1
        if user.failed_login_attempts >= policy.lock_after_failed_attempts:
            user.locked_until = datetime.now(timezone.utc) + timedelta(minutes=30)
            user.is_locked = True
            record_login_attempt(db, identifier=identifier, user=user, ip_address=ip_address, user_agent=user_agent, success=False, failure_reason="locked_after_failures")
            write_audit(
                db,
                "login_locked_after_failures",
                "user",
                actor=user,
                entity_id=str(user.id),
                metadata={"identifier": identifier, "failed_login_attempts": user.failed_login_attempts},
                ip_address=ip_address,
                user_agent=user_agent,
            )
            db.commit()
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="تم قفل الحساب مؤقتاً بسبب تجاوز عدد محاولات الدخول الفاشلة")

        remaining = max(policy.lock_after_failed_attempts - user.failed_login_attempts, 0)
        record_login_attempt(db, identifier=identifier, user=user, ip_address=ip_address, user_agent=user_agent, success=False, failure_reason="invalid_password")
        write_audit(
            db,
            "login_failed",
            "user",
            actor=user,
            entity_id=str(user.id),
            metadata={"identifier": identifier, "failed_login_attempts": user.failed_login_attempts},
            ip_address=ip_address,
            user_agent=user_agent,
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"{invalid_login_message}. المحاولات المتبقية: {remaining}")

    if password_expired(user, policy):
        record_login_attempt(db, identifier=identifier, user=user, ip_address=ip_address, user_agent=user_agent, success=False, failure_reason="password_expired")
        write_audit(db, "login_password_expired", "user", actor=user, entity_id=str(user.id), metadata={"identifier": identifier}, ip_address=ip_address, user_agent=user_agent)
        db.commit()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="انتهت صلاحية كلمة المرور. يرجى تغيير كلمة المرور")

    user.failed_login_attempts = 0
    user.locked_until = None
    user.is_locked = False
    user.last_login_at = datetime.now(timezone.utc)
    token_id = uuid4().hex
    token = create_access_token(str(user.id), {"role": user.role, "email": user.email, "jti": token_id}, expires_minutes=general.session_timeout_minutes)
    db.add(UserSession(user_id=user.id, token_id=token_id, ip_address=ip_address, user_agent=user_agent, last_activity_at=datetime.now(timezone.utc), is_active=True))
    record_login_attempt(db, identifier=identifier, user=user, ip_address=ip_address, user_agent=user_agent, success=True)
    write_audit(db, "login_success", "user", actor=user, entity_id=str(user.id), metadata={"identifier": identifier}, ip_address=ip_address, user_agent=user_agent)
    db.commit()
    return TokenResponse(access_token=token)


@router.get("/me", response_model=UserRead)
def me(current_user: User = Depends(get_current_user)) -> User:
    return current_user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ip_address = request.client.host if request.client else None
    user_agent = request_user_agent(request)
    session = db.scalar(
        select(UserSession)
        .where(
            UserSession.user_id == current_user.id,
            UserSession.ip_address == ip_address,
            UserSession.user_agent == user_agent,
            UserSession.is_active == True,
            UserSession.revoked_at.is_(None),
        )
        .order_by(UserSession.login_at.desc())
        .limit(1)
    )
    if session:
        session.is_active = False
        session.revoked_at = datetime.now(timezone.utc)
    write_audit(db, "logout", "user", actor=current_user, entity_id=str(current_user.id), ip_address=ip_address, user_agent=request_user_agent(request))
    db.commit()


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(payload: ChangePasswordRequest, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ip_address = request.client.host if request.client else None
    if not verify_password(payload.current_password, current_user.hashed_password):
        write_audit(db, "change_password_failed", "user", actor=current_user, entity_id=str(current_user.id), ip_address=ip_address)
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="كلمة المرور الحالية غير صحيحة")
    if payload.new_password != payload.confirm_password:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="كلمة المرور الجديدة وتأكيدها غير متطابقين")
    if verify_password(payload.new_password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="كلمة المرور الجديدة يجب أن تختلف عن الحالية")
    validate_password_policy(payload.new_password, get_singleton(db, SecurityPolicy))
    current_user.hashed_password = get_password_hash(payload.new_password)
    current_user.password_changed_at = datetime.now(timezone.utc)
    current_user.force_password_change = False
    current_user.failed_login_attempts = 0
    current_user.locked_until = None
    write_audit(db, "password_changed", "user", actor=current_user, entity_id=str(current_user.id), ip_address=ip_address)
    db.commit()
