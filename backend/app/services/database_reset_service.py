from __future__ import annotations

import os
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import verify_password
from app.models.user import User
from app.services.audit import write_audit
from app.services.database_backup_service import create_backup
from app.services.database_jobs_service import create_job, finish_job
from app.services.database_status_service import quote_table, table_count

settings = get_settings()
RESET_CONFIRMATION = "RESET DATABASE"

RESET_SCOPES = {
    "clear_requests_only": ["request_approval_steps", "approval_steps", "request_comments", "attachments", "service_requests"],
    "clear_messages_only": ["internal_message_attachments", "internal_message_recipients", "internal_messages"],
    "clear_attachments_only": ["internal_message_attachments", "attachments"],
    "clear_audit_logs": ["audit_logs"],
    "reset_demo_data_only": ["request_approval_steps", "approval_steps", "request_comments", "attachments", "service_requests", "internal_message_attachments", "internal_message_recipients", "internal_messages"],
    "full_system_reset": ["request_approval_steps", "approval_steps", "request_comments", "attachments", "service_requests", "internal_message_attachments", "internal_message_recipients", "internal_messages", "audit_logs"],
    "clear_users_except_admin": ["users"],
}


def reset_preview(db: Session, scope: str) -> dict:
    if scope not in RESET_SCOPES:
        raise HTTPException(status_code=422, detail="نطاق إعادة الضبط غير صحيح")
    tables = []
    for table in RESET_SCOPES[scope]:
        if table == "users":
            count = int(db.execute(text("SELECT COUNT(*) FROM users WHERE role <> 'super_admin'")).scalar_one() or 0)
        else:
            count = table_count(db, table)
        tables.append({"table_name": table, "records_count": count})
    attachments = sum(item["records_count"] for item in tables if "attachment" in item["table_name"])
    users = next((item["records_count"] for item in tables if item["table_name"] == "users"), 0)
    warnings = ["سيتم إنشاء نسخة احتياطية كاملة تلقائياً قبل التنفيذ.", "لن يتم حذف ملفات النسخ الاحتياطية."]
    if scope == "full_system_reset":
        warnings.append("إعادة الضبط الكاملة محظورة في الإنتاج إلا عند تفعيل ALLOW_PRODUCTION_RESET=true.")
    if scope == "clear_users_except_admin":
        warnings.append("سيتم حذف المستخدمين غير مديري النظام ممن لا تمنعهم قيود قاعدة البيانات.")
    return {"scope": scope, "tables": tables, "attachments_affected": attachments, "users_affected": users, "settings_affected": 0, "warnings": warnings}


def delete_upload_files_for_scope() -> int:
    uploads = Path(settings.upload_dir)
    if not uploads.is_absolute():
        uploads = Path.cwd() / uploads
    deleted = 0
    for item in uploads.rglob("*") if uploads.exists() else []:
        if item.is_file() and "database_backups" not in item.parts and "restore_temp" not in item.parts:
            try:
                item.unlink()
                deleted += 1
            except Exception:
                pass
    return deleted


def execute_reset(db: Session, payload, actor: User) -> dict:
    if payload.scope not in RESET_SCOPES:
        raise HTTPException(status_code=422, detail="نطاق إعادة الضبط غير صحيح")
    if payload.confirmation_text != RESET_CONFIRMATION:
        raise HTTPException(status_code=422, detail="عبارة التأكيد غير صحيحة")
    if not payload.understand_risk:
        raise HTTPException(status_code=422, detail="يجب تأكيد فهم خطورة الإجراء")
    if not verify_password(payload.admin_password, actor.hashed_password):
        raise HTTPException(status_code=403, detail="كلمة مرور مدير النظام غير صحيحة")
    if settings.environment == "production" and os.getenv("ALLOW_PRODUCTION_RESET", "false").lower() != "true":
        raise HTTPException(status_code=409, detail="إعادة الضبط محظورة في بيئة الإنتاج ما لم يتم تفعيل ALLOW_PRODUCTION_RESET=true")
    preview = reset_preview(db, payload.scope)
    job = create_job(db, "reset", actor, "جاري إنشاء نسخة أمان قبل إعادة الضبط")
    try:
        create_backup(db, actor, "full_backup")
        if payload.scope in {"clear_requests_only", "reset_demo_data_only", "full_system_reset"}:
            db.execute(text("UPDATE internal_messages SET related_request_id = NULL WHERE related_request_id IS NOT NULL"))
        if payload.scope == "clear_users_except_admin":
            db.execute(text("DELETE FROM users WHERE role <> 'super_admin'"))
        else:
            for table in RESET_SCOPES[payload.scope]:
                db.execute(text(f"DELETE FROM {quote_table(table)}"))
        deleted_files = delete_upload_files_for_scope() if payload.delete_upload_files and payload.scope in {"clear_attachments_only", "full_system_reset"} else 0
        finish_job(db, job, "success", "تم تنفيذ إعادة الضبط", details={"scope": payload.scope, "deleted_files": deleted_files})
        write_audit(db, "reset_completed", "database", actor=actor, metadata={"scope": payload.scope, "preview": preview, "deleted_files": deleted_files})
        db.commit()
        return {"message": "تم تنفيذ إعادة الضبط", "job_id": job.id, "preview": preview, "deleted_files": deleted_files}
    except Exception as exc:
        finish_job(db, job, "failed", str(getattr(exc, "detail", exc))[:500], details={"scope": payload.scope})
        write_audit(db, "reset_completed", "database", actor=actor, metadata={"scope": payload.scope, "status": "failed", "error": str(getattr(exc, "detail", exc))[:300]})
        db.commit()
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(status_code=500, detail="فشلت عملية إعادة الضبط") from exc
