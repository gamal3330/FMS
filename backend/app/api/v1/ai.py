from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.message import InternalMessage
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
    AITextRequest,
    AITextResponse,
)
from app.services.ai_service import (
    get_or_create_ai_settings,
    generate_ai_text,
    load_message_for_ai,
    mask_sensitive_text,
    parse_draft_output,
    parse_missing_items,
    prompt_template,
    request_context_text,
    resolve_request,
    strip_html,
    visible_request_messages_text,
)

router = APIRouter(prefix="/ai", tags=["AI Messaging Assistant"])


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
        show_in_compose_message=bool(item.is_enabled and item.show_in_compose_message),
        show_in_message_details=bool(item.is_enabled and item.show_in_message_details),
        show_in_request_messages_tab=bool(item.is_enabled and item.show_in_request_messages_tab),
        max_input_chars=item.max_input_chars,
    )


@router.post("/messages/draft", response_model=AIDraftResponse)
def draft_message(payload: AIDraftRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service_request = resolve_request(db, payload.related_request_id, current_user)
    template = prompt_template(db, "message_draft")
    prompt = template.format(
        instruction=strip_html(payload.instruction),
        request_context=mask_sensitive_text(request_context_text(service_request)),
    )
    result = generate_ai_text(db, current_user, "draft", prompt, "service_request" if service_request else None, str(service_request.id) if service_request else None)
    parsed = parse_draft_output(result.text)
    return AIDraftResponse(subject=parsed["subject"], body=parsed["body"])


@router.post("/messages/improve", response_model=AITextResponse)
def improve_message(payload: AITextRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service_request = resolve_request(db, payload.related_request_id, current_user)
    prompt = prompt_template(db, "message_improve").format(text=strip_html(payload.body))
    result = generate_ai_text(db, current_user, "improve", prompt, "service_request" if service_request else None, str(service_request.id) if service_request else None)
    return AITextResponse(body=result.text)


@router.post("/messages/formalize", response_model=AITextResponse)
def formalize_message(payload: AITextRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service_request = resolve_request(db, payload.related_request_id, current_user)
    prompt = prompt_template(db, "message_formalize").format(text=strip_html(payload.body))
    result = generate_ai_text(db, current_user, "formalize", prompt, "service_request" if service_request else None, str(service_request.id) if service_request else None)
    return AITextResponse(body=result.text)


@router.post("/messages/shorten", response_model=AITextResponse)
def shorten_message(payload: AITextRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service_request = resolve_request(db, payload.related_request_id, current_user)
    prompt = prompt_template(db, "message_shorten").format(text=strip_html(payload.body))
    result = generate_ai_text(db, current_user, "shorten", prompt, "service_request" if service_request else None, str(service_request.id) if service_request else None)
    return AITextResponse(body=result.text)


@router.post("/messages/suggest-reply", response_model=AITextResponse)
def suggest_reply(payload: AISuggestReplyRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
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
    prompt = prompt_template(db, "message_reply").format(text=strip_html(body), request_context=request_context_text(service_request))
    result = generate_ai_text(db, current_user, "suggest_reply", prompt, entity_type, entity_id)
    return AITextResponse(body=result.text)


@router.post("/messages/summarize", response_model=AISummaryResponse)
def summarize_messages(payload: AISummarizeRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    text = strip_html(payload.text)
    entity_type = None
    entity_id = None
    if payload.related_request_id:
        service_request = resolve_request(db, payload.related_request_id, current_user)
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
    result = generate_ai_text(db, current_user, "summarize", prompt, entity_type, entity_id, max_tokens=900)
    return AISummaryResponse(summary=result.text)


@router.post("/messages/missing-info", response_model=AIMissingInfoResponse)
def missing_info(payload: AIMissingInfoRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service_request = resolve_request(db, payload.related_request_id, current_user)
    request_type = payload.request_type or (str(service_request.request_type) if service_request else "-")
    prompt = prompt_template(db, "missing_info").format(
        text=strip_html(payload.body),
        request_type=request_type,
        request_context=request_context_text(service_request),
    )
    result = generate_ai_text(db, current_user, "missing_info", prompt, "service_request" if service_request else None, str(service_request.id) if service_request else None)
    return AIMissingInfoResponse(items=parse_missing_items(result.text))
