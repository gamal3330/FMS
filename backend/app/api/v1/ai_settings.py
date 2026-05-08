from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import require_roles
from app.db.session import get_db
from app.models.ai import AIHealthCheck, AIPromptTemplate
from app.models.audit import AuditLog
from app.models.enums import UserRole
from app.models.user import User
from app.schemas.ai import (
    AIAuditLogRead,
    AIConnectionTestResponse,
    AIFeaturePermissionsPayload,
    AIHealthCheckRead,
    AIPromptTemplatePayload,
    AIPromptTemplateRead,
    AIPromptTemplateTestRequest,
    AISettingsRead,
    AISettingsUpdate,
    AITestGenerationRequest,
    AITestMaskingRequest,
    AITestMaskingResponse,
    AIUsageLogRead,
    AIUsageSummaryRead,
)
from app.services.ai_privacy_service import mask_ai_sensitive_text
from app.services.ai_provider_service import generate_text, test_provider_connection
from app.services.ai_service import ai_settings_read, get_or_create_ai_settings
from app.services.ai_settings_service import (
    feature_permissions_payload,
    list_prompt_templates,
    save_ai_settings,
    update_feature_permissions,
)
from app.services.ai_usage_service import ai_usage_dashboard, log_ai_usage
from app.services.audit import write_audit

router = APIRouter(prefix="/settings/ai", tags=["AI Settings"])

AIViewActor = Depends(require_roles(UserRole.IT_MANAGER))
AIEditActor = Depends(require_roles(UserRole.SUPER_ADMIN))


def usage_log_read(row) -> AIUsageLogRead:
    return AIUsageLogRead(
        id=row.id,
        user_id=row.user_id,
        user_name=row.user.full_name_ar if row.user else None,
        feature=row.feature,
        feature_code=row.feature_code or row.feature,
        entity_type=row.entity_type,
        entity_id=row.entity_id,
        input_length=row.input_length,
        output_length=row.output_length,
        latency_ms=row.latency_ms or 0,
        status=row.status,
        error_message=row.error_message,
        created_at=row.created_at,
    )


@router.get("", response_model=AISettingsRead)
def get_ai_settings(db: Session = Depends(get_db), _: User = AIViewActor):
    item = get_or_create_ai_settings(db)
    db.commit()
    db.refresh(item)
    return ai_settings_read(item)


@router.put("", response_model=AISettingsRead)
def update_ai_settings(payload: AISettingsUpdate, request: Request, db: Session = Depends(get_db), actor: User = AIEditActor):
    item = get_or_create_ai_settings(db)
    before = ai_settings_read(item)
    save_ai_settings(db, item, payload.model_dump())
    after = ai_settings_read(item)
    write_audit(
        db,
        "ai_settings_updated",
        "ai_settings",
        actor=actor,
        entity_id=str(item.id),
        ip_address=request.client.host if request.client else None,
        metadata={
            "old_value": {key: before.get(key) for key in ["is_enabled", "mode", "provider", "model_name"]},
            "new_value": {key: after.get(key) for key in ["is_enabled", "mode", "provider", "model_name"]},
        },
    )
    db.commit()
    db.refresh(item)
    return ai_settings_read(item)


@router.get("/features")
def get_ai_features(db: Session = Depends(get_db), _: User = AIViewActor):
    payload = feature_permissions_payload(db)
    db.commit()
    return payload


@router.put("/features")
def update_ai_features(payload: AIFeaturePermissionsPayload, request: Request, db: Session = Depends(get_db), actor: User = AIEditActor):
    result = update_feature_permissions(db, [item.model_dump() for item in payload.items])
    write_audit(
        db,
        "ai_permissions_updated",
        "ai_feature_permissions",
        actor=actor,
        ip_address=request.client.host if request.client else None,
        metadata={"items_count": len(payload.items)},
    )
    db.commit()
    return result


@router.get("/prompt-templates", response_model=list[AIPromptTemplateRead])
def get_prompt_templates(db: Session = Depends(get_db), _: User = AIViewActor):
    rows = list_prompt_templates(db)
    db.commit()
    return rows


