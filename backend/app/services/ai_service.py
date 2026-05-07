from __future__ import annotations

import base64
import hashlib
import html
import json
import re
import time
from dataclasses import dataclass
from typing import Any
from urllib import error as urlerror
from urllib import request as urlrequest

from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.config import get_settings
from app.models.ai import AISettings, AIPromptTemplate, AIUsageLog
from app.models.enums import UserRole
from app.models.message import InternalMessage
from app.models.request import ApprovalStep, ServiceRequest
from app.models.user import Department, User
from app.services.workflow import IMPLEMENTATION_STEP_ROLES

settings = get_settings()

DEFAULT_AI_PROVIDER = "openai_compatible"
AI_RATE_LIMIT_WINDOW_SECONDS = 60
AI_RATE_LIMIT_MAX_REQUESTS = 20
_rate_limit_hits: dict[int, list[float]] = {}

SECTION_KEYWORDS = {
    "servers": ["server", "servers", "srv", "سيرفر", "خوادم"],
    "networks": ["network", "networks", "net", "شبكة", "شبكات"],
    "support": ["support", "helpdesk", "دعم", "فني"],
    "development": ["development", "software", "dev", "تطوير", "برامج"],
}

DEFAULT_PROMPTS = {
    "message_draft": {
        "name_ar": "توليد مسودة رسالة",
        "prompt_text": (
            "اكتب مسودة رسالة داخلية باللغة العربية المهنية كأن المستخدم الحالي هو مرسل الرسالة بنفسه.\n"
            "المطلوب من المستخدم: {instruction}\n\n"
            "سياق الطلب إن وجد:\n{request_context}\n\n"
            "أعد النتيجة بصيغة JSON فقط وبالمفاتيح: subject, body. اجعل body نص الرسالة فقط بدون شرح."
        ),
    },
    "message_improve": {
        "name_ar": "تحسين صياغة رسالة",
        "prompt_text": (
            "حسّن صياغة الرسالة التالية باللغة العربية المهنية دون تغيير المعنى، ودون إضافة معلومات غير موجودة.\n"
            "النص:\n{text}\n\n"
            "أعد النص المحسن فقط."
        ),
    },
    "message_formalize": {
        "name_ar": "جعل الرسالة رسمية",
        "prompt_text": (
            "حوّل الرسالة التالية إلى صياغة رسمية مناسبة لمراسلات داخلية مصرفية، دون إرسال أو اتخاذ أي إجراء.\n"
            "النص:\n{text}\n\n"
            "أعد النص الرسمي فقط."
        ),
    },
    "message_shorten": {
        "name_ar": "اختصار رسالة",
        "prompt_text": (
            "اختصر الرسالة التالية مع الحفاظ على المعلومات المهمة ونبرة مهنية واضحة.\n"
            "النص:\n{text}\n\n"
            "أعد النص المختصر فقط."
        ),
    },
    "message_reply": {
        "name_ar": "اقتراح رد",
        "prompt_text": (
            "اقترح رداً مهنياً باللغة العربية على الرسالة التالية. لا تعتمد أو ترفض أو تنفذ أي إجراء، فقط اكتب مسودة رد.\n"
            "سياق الطلب إن وجد:\n{request_context}\n\n"
            "الرسالة المستلمة:\n{text}\n\n"
            "أعد نص الرد فقط."
        ),
    },
    "message_summary": {
        "name_ar": "تلخيص مراسلات",
        "prompt_text": (
            "لخّص المراسلات التالية باللغة العربية في نقاط قصيرة، مع إبراز المطلوب والقرارات والملاحظات المفتوحة.\n"
            "المراسلات:\n{text}\n\n"
            "أعد الملخص فقط."
        ),
    },
    "missing_info": {
        "name_ar": "اكتشاف المعلومات الناقصة",
        "prompt_text": (
            "راجع مسودة الرسالة التالية وحدد المعلومات الناقصة أو غير الواضحة قبل الإرسال.\n"
            "نوع الطلب إن وجد: {request_type}\n"
            "سياق الطلب إن وجد:\n{request_context}\n\n"
            "المسودة:\n{text}\n\n"
            "أعد JSON فقط بالمفتاح items وقيمته قائمة نصوص عربية قصيرة."
        ),
    },
}

