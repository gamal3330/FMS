from __future__ import annotations

import re

from app.models.ai import AISettings


def mask_ai_sensitive_text(text: str, settings: AISettings | None = None) -> str:
    """Mask sensitive values before sending content to an AI provider."""
    value = text or ""
    value = re.sub(r"(?i)(password|pass|كلمة\s*المرور|secret|token|api[_ -]?key)\s*[:=]\s*\S+", r"\1: ***MASKED_SECRET***", value)
    value = re.sub(r"(?i)bearer\s+[A-Za-z0-9._\-]+", "Bearer ***MASKED_TOKEN***", value)
    if settings and not settings.mask_sensitive_data:
        return value
    mask_emails = True if settings is None else bool(settings.mask_emails)
    mask_phones = True if settings is None else bool(settings.mask_phone_numbers)
    mask_employee_ids = True if settings is None else bool(settings.mask_employee_ids)
    mask_usernames = False if settings is None else bool(settings.mask_usernames)
    mask_requests = False if settings is None else bool(settings.mask_request_numbers)
    if mask_emails:
        value = re.sub(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b", "***MASKED_EMAIL***", value)
    if mask_requests:
        value = re.sub(r"\b(?:QIB|REQ|MSG)-\d{4}-\d{4,}\b", "***MASKED_REFERENCE***", value)
        value = re.sub(r"(?i)\b(?:رقم\s*الطلب|request\s*number)\s*[:=]?\s*[A-Za-z0-9_-]{4,}\b", "***MASKED_REFERENCE***", value)
    if mask_phones:
        value = re.sub(r"(?<![\dA-Za-z-])(?:\+?\d[\d\s-]{7,}\d)(?![\dA-Za-z-])", "***MASKED_PHONE***", value)
    if mask_employee_ids:
        value = re.sub(r"(?i)\b(?:employee\s*id|emp\s*id|staff\s*id|الرقم\s*الوظيفي|رقم\s*الموظف)\s*[:=]?\s*[A-Za-z0-9_-]{2,}\b", "***MASKED_EMPLOYEE_ID***", value)
    if mask_usernames:
        value = re.sub(r"(?i)\b(?:username|user|login)\s*[:=]\s*[A-Za-z0-9_.-]{2,}", "***MASKED_USERNAME***", value)
        value = re.sub(
            r"(?:اسم\s*المستخدم(?:\s*الحالي)?)\s*[:=]\s*[^,\n;]+?(?=\s+(?:رقم\s*الطلب|البريد|الجوال|الهاتف|الرقم\s*الوظيفي|رقم\s*الموظف)\b|[,;\n]|$)",
            "***MASKED_USERNAME***",
            value,
        )
    return value