@router.post("/prompt-templates", response_model=AIPromptTemplateRead)
def create_prompt_template(payload: AIPromptTemplatePayload, request: Request, db: Session = Depends(get_db), actor: User = AIEditActor):
    existing = db.scalar(select(AIPromptTemplate).where(AIPromptTemplate.code == payload.code))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="يوجد قالب بنفس الرمز")
    item = AIPromptTemplate(**payload.model_dump(), created_by=actor.id)
    db.add(item)
    db.flush()
    write_audit(
        db,
        "ai_prompt_template_created",
        "ai_prompt_template",
        actor=actor,
        entity_id=str(item.id),
        ip_address=request.client.host if request.client else None,
        metadata={"code": item.code},
    )
    db.commit()
    db.refresh(item)
    return item


@router.put("/prompt-templates/{template_id}", response_model=AIPromptTemplateRead)
def update_prompt_template(template_id: int, payload: AIPromptTemplatePayload, request: Request, db: Session = Depends(get_db), actor: User = AIEditActor):
    item = db.get(AIPromptTemplate, template_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="القالب غير موجود")
    before = {"code": item.code, "version": item.version_number, "is_active": item.is_active}
    for field, value in payload.model_dump().items():
        setattr(item, field, value)
    write_audit(
        db,
        "ai_prompt_template_updated",
        "ai_prompt_template",
        actor=actor,
        entity_id=str(item.id),
        ip_address=request.client.host if request.client else None,
        metadata={"old_value": before, "new_value": {"code": item.code, "version": item.version_number, "is_active": item.is_active}},
    )
    db.commit()
    db.refresh(item)
    return item


@router.post("/prompt-templates/{template_id}/activate", response_model=AIPromptTemplateRead)
def activate_prompt_template(template_id: int, request: Request, db: Session = Depends(get_db), actor: User = AIEditActor):
    item = db.get(AIPromptTemplate, template_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="القالب غير موجود")
    item.is_active = True
    write_audit(
        db,
        "ai_prompt_template_activated",
        "ai_prompt_template",
        actor=actor,
        entity_id=str(item.id),
        ip_address=request.client.host if request.client else None,
        metadata={"code": item.code},
    )
    db.commit()
    db.refresh(item)
    return item


@router.post("/prompt-templates/{template_id}/test", response_model=AIConnectionTestResponse)
def test_prompt_template(template_id: int, payload: AIPromptTemplateTestRequest, db: Session = Depends(get_db), actor: User = AIEditActor):
    item = db.get(AIPromptTemplate, template_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="القالب غير موجود")
    settings = get_or_create_ai_settings(db)
    prompt = item.prompt_text
    sample = payload.sample_data
    for placeholder in ["text", "instruction", "request_context", "request_type"]:
        prompt = prompt.replace("{" + placeholder + "}", sample)
    try:
        output, latency_ms = generate_text(settings, mask_ai_sensitive_text(prompt, settings), max_tokens=500)
        log_ai_usage(db, actor.id, f"template_test:{item.code}", len(prompt), len(output), latency_ms)
        db.commit()
        return AIConnectionTestResponse(ok=True, message="تم اختبار القالب بنجاح.", sample=output[:1000])
    except HTTPException as exc:
        log_ai_usage(db, actor.id, f"template_test:{item.code}", len(prompt), 0, 0, "failed", error_message=str(exc.detail))
        db.commit()
        return AIConnectionTestResponse(ok=False, message=str(exc.detail), sample=None)


@router.post("/test-connection", response_model=AIConnectionTestResponse)
def test_ai_connection(db: Session = Depends(get_db), actor: User = AIEditActor):
    settings = get_or_create_ai_settings(db)
    try:
        health = test_provider_connection(db, settings)
        log_ai_usage(db, actor.id, "test_connection", 0, len(health.message or ""), health.latency_ms)
        db.commit()
        return AIConnectionTestResponse(ok=True, message="تم الاتصال بمزود الذكاء الاصطناعي بنجاح.", sample=health.message)
    except HTTPException as exc:
        log_ai_usage(db, actor.id, "test_connection", 0, 0, 0, "failed", error_message=str(exc.detail))
        db.commit()
        return AIConnectionTestResponse(ok=False, message=str(exc.detail), sample=None)


