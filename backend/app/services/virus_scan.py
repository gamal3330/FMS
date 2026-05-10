from __future__ import annotations

import os
import shlex
import shutil
import subprocess
from pathlib import Path

from fastapi import HTTPException, status


DEFAULT_TIMEOUT_SECONDS = 60


def _timeout_seconds() -> int:
    try:
        return max(int(os.getenv("VIRUS_SCAN_TIMEOUT_SECONDS", str(DEFAULT_TIMEOUT_SECONDS))), 1)
    except ValueError:
        return DEFAULT_TIMEOUT_SECONDS


def _scanner_candidates() -> list[list[str]]:
    configured = os.getenv("VIRUS_SCAN_COMMAND")
    if configured:
        command = shlex.split(configured)
        return [command] if command else []

    candidates: list[list[str]] = []
    clamdscan = shutil.which("clamdscan")
    if clamdscan:
        candidates.append([clamdscan, "--fdpass", "--no-summary"])

    clamscan = shutil.which("clamscan")
    if clamscan:
        candidates.append([clamscan, "--no-summary"])

    return candidates


def scan_file_or_raise(path: Path, *, enabled: bool) -> None:
    if not enabled:
        return

    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ملف الفحص غير موجود.")

    scanners = _scanner_candidates()
    if not scanners:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="فحص الفيروسات مفعل لكن محرك الفحص غير مثبت على الخادم. ثبّت ClamAV أو أوقف فحص الفيروسات من إعدادات المراسلات.",
        )

    errors: list[str] = []
    for scanner in scanners:
        try:
            result = subprocess.run(
                [*scanner, str(path)],
                capture_output=True,
                text=True,
                timeout=_timeout_seconds(),
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            errors.append("انتهت مهلة فحص الفيروسات.")
            continue
        except OSError as exc:
            errors.append(str(exc))
            continue

        output = (result.stdout or result.stderr or "").strip()
        if result.returncode == 0:
            return
        if result.returncode == 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="تم رفض الملف لأن فحص الفيروسات اكتشف تهديداً محتملاً.",
            )
        errors.append(output or f"رمز خروج غير متوقع: {result.returncode}")

    details = " ".join(item for item in errors if item).strip()
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail=f"فشل فحص الفيروسات. {details[:300] if details else 'تعذر تشغيل محرك الفحص.'}",
    )