ROLE_LABELS = {
    UserRole.EMPLOYEE: "موظف",
    UserRole.DIRECT_MANAGER: "مدير مباشر",
    UserRole.IT_STAFF: "موظف تنفيذ",
    UserRole.IT_MANAGER: "مدير تقنية المعلومات",
    UserRole.INFOSEC: "أمن المعلومات",
    UserRole.EXECUTIVE: "الإدارة التنفيذية",
    UserRole.SUPER_ADMIN: "مدير النظام",
}


@dataclass
class AIResult:
    text: str
    input_length: int
    output_length: int


def encryption_key() -> bytes:
    digest = hashlib.sha256(settings.secret_key.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


def encrypt_api_key(value: str | None) -> str | None:
    if not value:
        return None
    return Fernet(encryption_key()).encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt_api_key(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return Fernet(encryption_key()).decrypt(value.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="تعذر قراءة مفتاح خدمة الذكاء الاصطناعي") from exc


def get_or_create_ai_settings(db: Session) -> AISettings:
    item = db.scalar(select(AISettings).limit(1))
    if item:
        return item
    item = AISettings()
    db.add(item)
    db.flush()
    return item


def ai_settings_read(item: AISettings) -> dict[str, Any]:
    return {
        "id": item.id,
        "is_enabled": bool(item.is_enabled),
        "provider": item.provider or DEFAULT_AI_PROVIDER,
        "api_base_url": item.api_base_url,
        "api_key_configured": bool(item.api_key_encrypted),
        "model_name": item.model_name,
        "max_input_chars": item.max_input_chars,
        "allow_message_drafting": bool(item.allow_message_drafting),
        "allow_summarization": bool(item.allow_summarization),
        "allow_reply_suggestion": bool(item.allow_reply_suggestion),
        "mask_sensitive_data": bool(item.mask_sensitive_data),
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    }


def ensure_prompt_templates(db: Session) -> None:
    existing = set(db.scalars(select(AIPromptTemplate.code)).all())
    for code, value in DEFAULT_PROMPTS.items():
        if code in existing:
            continue
        db.add(AIPromptTemplate(code=code, name_ar=value["name_ar"], prompt_text=value["prompt_text"], is_active=True))
    db.flush()


def prompt_template(db: Session, code: str) -> str:
    ensure_prompt_templates(db)
    item = db.scalar(select(AIPromptTemplate).where(AIPromptTemplate.code == code, AIPromptTemplate.is_active == True))
    if item:
        return item.prompt_text
    return DEFAULT_PROMPTS[code]["prompt_text"]


def strip_html(value: str | None) -> str:
    text = re.sub(r"<br\s*/?>", "\n", value or "", flags=re.IGNORECASE)
    text = re.sub(r"</p\s*>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    return re.sub(r"[ \t]+", " ", text).strip()


def mask_sensitive_text(value: str, mask_optional_identifiers: bool = True) -> str:
    text = value or ""
    text = re.sub(r"(?i)(password|pass|كلمة\s*المرور|secret|token|api[_ -]?key)\s*[:=]\s*\S+", r"\1: ***MASKED_SECRET***", text)
    text = re.sub(r"(?i)bearer\s+[A-Za-z0-9._\-]+", "Bearer ***MASKED_TOKEN***", text)
    if mask_optional_identifiers:
        text = re.sub(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b", "***MASKED_EMAIL***", text)
        text = re.sub(r"(?<!\d)(?:\+?\d[\d\s-]{7,}\d)(?!\d)", "***MASKED_PHONE***", text)
        text = re.sub(r"(?i)\b(?:employee\s*id|emp\s*id|الرقم\s*الوظيفي)\s*[:=]?\s*[A-Za-z0-9_-]{2,}\b", "***MASKED_EMPLOYEE_ID***", text)
    return text


def ai_user_context(user: User) -> str:
    department_name = user.department.name_ar if user.department else "-"
    return "\n".join(
        [
            "معلومات المستخدم التالية للسياق فقط، ولا تذكرها داخل النص إلا إذا طلب المستخدم ذلك صراحة:",
            f"اسم المستخدم الحالي: {user.full_name_ar or user.full_name_en or '-'}",
            f"دور المستخدم: {ROLE_LABELS.get(user.role, str(user.role))}",
            f"إدارة المستخدم: {department_name}",
        ]
    )


def ai_feature_instructions(feature: str) -> str:
    if feature == "draft":
        return (
            "المطلوب هو إنشاء مسودة رسالة فقط. اكتب كأن المستخدم الحالي هو كاتب الرسالة ومرسلها. "
            "استخدم صيغة المتكلم المناسبة مثل: أرجو، أطلب، أتقدم، أود. "
            "لا تستخدم عبارات مثل: باسمي، بالنيابة عني، المستخدم يريد، يمكنكم كتابة. "
            "لا تستخدم صيغة المخاطب عن المستخدم مثل: استقالتك أو طلبك، بل اكتب: استقالتي أو طلبي عند الحاجة. "
            "لا تذكر دور المستخدم أو إدارته أو منصبه داخل الرسالة إلا إذا كانت مذكورة في طلب المستخدم. "
            "لا تضف أسباباً أو تواريخ أو إجراءات مستقبلية أو وعوداً غير مذكورة. "
            "اكتب تحية قصيرة، ثم متن الرسالة، ثم خاتمة مهنية في 3 إلى 5 أسطر واضحة. "
            "لا تضف أسماء أو تواريخ أو مراجع غير متوفرة. لا تستخدم أقواساً مثل [اسم] إلا إذا كانت المعلومة ضرورية وغير متاحة. "
            "مثال عند طلب رسالة استقالة: الموضوع: طلب استقالة، والنص: السلام عليكم ورحمة الله وبركاته،\\nأتقدم إليكم بطلب قبول استقالتي من العمل.\\nأقدر لكم فترة عملي معكم، وأرجو التكرم باتخاذ ما يلزم وفق الإجراءات المعتمدة.\\nمع خالص الشكر والتقدير. "
            "أعد JSON صالحاً فقط بهذا الشكل: {\"subject\":\"...\",\"body\":\"...\"}."
        )
    if feature in {"improve", "formalize", "shorten"}:
        return (
            "حافظ على كون النص صادراً من نفس المستخدم وبنفس المعنى. "
            "لا تضف مقدمة تفسيرية مثل: إليك النص. أعد النص النهائي فقط بدون Markdown أو شرح."
        )
    if feature == "suggest_reply":
        return (
            "اقترح رداً كأن المستخدم الحالي سيرسله بنفسه. "
            "لا تتخذ قراراً ولا توافق ولا ترفض بالنيابة عنه. أعد نص الرد فقط بدون شرح."
        )
    if feature == "summarize":
        return "لخص المحتوى بوضوح وحياد. لا تكتب كأنك أحد أطراف المراسلة."
    if feature == "missing_info":
        return "أعد JSON صالحاً فقط بهذا الشكل: {\"items\":[\"...\"]}."
    return "أعد ناتجاً مهنياً مختصراً باللغة العربية فقط."


def build_ai_prompt(current_user: User, feature: str, prompt: str) -> str:
    return "\n\n".join(
        [
            "أنت مساعد ذكي للمراسلات الداخلية في نظام مصرفي. لا ترسل الرسائل ولا تتخذ أي إجراء، بل تنتج مسودات واقتراحات فقط.",
            "تعامل مع المهمة من منظور المستخدم الحالي عندما تكون المهمة كتابة مسودة أو رد.",
            ai_user_context(current_user),
            f"تعليمات هذه المهمة: {ai_feature_instructions(feature)}",
            "طلب النظام:",
            prompt,
        ]
    )


def clean_ai_text_output(text: str) -> str:
    cleaned = (text or "").strip()
    cleaned = re.sub(r"^```(?:json|html|text)?", "", cleaned, flags=re.IGNORECASE).strip()
    cleaned = re.sub(r"```$", "", cleaned).strip()
    cleaned = re.sub(r"^(?:بالطبع|أكيد)[،,.]?\s*", "", cleaned).strip()
    cleaned = re.sub(r"^إليك\s+(?:مسودة|صياغة|النص|الرد)[^:\n]*:\s*", "", cleaned, flags=re.IGNORECASE).strip()
    cleaned = re.sub(r"^باسمي[،,]?\s*", "", cleaned).strip()
    return cleaned


def enforce_ai_rate_limit(user: User) -> None:
    now = time.monotonic()
    hits = [hit for hit in _rate_limit_hits.get(user.id, []) if now - hit < AI_RATE_LIMIT_WINDOW_SECONDS]
    if len(hits) >= AI_RATE_LIMIT_MAX_REQUESTS:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="تم تجاوز حد استخدام المساعد الذكي مؤقتاً")
    hits.append(now)
    _rate_limit_hits[user.id] = hits


def user_administrative_section(user: User) -> str | None:
    if user.administrative_section:
        return user.administrative_section
    department = user.department
    if not department:
        return None
    text = f"{department.name_ar or ''} {department.name_en or ''} {department.code or ''}".lower()
    for section, keywords in SECTION_KEYWORDS.items():
        if any(keyword.lower() in text for keyword in keywords):
            return section
    return None


def request_matches_it_staff_section(service_request: ServiceRequest, user: User) -> bool:
    form_data = service_request.form_data or {}
    request_section = form_data.get("assigned_section") or form_data.get("administrative_section")
    staff_section = user_administrative_section(user)
    return bool(staff_section and request_section == staff_section)


def unassigned_it_staff_can_cover_request(db: Session, service_request: ServiceRequest, user: User) -> bool:
    if user.role != UserRole.IT_STAFF or user_administrative_section(user):
        return False
    form_data = service_request.form_data or {}
    request_section = form_data.get("assigned_section") or form_data.get("administrative_section")
    if not request_section:
        return False
    section_staff_count = db.scalar(
        select(func.count()).select_from(User).where(User.role == UserRole.IT_STAFF, User.is_active == True, User.administrative_section == request_section)
    ) or 0
    return section_staff_count == 0


def ensure_request_access(db: Session, service_request: ServiceRequest, current_user: User) -> None:
    if current_user.role in {UserRole.SUPER_ADMIN, UserRole.IT_MANAGER}:
        return
    if service_request.requester_id == current_user.id:
        return
    if current_user.role == UserRole.DIRECT_MANAGER and service_request.requester and service_request.requester.manager_id == current_user.id:
        return
    if current_user.role != UserRole.IT_STAFF and any(step.role == current_user.role for step in service_request.approvals):
        return
    if current_user.role == UserRole.IT_STAFF and any(step.role in IMPLEMENTATION_STEP_ROLES for step in service_request.approvals):
        if request_matches_it_staff_section(service_request, current_user) or unassigned_it_staff_can_cover_request(db, service_request, current_user):
            return
    if current_user.role == UserRole.IT_STAFF and any(step.role == UserRole.IT_STAFF for step in service_request.approvals):
        if request_matches_it_staff_section(service_request, current_user):
            return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="لا تملك صلاحية الوصول إلى سياق هذا الطلب")


def resolve_request(db: Session, ref: int | str | None, current_user: User) -> ServiceRequest | None:
    if ref is None or str(ref).strip() == "":
        return None
    text = str(ref).strip()
    stmt = (
        select(ServiceRequest)
        .options(
            selectinload(ServiceRequest.requester).selectinload(User.department),
            selectinload(ServiceRequest.department),
            selectinload(ServiceRequest.approvals).selectinload(ApprovalStep.approver),
        )
    )
    if text.isdigit():
        request_item = db.scalar(stmt.where((ServiceRequest.id == int(text)) | (ServiceRequest.request_number == text)))
    else:
        request_item = db.scalar(stmt.where(ServiceRequest.request_number == text))
    if not request_item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="الطلب المرتبط غير موجود")
    ensure_request_access(db, request_item, current_user)
    return request_item


def request_context_text(service_request: ServiceRequest | None) -> str:
    if not service_request:
        return "لا يوجد سياق طلب مرتبط."
    form_data = service_request.form_data or {}
    fields = "\n".join(f"- {key}: {value}" for key, value in list(form_data.items())[:20] if value not in (None, ""))
    return "\n".join(
        [
            f"رقم الطلب: {service_request.request_number}",
            f"عنوان الطلب: {service_request.title}",
            f"نوع الطلب: {service_request.request_type}",
            f"الحالة: {service_request.status}",
            f"الأولوية: {service_request.priority}",
            f"مقدم الطلب: {service_request.requester.full_name_ar if service_request.requester else '-'}",
            f"الإدارة: {service_request.department.name_ar if service_request.department else '-'}",
            f"مبرر العمل: {service_request.business_justification or '-'}",
            "بيانات النموذج:",
            fields or "-",
        ]
    )


def can_access_message(message: InternalMessage, user: User) -> bool:
    if message.is_draft:
        return message.sender_id == user.id
    return message.sender_id == user.id or any(recipient.recipient_id == user.id for recipient in message.recipients)


def load_message_for_ai(db: Session, message_id: int, current_user: User) -> InternalMessage:
    message = db.scalar(
        select(InternalMessage)
        .options(
            selectinload(InternalMessage.sender),
            selectinload(InternalMessage.recipients),
            selectinload(InternalMessage.related_request),
        )
        .where(InternalMessage.id == message_id)
    )
    if not message or not can_access_message(message, current_user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="الرسالة غير موجودة")
    return message


def visible_request_messages_text(db: Session, current_user: User, service_request: ServiceRequest) -> str:
    rows = db.scalars(
        select(InternalMessage)
        .options(selectinload(InternalMessage.sender), selectinload(InternalMessage.recipients))
        .where(InternalMessage.related_request_id == service_request.id, InternalMessage.is_draft == False)
        .order_by(InternalMessage.created_at)
        .limit(100)
    ).all()
    parts = []
    for message in rows:
        if not can_access_message(message, current_user):
            continue
        parts.append(
            "\n".join(
                [
                    f"المرسل: {message.sender.full_name_ar if message.sender else '-'}",
                    f"الموضوع: {message.subject}",
                    f"التاريخ: {message.created_at}",
                    f"النص: {strip_html(message.body)}",
                ]
            )
        )
    return "\n\n---\n\n".join(parts)


class AIProvider:
    def generate_text(self, prompt: str, max_tokens: int = 800) -> str:
        raise NotImplementedError


class MockAIProvider(AIProvider):
    def generate_text(self, prompt: str, max_tokens: int = 800) -> str:
        if '"subject"' in prompt or "subject, body" in prompt:
            return json.dumps(
                {
                    "subject": "مسودة مراسلة داخلية",
                    "body": "الأخ/الأخت الكريم/ة،\nيرجى الاطلاع على الموضوع أدناه وتزويدنا بالمعلومات المطلوبة لاستكمال الإجراء.\n\nمع الشكر.",
                },
                ensure_ascii=False,
            )
        if "items" in prompt and "JSON" in prompt:
            return json.dumps({"items": ["تحديد رقم الطلب أو المرجع", "توضيح المطلوب من المستلم", "إضافة الموعد المتوقع للرد"]}, ensure_ascii=False)
        return "هذه مسودة مقترحة من المساعد الذكي. يرجى مراجعتها وتعديلها قبل الإرسال."


class HTTPAIProvider(AIProvider):
    def __init__(self, provider: str, api_base_url: str, api_key: str | None, model_name: str):
        self.provider = provider
        self.api_base_url = api_base_url.rstrip("/")
        self.api_key = api_key
        self.model_name = model_name

    def generate_text(self, prompt: str, max_tokens: int = 800) -> str:
        provider = (self.provider or "").lower()
        endpoint = self.api_base_url
        if provider in {"openai_compatible", "openai-compatible", "chat_completions"}:
            payload = {
                "model": self.model_name,
                "messages": [
                    {"role": "system", "content": "You are a careful Arabic writing assistant for an internal banking service portal."},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.2,
                "max_tokens": max_tokens,
            }
        elif provider in {"ollama", "ollama_native"}:
            if endpoint.endswith("/v1/chat/completions"):
                payload = {
                    "model": self.model_name,
                    "messages": [
                        {"role": "system", "content": "You are a careful Arabic writing assistant for an internal banking service portal."},
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0.2,
                    "max_tokens": max_tokens,
                }
            else:
                if not endpoint.endswith("/api/generate"):
                    endpoint = f"{endpoint}/api/generate"
                payload = {
                    "model": self.model_name,
                    "prompt": prompt,
                    "stream": False,
                    "options": {"temperature": 0.2, "num_predict": max_tokens},
                }
        else:
            payload = {"model": self.model_name, "prompt": prompt, "max_tokens": max_tokens, "temperature": 0.2}
        data = json.dumps(payload).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        req = urlrequest.Request(endpoint, data=data, headers=headers, method="POST")
        try:
            with urlrequest.urlopen(req, timeout=45) as response:
                raw = response.read().decode("utf-8")
        except urlerror.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="ignore")[:500]
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"فشل مزود الذكاء الاصطناعي: {detail or exc.reason}") from exc
        except (urlerror.URLError, TimeoutError) as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="تعذر الاتصال بمزود الذكاء الاصطناعي") from exc
        return extract_provider_text(raw)


