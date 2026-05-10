from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.ai import AIFeaturePermission, AIPromptTemplate, AISettings
from app.models.enums import UserRole
from app.models.user import Role, User
from app.schemas.ai import AI_FEATURE_CODES
from app.services.ai_service import DEFAULT_PROMPTS, PROMPT_ALIASES, ai_settings_read, encrypt_api_key, ensure_prompt_templates, get_or_create_ai_settings


FEATURE_LABELS = {
    "draft_message": "توليد مسودة",
    "improve_message": "تحسين الصياغة",
    "formalize_message": "جعلها رسمية",
    "shorten_message": "اختصار النص",
    "suggest_reply": "اقتراح رد",
    "summarize_message": "تلخيص رسالة",
    "summarize_request_messages": "تلخيص مراسلات طلب",
    "detect_missing_info": "فحص المعلومات الناقصة",
    "translate_ar_en": "ترجمة عربي/إنجليزي",
}

ROLE_DEFAULTS = {
    UserRole.EMPLOYEE: {"draft_message", "improve_message", "formalize_message", "shorten_message", "detect_missing_info"},
    UserRole.DIRECT_MANAGER: {"draft_message", "improve_message", "formalize_message", "shorten_message", "suggest_reply", "summarize_message", "detect_missing_info"},
    UserRole.IT_STAFF: {"draft_message", "improve_message", "formalize_message", "shorten_message", "suggest_reply", "summarize_message", "summarize_request_messages", "detect_missing_info"},
    UserRole.DEPARTMENT_MANAGER: set(AI_FEATURE_CODES),
    UserRole.INFOSEC: {"draft_message", "improve_message", "formalize_message", "shorten_message", "suggest_reply", "summarize_message", "detect_missing_info"},
    UserRole.EXECUTIVE: {"improve_message", "formalize_message", "shorten_message", "suggest_reply", "summarize_message", "summarize_request_messages"},
    UserRole.SUPER_ADMIN: set(AI_FEATURE_CODES),
}


def save_ai_settings(db: Session, item: AISettings, payload: dict) -> AISettings:
    api_key = payload.pop("api_key", None)
    for field, value in payload.items():
        if hasattr(item, field):
            setattr(item, field, value)
    item.is_enabled = bool(item.is_enabled and item.mode != "disabled")
    if item.is_enabled and item.mode == "disabled":
        item.mode = "enabled"
    if api_key and api_key.strip():
        item.api_key_encrypted = encrypt_api_key(api_key.strip())
    db.flush()
    return item


def get_ai_settings_payload(db: Session) -> dict:
    item = get_or_create_ai_settings(db)
    return ai_settings_read(item)


def ensure_ai_feature_permissions(db: Session) -> list[AIFeaturePermission]:
    roles = db.scalars(select(Role).where(Role.is_active == True).order_by(Role.id)).all()
    existing = {
        (permission.role_id, permission.feature_code): permission
        for permission in db.scalars(select(AIFeaturePermission)).all()
    }
    created: list[AIFeaturePermission] = []
    for role in roles:
        try:
            role_enum = UserRole(role.name)
        except ValueError:
            role_enum = None
        defaults = ROLE_DEFAULTS.get(role_enum, set())
        for feature_code in sorted(AI_FEATURE_CODES):
            key = (role.id, feature_code)
            if key in existing:
                continue
            permission = AIFeaturePermission(
                role_id=role.id,
                feature_code=feature_code,
                is_enabled=feature_code in defaults,
                daily_limit=50 if role.name in {"administration_manager", "super_admin"} else 20,
                monthly_limit=1500 if role.name in {"administration_manager", "super_admin"} else 500,
            )
            db.add(permission)
            created.append(permission)
    if created:
        db.flush()
    return db.scalars(select(AIFeaturePermission).options(selectinload(AIFeaturePermission.role)).order_by(AIFeaturePermission.role_id, AIFeaturePermission.feature_code)).all()


def feature_permissions_payload(db: Session) -> dict:
    rows = ensure_ai_feature_permissions(db)
    return {
        "features": [{"code": code, "label": FEATURE_LABELS.get(code, code)} for code in sorted(AI_FEATURE_CODES)],
        "items": [
            {
                "role_id": row.role_id,
                "role_name": row.role.name if row.role else "-",
                "role_label_ar": row.role.label_ar if row.role else "-",
                "feature_code": row.feature_code,
                "is_enabled": bool(row.is_enabled),
                "daily_limit": row.daily_limit,
                "monthly_limit": row.monthly_limit,
            }
            for row in rows
        ],
    }


def update_feature_permissions(db: Session, items: list[dict]) -> dict:
    ensure_ai_feature_permissions(db)
    existing = {
        (permission.role_id, permission.feature_code): permission
        for permission in db.scalars(select(AIFeaturePermission)).all()
    }
    for item in items:
        role_id = int(item["role_id"])
        feature_code = item["feature_code"]
        if feature_code not in AI_FEATURE_CODES:
            continue
        permission = existing.get((role_id, feature_code))
        if not permission:
            permission = AIFeaturePermission(role_id=role_id, feature_code=feature_code)
            db.add(permission)
        permission.is_enabled = bool(item.get("is_enabled"))
        permission.daily_limit = int(item.get("daily_limit") or 0)
        permission.monthly_limit = int(item.get("monthly_limit") or 0)
    db.flush()
    return feature_permissions_payload(db)


def can_user_use_ai_feature(db: Session, user: User, feature_code: str) -> bool:
    if user.role == UserRole.SUPER_ADMIN:
        return True
    role = db.scalar(select(Role).where(Role.name == user.role))
    if not role:
        return False
    permission = db.scalar(select(AIFeaturePermission).where(AIFeaturePermission.role_id == role.id, AIFeaturePermission.feature_code == feature_code))
    if not permission:
        return feature_code in ROLE_DEFAULTS.get(user.role, set())
    return bool(permission.is_enabled)


def list_prompt_templates(db: Session) -> list[AIPromptTemplate]:
    ensure_prompt_templates(db)
    alias_codes = set(PROMPT_ALIASES.keys())
    canonical_codes = set(DEFAULT_PROMPTS.keys()) - alias_codes
    rows = db.scalars(select(AIPromptTemplate).order_by(AIPromptTemplate.code, AIPromptTemplate.version_number.desc())).all()
    return [row for row in rows if row.code in canonical_codes or row.code not in alias_codes]
