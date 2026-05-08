from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.message import InternalMessage
from app.models.ai import AIPromptTemplate
from app.models.user import User
from app.schemas.ai import (
    AIDraftRequest,
    AIDraftResponse,
    AIMissingInfoRequest,
    AIMissingInfoResponse,
    AISuggestReplyRequest,
    AISummarizeRequest,
    AISummaryResponse,
    AIStatusRead,
    AIPromptTemplateOption,
    AIRunTemplateRequest,
    AIRunTemplateResponse,
    AITextRequest,
    AITextResponse,
)
from app.services.ai_service import (
    PROMPT_ALIASES,
    get_or_create_ai_settings,
    generate_ai_text,
    load_message_for_ai,
    mask_sensitive_text,
    parse_draft_output,
    parse_missing_items,
    prompt_template,
    render_ai_prompt_template,
    request_context_text,
    resolve_request,
    strip_html,
    validate_ai_role_permission,
    visible_request_messages_text,
    ensure_prompt_templates,
)

router = APIRouter(prefix="/ai", tags=["AI Messaging Assistant"])


def template_output_kind(code: str) -> str:
    canonical = PROMPT_ALIASES.get(code, code)
    if canonical == "draft_message":
        return "draft"
    if canonical == "detect_missing_info":
        return "missing"
    return "text"


def template_feature(code: str) -> str:
    canonical = PROMPT_ALIASES.get(code, code)
    if canonical == "draft_message":
        return "draft"
    if canonical == "improve_message":
        return "improve"
    if canonical == "formalize_message":
        return "formalize"
    if canonical == "shorten_message":
        return "shorten"
    if canonical == "suggest_reply":
        return "suggest_reply"
    if canonical == "summarize_thread":
        return "summarize"
    if canonical == "detect_missing_info":
        return "missing_info"
    if canonical == "translate":
        return "translate_ar_en"
    return "template"


def template_enabled_by_settings(ai_settings, feature: str) -> bool:
    if feature in {"draft", "template"}:
        return bool(ai_settings.allow_message_drafting)
    if feature in {"improve", "formalize", "shorten"}:
        return bool(ai_settings.allow_message_improvement)
    if feature == "suggest_reply":
        return bool(ai_settings.allow_reply_suggestion)
    if feature == "summarize":
        return bool(ai_settings.allow_summarization)
    if feature == "missing_info":
        return bool(ai_settings.allow_missing_info_detection)
    if feature == "translate_ar_en":
        return bool(ai_settings.allow_translate_ar_en)
    return True