def extract_provider_text(raw: str) -> str:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return raw.strip()
    if isinstance(data, dict):
        if isinstance(data.get("response"), str):
            return data["response"].strip()
        if isinstance(data.get("text"), str):
            return data["text"].strip()
        if isinstance(data.get("output"), str):
            return data["output"].strip()
        choices = data.get("choices")
        if isinstance(choices, list) and choices:
            first = choices[0]
            if isinstance(first, dict):
                message = first.get("message")
                if isinstance(message, dict) and isinstance(message.get("content"), str):
                    return message["content"].strip()
                if isinstance(first.get("text"), str):
                    return first["text"].strip()
        if isinstance(data.get("content"), str):
            return data["content"].strip()
    return raw.strip()


def provider_for_settings(item: AISettings) -> AIProvider:
    provider = (item.provider or DEFAULT_AI_PROVIDER).lower()
    if provider in {"mock", "local_mock"}:
        return MockAIProvider()
    if not item.api_base_url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="لم يتم ضبط رابط مزود الذكاء الاصطناعي")
    api_key = None if provider in {"ollama", "ollama_native"} else decrypt_api_key(item.api_key_encrypted)
    return HTTPAIProvider(provider, item.api_base_url, api_key, item.model_name)


def validate_ai_feature(item: AISettings, feature: str) -> None:
    if not item.is_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="المساعد الذكي غير مفعل من إعدادات النظام")
    if feature in {"draft", "improve", "formalize", "shorten", "missing_info"} and not item.allow_message_drafting:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="توليد الرسائل غير مفعل في إعدادات المساعد الذكي")
    if feature == "summarize" and not item.allow_summarization:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="تلخيص المراسلات غير مفعل في إعدادات المساعد الذكي")
    if feature == "suggest_reply" and not item.allow_reply_suggestion:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="اقتراح الردود غير مفعل في إعدادات المساعد الذكي")


