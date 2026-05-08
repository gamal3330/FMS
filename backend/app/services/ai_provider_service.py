from __future__ import annotations

import time

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.ai import AIHealthCheck, AISettings
from app.services.ai_service import provider_for_settings


def generate_text(settings: AISettings, prompt: str, max_tokens: int = 800, temperature: float = 0.2) -> tuple[str, int]:
    started = time.perf_counter()
    output = provider_for_settings(settings).generate_text(prompt, max_tokens=max_tokens, temperature=temperature)
    return output, int((time.perf_counter() - started) * 1000)


def test_provider_connection(db: Session, settings: AISettings) -> AIHealthCheck:
    started = time.perf_counter()
    try:
        output = provider_for_settings(settings).generate_text(
            "اختبار اتصال. أجب بكلمة واحدة: ناجح",
            max_tokens=40,
            temperature=0.1,
        )
        status_value = "healthy"
        message = output[:500] or "تم الاتصال بنجاح"
    except HTTPException as exc:
        status_value = "failed"
        message = str(exc.detail)[:1000]
    except Exception as exc:
        status_value = "failed"
        message = "فشل الاتصال بمزود الذكاء الاصطناعي"
        if str(exc):
            message = str(exc)[:1000]
    health = AIHealthCheck(
        provider=settings.provider or "local_ollama",
        model_name=settings.model_name or "-",
        status=status_value,
        latency_ms=int((time.perf_counter() - started) * 1000),
        message=message,
    )
    db.add(health)
    db.flush()
    if status_value == "failed":
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=message)
    return health