@router.get("/status", response_model=AIStatusRead)
def ai_status(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    item = get_or_create_ai_settings(db)
    db.commit()
    db.refresh(item)
    return AIStatusRead(
        is_enabled=bool(item.is_enabled),
        mode=item.mode or ("enabled" if item.is_enabled else "disabled"),
        allow_message_drafting=bool(item.is_enabled and item.allow_message_drafting),
        allow_summarization=bool(item.is_enabled and item.allow_summarization),
        allow_reply_suggestion=bool(item.is_enabled and item.allow_reply_suggestion),
        allow_message_improvement=bool(item.is_enabled and item.allow_message_improvement),
        allow_missing_info_detection=bool(item.is_enabled and item.allow_missing_info_detection),
        allow_translate_ar_en=bool(item.is_enabled and item.allow_translate_ar_en),
        show_in_compose_message=bool(item.is_enabled and item.show_in_compose_message),
        show_in_message_details=bool(item.is_enabled and item.show_in_message_details),
        show_in_request_messages_tab=bool(item.is_enabled and item.show_in_request_messages_tab),
        max_input_chars=item.max_input_chars,
    )


@router.get("/prompt-templates", response_model=list[AIPromptTemplateOption])
def messaging_prompt_templates(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ai_settings = get_or_create_ai_settings(db)
    if not ai_settings.is_enabled or not ai_settings.show_in_compose_message:
        return []
    ensure_prompt_templates(db)
    hidden_legacy_codes = set(PROMPT_ALIASES.keys())
    rows = db.scalars(
        select(AIPromptTemplate)
        .where(AIPromptTemplate.is_active == True)
        .order_by(AIPromptTemplate.name_ar, AIPromptTemplate.id)
    ).all()
    options: list[AIPromptTemplateOption] = []
    for item in rows:
        if item.code in hidden_legacy_codes:
            continue
        feature = template_feature(item.code)
        if not template_enabled_by_settings(ai_settings, feature):
            continue
        try:
            validate_ai_role_permission(db, current_user, feature)
        except HTTPException:
            continue
        options.append(
            AIPromptTemplateOption(
                id=item.id,
                code=item.code,
                name_ar=item.name_ar,
                description=item.description,
                output_kind=template_output_kind(item.code),
            )
        )
    db.commit()
    return options


@router.post("/messages/run-template", response_model=AIRunTemplateResponse)
def run_prompt_template(payload: AIRunTemplateRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ai_settings = get_or_create_ai_settings(db)
    item = db.get(AIPromptTemplate, payload.template_id)
    if not item or not item.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="قالب الذكاء الاصطناعي غير موجود أو غير مفعل")

    service_request = resolve_request(db, payload.related_request_id, current_user)
    instruction = strip_html(payload.instruction)
    body = strip_html(payload.body)
    if not instruction and not body:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="اكتب تعليمات للمساعد أو نصاً لتطبيق القالب عليه")

    request_type = payload.request_type or (str(service_request.request_type) if service_request else "-")
    request_context = mask_sensitive_text(request_context_text(service_request, ai_settings), ai_settings)
    prompt = render_ai_prompt_template(
        item.prompt_text,
        text=body or instruction,
        body=body,
        instruction=instruction,
        request_context=request_context,
        request_type=request_type,
    )
    feature = template_feature(item.code)
    entity_type = "service_request" if service_request else None
    entity_id = str(service_request.id) if service_request else None
    source_text = "\n".join(part for part in [instruction, body] if part)
    result = generate_ai_text(db, current_user, feature, prompt, entity_type, entity_id, source_text=source_text)
    output_kind = template_output_kind(item.code)
    if output_kind == "draft":
        parsed = parse_draft_output(result.text)
        return AIRunTemplateResponse(template_id=item.id, template_name=item.name_ar, output_kind=output_kind, subject=parsed["subject"], body=parsed["body"])
    if output_kind == "missing":
        return AIRunTemplateResponse(template_id=item.id, template_name=item.name_ar, output_kind=output_kind, items=parse_missing_items(result.text))
    return AIRunTemplateResponse(template_id=item.id, template_name=item.name_ar, output_kind=output_kind, body=result.text)


@router.post("/messages/draft", response_model=AIDraftResponse)
def draft_message(payload: AIDraftRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ai_settings = get_or_create_ai_settings(db)
    service_request = resolve_request(db, payload.related_request_id, current_user)
    instruction = strip_html(payload.instruction)
    template = prompt_template(db, "message_draft")
    prompt = template.format(
        instruction=instruction,
        request_context=mask_sensitive_text(request_context_text(service_request, ai_settings), ai_settings),
    )
    result = generate_ai_text(db, current_user, "draft", prompt, "service_request" if service_request else None, str(service_request.id) if service_request else None, source_text=instruction)
    parsed = parse_draft_output(result.text)
    return AIDraftResponse(subject=parsed["subject"], body=parsed["body"])


@router.post("/messages/improve", response_model=AITextResponse)
def improve_message(payload: AITextRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service_request = resolve_request(db, payload.related_request_id, current_user)
    body = strip_html(payload.body)
    prompt = prompt_template(db, "message_improve").format(text=body)
    result = generate_ai_text(db, current_user, "improve", prompt, "service_request" if service_request else None, str(service_request.id) if service_request else None, source_text=body)
    return AITextResponse(body=result.text)


@router.post("/messages/formalize", response_model=AITextResponse)
def formalize_message(payload: AITextRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service_request = resolve_request(db, payload.related_request_id, current_user)
    body = strip_html(payload.body)
    prompt = prompt_template(db, "message_formalize").format(text=body)
    result = generate_ai_text(db, current_user, "formalize", prompt, "service_request" if service_request else None, str(service_request.id) if service_request else None, source_text=body)
    return AITextResponse(body=result.text)


@router.post("/messages/shorten", response_model=AITextResponse)
def shorten_message(payload: AITextRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service_request = resolve_request(db, payload.related_request_id, current_user)
    body = strip_html(payload.body)
    prompt = prompt_template(db, "message_shorten").format(text=body)
    result = generate_ai_text(db, current_user, "shorten", prompt, "service_request" if service_request else None, str(service_request.id) if service_request else None, source_text=body)
    return AITextResponse(body=result.text)


@router.post("/messages/suggest-reply", response_model=AITextResponse)
def suggest_reply(payload: AISuggestReplyRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ai_settings = get_or_create_ai_settings(db)
    service_request = resolve_request(db, payload.related_request_id, current_user)
    body = payload.body
    entity_type = "service_request" if service_request else None
    entity_id = str(service_request.id) if service_request else None
    if payload.message_id:
        message = load_message_for_ai(db, payload.message_id, current_user)
        body = body or message.body
        if not service_request and message.related_request_id:
            service_request = resolve_request(db, message.related_request_id, current_user)
            entity_type = "internal_message"
            entity_id = str(message.id)
    if not body:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="نص الرسالة مطلوب لاقتراح الرد")
    body_text = strip_html(body)
    prompt = prompt_template(db, "message_reply").format(text=body_text, request_context=mask_sensitive_text(request_context_text(service_request, ai_settings), ai_settings))
    result = generate_ai_text(db, current_user, "suggest_reply", prompt, entity_type, entity_id, source_text=body_text)
    return AITextResponse(body=result.text)


@router.post("/messages/summarize", response_model=AISummaryResponse)
def summarize_messages(payload: AISummarizeRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ai_settings = get_or_create_ai_settings(db)
    text = strip_html(payload.text)
    entity_type = None
    entity_id = None
    if payload.related_request_id:
        service_request = resolve_request(db, payload.related_request_id, current_user)
        if not ai_settings.allow_request_context or (ai_settings.request_context_level or "basic_only") != "basic_and_allowed_messages":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="تلخيص مراسلات الطلب غير مسموح حسب إعدادات الخصوصية")
        text = visible_request_messages_text(db, current_user, service_request)
        entity_type = "service_request"
        entity_id = str(service_request.id)
    elif payload.message_id:
        message = load_message_for_ai(db, payload.message_id, current_user)
        text = "\n".join([f"الموضوع: {message.subject}", f"المرسل: {message.sender.full_name_ar if message.sender else '-'}", strip_html(message.body)])
        entity_type = "internal_message"
        entity_id = str(message.id)
    elif payload.message_ids:
        rows = db.scalars(
            select(InternalMessage)
            .options(selectinload(InternalMessage.sender), selectinload(InternalMessage.recipients))
            .where(InternalMessage.id.in_(payload.message_ids), InternalMessage.is_draft == False)
            .order_by(InternalMessage.created_at)
        ).all()
        allowed = [message for message in rows if message.sender_id == current_user.id or any(recipient.recipient_id == current_user.id for recipient in message.recipients)]
        text = "\n\n".join(f"{message.subject}\n{strip_html(message.body)}" for message in allowed)
        entity_type = "internal_message"
        entity_id = ",".join(str(message.id) for message in allowed[:20])
    if not text.strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="لا توجد مراسلات متاحة للتلخيص")
    prompt = prompt_template(db, "message_summary").format(text=text)
    result = generate_ai_text(db, current_user, "summarize", prompt, entity_type, entity_id, max_tokens=900, source_text=text)
    return AISummaryResponse(summary=result.text)


@router.post("/messages/missing-info", response_model=AIMissingInfoResponse)
def missing_info(payload: AIMissingInfoRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ai_settings = get_or_create_ai_settings(db)
    service_request = resolve_request(db, payload.related_request_id, current_user)
    request_type = payload.request_type or (str(service_request.request_type) if service_request else "-")
    body = strip_html(payload.body)
    prompt = prompt_template(db, "missing_info").format(
        text=body,
        request_type=request_type,
        request_context=mask_sensitive_text(request_context_text(service_request, ai_settings), ai_settings),
    )
    result = generate_ai_text(db, current_user, "missing_info", prompt, "service_request" if service_request else None, str(service_request.id) if service_request else None, source_text=body)
    return AIMissingInfoResponse(items=parse_missing_items(result.text))