@router.post("/test-generation", response_model=AIConnectionTestResponse)
def test_ai_generation(payload: AITestGenerationRequest, db: Session = Depends(get_db), actor: User = AIEditActor):
    settings = get_or_create_ai_settings(db)
    prompt = mask_ai_sensitive_text(payload.prompt, settings)
    try:
        output, latency_ms = generate_text(settings, prompt, max_tokens=payload.max_tokens, temperature=payload.temperature)
        log_ai_usage(db, actor.id, "test_generation", len(prompt), len(output), latency_ms)
        db.commit()
        return AIConnectionTestResponse(ok=True, message="تم توليد النص بنجاح.", sample=output)
    except HTTPException as exc:
        log_ai_usage(db, actor.id, "test_generation", len(prompt), 0, 0, "failed", error_message=str(exc.detail))
        db.commit()
        return AIConnectionTestResponse(ok=False, message=str(exc.detail), sample=None)


@router.post("/test-masking", response_model=AITestMaskingResponse)
def test_ai_masking(payload: AITestMaskingRequest, db: Session = Depends(get_db), _: User = AIViewActor):
    settings = get_or_create_ai_settings(db)
    return AITestMaskingResponse(input_text=payload.text, output_text=mask_ai_sensitive_text(payload.text, settings))


@router.get("/usage-logs", response_model=AIUsageSummaryRead)
def get_ai_usage_logs(db: Session = Depends(get_db), _: User = AIViewActor):
    summary = ai_usage_dashboard(db)
    return AIUsageSummaryRead(
        usage_today=summary["usage_today"],
        usage_last_7_days=summary["usage_last_7_days"],
        most_used_feature=summary["most_used_feature"],
        top_users=summary["top_users"],
        average_latency_ms=summary["average_latency_ms"],
        errors_count=summary["errors_count"],
        model_status=summary["model_status"],
        logs=[usage_log_read(row) for row in summary["logs"]],
    )


@router.get("/health", response_model=AIHealthCheckRead)
def get_ai_health(db: Session = Depends(get_db), _: User = AIViewActor):
    latest = db.scalar(select(AIHealthCheck).order_by(AIHealthCheck.checked_at.desc()).limit(1))
    settings = get_or_create_ai_settings(db)
    if not latest:
        return AIHealthCheckRead(provider=settings.provider or "local_ollama", model_name=settings.model_name or "-", status="unknown", latency_ms=0, message="لم يتم اختبار الاتصال بعد", checked_at=None)
    return AIHealthCheckRead(
        provider=latest.provider,
        model_name=latest.model_name,
        status=latest.status,
        latency_ms=latest.latency_ms,
        message=latest.message,
        checked_at=latest.checked_at,
    )


@router.get("/audit-logs", response_model=list[AIAuditLogRead])
def get_ai_audit_logs(db: Session = Depends(get_db), _: User = AIViewActor):
    rows = db.scalars(
        select(AuditLog)
        .options(selectinload(AuditLog.actor))
        .where(AuditLog.entity_type.in_(["ai_settings", "ai_feature_permissions", "ai_prompt_template"]))
        .order_by(AuditLog.created_at.desc())
        .limit(200)
    ).all()
    return [
        AIAuditLogRead(
            id=row.id,
            action=row.action,
            user_name=row.actor.full_name_ar if row.actor else None,
            ip_address=row.ip_address,
            old_value=str((row.metadata_json or {}).get("old_value") or "")[:1000] or None,
            new_value=str((row.metadata_json or {}).get("new_value") or "")[:1000] or None,
            metadata=row.metadata_json or {},
            created_at=row.created_at,
        )
        for row in rows
    ]