def render_prompt(template: str, **kwargs: str) -> str:
    return template.format(**{key: value or "" for key, value in kwargs.items()})


def generate_ai_text(
    db: Session,
    current_user: User,
    feature: str,
    prompt: str,
    entity_type: str | None = None,
    entity_id: str | None = None,
    max_tokens: int = 800,
) -> AIResult:
    item = get_or_create_ai_settings(db)
    validate_ai_feature(item, feature)
    enforce_ai_rate_limit(current_user)
    clean_prompt = mask_sensitive_text(build_ai_prompt(current_user, feature, prompt), bool(item.mask_sensitive_data))
    if len(clean_prompt) > item.max_input_chars:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail=f"النص أطول من الحد المسموح {item.max_input_chars} حرفاً")
    usage = AIUsageLog(
        user_id=current_user.id,
        feature=feature,
        entity_type=entity_type,
        entity_id=entity_id,
        input_length=len(clean_prompt),
        status="success",
    )
    db.add(usage)
    try:
        output = clean_ai_text_output(provider_for_settings(item).generate_text(clean_prompt, max_tokens=max_tokens))
        usage.output_length = len(output)
        db.commit()
        return AIResult(text=output, input_length=len(clean_prompt), output_length=len(output))
    except HTTPException as exc:
        usage.status = "failed"
        usage.error_message = str(exc.detail)[:1000]
        db.commit()
        raise
    except Exception as exc:
        usage.status = "failed"
        usage.error_message = str(exc)[:1000]
        db.commit()
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="فشل تنفيذ طلب المساعد الذكي") from exc


def parse_json_object(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    cleaned = re.sub(r"^```(?:json)?", "", cleaned, flags=re.IGNORECASE).strip()
    cleaned = re.sub(r"```$", "", cleaned).strip()
    match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
    if match:
        cleaned = match.group(0)
    try:
        data = json.loads(cleaned)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def parse_draft_output(text: str) -> dict[str, str]:
    data = parse_json_object(text)
    subject = clean_ai_text_output(str(data.get("subject") or ""))
    body = clean_ai_text_output(str(data.get("body") or ""))
    if body:
        return {"subject": subject[:180], "body": body}
    lines = [clean_ai_text_output(line) for line in text.splitlines() if clean_ai_text_output(line)]
    return {"subject": (subject or (lines[0] if lines else "مسودة رسالة"))[:180], "body": "\n".join(lines[1:] or lines)}


def parse_missing_items(text: str) -> list[str]:
    data = parse_json_object(text)
    items = data.get("items")
    if isinstance(items, list):
        return [str(item).strip() for item in items if str(item).strip()][:20]
    lines = [re.sub(r"^[-*\d\.\)\s]+", "", line).strip() for line in text.splitlines()]
    return [line for line in lines if line][:20]
