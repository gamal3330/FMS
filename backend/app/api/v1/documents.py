from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from uuid import uuid4

import anyio
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_user
from app.core.config import get_settings
from app.db.session import get_db
from app.models.document import (
    Document,
    DocumentAccessLog,
    DocumentAcknowledgement,
    DocumentCategory,
    DocumentPermission,
    DocumentVersion,
)
from app.models.enums import UserRole
from app.models.notification import Notification
from app.models.settings import SettingsGeneral
from app.models.user import Department, Role, ScreenPermission, User
from app.services.audit import write_audit
from app.services.realtime import notification_manager

router = APIRouter(prefix="/documents", tags=["Documents"])
settings = get_settings()

PDF_MIME_TYPES = {"application/pdf", "application/x-pdf", "application/octet-stream"}
PUBLIC_CLASSIFICATIONS = {"public", "internal"}
RESTRICTED_CLASSIFICATIONS = {"confidential", "top_secret"}
DOCUMENT_STATUSES = {"active", "archived", "draft"}
SCREEN_PERMISSION_LEVELS = ["no_access", "view", "create", "edit", "delete", "export", "manage"]


def screen_permission_level_allows(level: str | None, capability: str) -> bool:
    clean_level = level if level in SCREEN_PERMISSION_LEVELS else "no_access"
    return {
        "view": clean_level in {"view", "create", "edit", "delete", "export", "manage"},
        "create": clean_level in {"create", "edit", "delete", "manage"},
        "edit": clean_level in {"edit", "delete", "manage"},
        "delete": clean_level in {"delete", "manage"},
        "export": clean_level in {"export", "manage"},
        "manage": clean_level == "manage",
    }.get(capability, False)


class CategoryPayload(BaseModel):
    name_ar: str
    name_en: str | None = None
    code: str
    description: str | None = None
    icon: str | None = None
    color: str | None = None
    sort_order: int = 0
    is_active: bool = True


class CategoryStatusPayload(BaseModel):
    is_active: bool


class DocumentUpdatePayload(BaseModel):
    title_ar: str | None = None
    title_en: str | None = None
    category_id: int | None = None
    document_number: str | None = None
    description: str | None = None
    owner_department_id: int | None = None
    classification: str | None = None
    status: str | None = None
    requires_acknowledgement: bool | None = None
    keywords: str | None = None
    is_active: bool | None = None


class DocumentStatusPayload(BaseModel):
    status: str = "active"
    is_active: bool = True


class PermissionPayload(BaseModel):
    category_id: int | None = None
    document_id: int | None = None
    role_id: int | None = None
    department_id: int | None = None
    can_view: bool = True
    can_download: bool = True
    can_print: bool = True
    can_manage: bool = False


class AcknowledgementReminderPayload(BaseModel):
    department_id: int | None = None
    user_ids: list[int] | None = None


def client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


def request_user_agent(request: Request) -> str | None:
    return request.headers.get("user-agent")


def documents_root() -> Path:
    root = Path(settings.upload_dir).resolve() / "documents"
    root.mkdir(parents=True, exist_ok=True)
    return root


def stored_document_path(relative_path: str) -> Path:
    root = documents_root()
    candidate = (Path(settings.upload_dir).resolve() / relative_path).resolve()
    if root not in candidate.parents and candidate != root:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="مسار الملف غير صالح")
    return candidate


def parse_optional_date(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="صيغة التاريخ غير صحيحة") from exc


def max_upload_bytes(db: Session) -> int:
    general = db.scalar(select(SettingsGeneral).order_by(SettingsGeneral.id.asc()))
    max_mb = general.upload_max_file_size_mb if general else 10
    return max(int(max_mb or 10), 1) * 1024 * 1024


async def read_pdf_upload(db: Session, file: UploadFile) -> tuple[bytes, str]:
    filename = file.filename or "document.pdf"
    suffix = Path(filename).suffix.lower()
    if suffix != ".pdf":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="يسمح برفع ملفات PDF فقط")
    if file.content_type and file.content_type.lower() not in PDF_MIME_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="نوع الملف غير مسموح. يجب أن يكون PDF")
    content = await file.read()
    if not content.startswith(b"%PDF"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="الملف المرفوع ليس PDF صالحاً")
    if len(content) > max_upload_bytes(db):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="حجم الملف يتجاوز الحد الأقصى المسموح في إعدادات النظام")
    return content, filename


def save_pdf_file(content: bytes, original_filename: str) -> tuple[str, str, int]:
    stored_name = f"{uuid4().hex}.pdf"
    relative_path = f"documents/{stored_name}"
    target = documents_root() / stored_name
    target.write_bytes(content)
    checksum = sha256(content).hexdigest()
    return relative_path, checksum, len(content)


def role_ids_for_user(db: Session, user: User) -> list[int]:
    ids: list[int] = []
    if user.role_id:
        ids.append(user.role_id)
    role = db.scalar(select(Role).where(or_(Role.code == str(user.role), Role.name == str(user.role))))
    if role and role.id not in ids:
        ids.append(role.id)
    return ids


def has_document_settings_permission(db: Session, user: User, capability: str = "manage") -> bool:
    if user.role == UserRole.SUPER_ADMIN:
        return True
    role_ids = role_ids_for_user(db, user)
    subject_filters = [ScreenPermission.user_id == user.id]
    if role_ids:
        subject_filters.append(ScreenPermission.role_id.in_(role_ids))
    rows = db.scalars(
        select(ScreenPermission)
        .where(
            ScreenPermission.screen_code.in_(["document_settings", "documents"]),
            or_(*subject_filters),
        )
    ).all()
    user_rows = [row for row in rows if row.user_id == user.id]
    effective_rows = user_rows or rows
    return any(
        bool(getattr(row, f"can_{capability}", False)) or screen_permission_level_allows(row.permission_level, capability)
        for row in effective_rows
    )


def is_document_admin(db: Session, user: User) -> bool:
    if user.role == UserRole.SUPER_ADMIN:
        return True
    if has_document_settings_permission(db, user, "manage"):
        return True
    role_ids = role_ids_for_user(db, user)
    clauses = [DocumentPermission.can_manage == True]
    subject_filters = []
    if user.department_id:
        subject_filters.append(DocumentPermission.department_id == user.department_id)
    if role_ids:
        subject_filters.append(DocumentPermission.role_id.in_(role_ids))
    if not subject_filters:
        return False
    return bool(db.scalar(select(DocumentPermission.id).where(and_(*clauses), or_(*subject_filters)).limit(1)))


def permission_rows_for_document(db: Session, user: User, document: Document) -> list[DocumentPermission]:
    role_ids = role_ids_for_user(db, user)
    subject_filters = []
    if user.department_id:
        subject_filters.append(DocumentPermission.department_id == user.department_id)
    if role_ids:
        subject_filters.append(DocumentPermission.role_id.in_(role_ids))
    if not subject_filters:
        return []
    return db.scalars(
        select(DocumentPermission).where(
            or_(DocumentPermission.document_id == document.id, DocumentPermission.category_id == document.category_id),
            or_(*subject_filters),
        )
    ).all()


def can_access_document(db: Session, user: User, document: Document, action: str = "view") -> bool:
    if user.role == UserRole.SUPER_ADMIN:
        return True
    if has_document_settings_permission(db, user, "manage"):
        return True
    if not document.is_active or document.status == "archived":
        return False
    rows = permission_rows_for_document(db, user, document)
    field = {
        "view": "can_view",
        "download": "can_download",
        "print": "can_print",
        "manage": "can_manage",
        "versions": "can_manage",
        "logs": "can_manage",
    }.get(action, "can_view")
    if rows and any(bool(getattr(row, field, False)) or bool(row.can_manage) for row in rows):
        return True
    if action == "view" and document.classification in PUBLIC_CLASSIFICATIONS:
        return True
    if action in {"download", "print"} and document.classification in PUBLIC_CLASSIFICATIONS:
        return True
    return False


def require_document_access(db: Session, user: User, document: Document, action: str = "view") -> None:
    if not can_access_document(db, user, document, action):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="لا تملك صلاحية الوصول إلى هذه الوثيقة")


def require_document_manager(db: Session, user: User) -> None:
    if not is_document_admin(db, user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="لا تملك صلاحية إدارة الوثائق")


def log_document_action(
    db: Session,
    request: Request,
    user: User,
    document: Document,
    action: str,
    version: DocumentVersion | None = None,
    audit_action: str | None = None,
) -> None:
    db.add(
        DocumentAccessLog(
            document_id=document.id,
            version_id=version.id if version else None,
            user_id=user.id,
            action=action,
            ip_address=client_ip(request),
            user_agent=request_user_agent(request),
        )
    )
    write_audit(
        db,
        audit_action or f"document_{action}",
        "document",
        actor=user,
        entity_id=str(document.id),
        ip_address=client_ip(request),
        user_agent=request_user_agent(request),
        metadata={"version_id": version.id if version else None, "classification": document.classification},
    )


def broadcast_notification(user_ids: list[int], payload: dict) -> None:
    if not user_ids:
        return
    try:
        anyio.from_thread.run(notification_manager.broadcast_to_users, user_ids, payload)
    except RuntimeError:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        loop.create_task(notification_manager.broadcast_to_users(user_ids, payload))


def document_summary(db: Session, document: Document, user: User) -> dict:
    version = document.current_version
    acknowledged = False
    if version:
        acknowledged = bool(
            db.scalar(
                select(DocumentAcknowledgement.id).where(
                    DocumentAcknowledgement.document_id == document.id,
                    DocumentAcknowledgement.version_id == version.id,
                    DocumentAcknowledgement.user_id == user.id,
                )
            )
        )
    return {
        "id": document.id,
        "title_ar": document.title_ar,
        "title_en": document.title_en,
        "document_number": document.document_number,
        "description": document.description,
        "classification": document.classification,
        "status": document.status,
        "requires_acknowledgement": document.requires_acknowledgement,
        "keywords": document.keywords,
        "is_active": document.is_active,
        "created_at": document.created_at,
        "updated_at": document.updated_at,
        "category": {
            "id": document.category.id,
            "name_ar": document.category.name_ar,
            "name_en": document.category.name_en,
            "code": document.category.code,
            "color": document.category.color,
            "icon": document.category.icon,
        },
        "owner_department": {
            "id": document.owner_department.id,
            "name_ar": document.owner_department.name_ar,
            "name_en": document.owner_department.name_en,
        } if document.owner_department else None,
        "current_version": version_summary(version) if version else None,
        "acknowledged": acknowledged,
        "capabilities": {
            "can_view": can_access_document(db, user, document, "view"),
            "can_download": can_access_document(db, user, document, "download"),
            "can_print": can_access_document(db, user, document, "print"),
            "can_manage": can_access_document(db, user, document, "manage"),
        },
    }


def version_summary(version: DocumentVersion | None) -> dict | None:
    if not version:
        return None
    return {
        "id": version.id,
        "version_number": version.version_number,
        "file_name": version.file_name,
        "file_size": version.file_size,
        "mime_type": version.mime_type,
        "checksum": version.checksum,
        "issue_date": version.issue_date,
        "effective_date": version.effective_date,
        "review_date": version.review_date,
        "uploaded_at": version.uploaded_at,
        "change_summary": version.change_summary,
        "is_current": version.is_current,
    }


def permission_summary(row: DocumentPermission) -> dict:
    return {
        "id": row.id,
        "category": {"id": row.category.id, "name_ar": row.category.name_ar} if row.category else None,
        "document": {"id": row.document.id, "title_ar": row.document.title_ar} if row.document else None,
        "role": {"id": row.role.id, "name_ar": row.role.name_ar or row.role.label_ar, "code": row.role.code} if row.role else None,
        "department": {"id": row.department.id, "name_ar": row.department.name_ar} if row.department else None,
        "category_id": row.category_id,
        "document_id": row.document_id,
        "role_id": row.role_id,
        "department_id": row.department_id,
        "can_view": row.can_view,
        "can_download": row.can_download,
        "can_print": row.can_print,
        "can_manage": row.can_manage,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def user_summary(user: User | None) -> dict | None:
    if not user:
        return None
    return {
        "id": user.id,
        "full_name_ar": user.full_name_ar,
        "full_name_en": user.full_name_en,
        "email": user.email,
        "username": user.username,
        "department": {"id": user.department.id, "name_ar": user.department.name_ar} if user.department else None,
    }


def get_document_or_404(db: Session, document_id: int) -> Document:
    document = db.scalar(
        select(Document)
        .where(Document.id == document_id)
        .options(selectinload(Document.category), selectinload(Document.owner_department), selectinload(Document.current_version))
    )
    if not document:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="الوثيقة غير موجودة")
    return document


@router.get("/categories")
def list_categories(
    include_inactive: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = select(DocumentCategory).order_by(DocumentCategory.sort_order, DocumentCategory.name_ar)
    if not include_inactive:
        query = query.where(DocumentCategory.is_active == True)
    categories = db.scalars(query).all()
    rows = []
    for category in categories:
        category_documents = db.scalars(
            select(Document)
            .where(Document.category_id == category.id, Document.is_active == True)
            .options(selectinload(Document.category), selectinload(Document.owner_department), selectinload(Document.current_version))
        ).all()
        accessible_documents = [document for document in category_documents if can_access_document(db, current_user, document, "view")]
        documents_count = len(accessible_documents)
        last_updated = max((document.updated_at for document in accessible_documents if document.updated_at), default=None)
        rows.append(
            {
                "id": category.id,
                "name_ar": category.name_ar,
                "name_en": category.name_en,
                "code": category.code,
                "description": category.description,
                "icon": category.icon,
                "color": category.color,
                "sort_order": category.sort_order,
                "is_active": category.is_active,
                "documents_count": documents_count,
                "last_updated_at": last_updated,
            }
        )
    return rows


@router.post("/categories")
def create_category(payload: CategoryPayload, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_document_manager(db, current_user)
    if db.scalar(select(DocumentCategory.id).where(DocumentCategory.code == payload.code)):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="رمز التصنيف مستخدم مسبقاً")
    category = DocumentCategory(**payload.model_dump())
    db.add(category)
    db.flush()
    write_audit(db, "document_category_created", "document_category", actor=current_user, entity_id=str(category.id), ip_address=client_ip(request), user_agent=request_user_agent(request), metadata=payload.model_dump())
    db.commit()
    db.refresh(category)
    return category


@router.put("/categories/{category_id}")
def update_category(category_id: int, payload: CategoryPayload, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_document_manager(db, current_user)
    category = db.get(DocumentCategory, category_id)
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="التصنيف غير موجود")
    duplicate = db.scalar(select(DocumentCategory.id).where(DocumentCategory.code == payload.code, DocumentCategory.id != category_id))
    if duplicate:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="رمز التصنيف مستخدم مسبقاً")
    old_value = {"name_ar": category.name_ar, "code": category.code, "is_active": category.is_active}
    for key, value in payload.model_dump().items():
        setattr(category, key, value)
    write_audit(db, "document_category_updated", "document_category", actor=current_user, entity_id=str(category.id), ip_address=client_ip(request), user_agent=request_user_agent(request), metadata={"old": old_value, "new": payload.model_dump()})
    db.commit()
    db.refresh(category)
    return category


@router.patch("/categories/{category_id}/status")
def update_category_status(category_id: int, payload: CategoryStatusPayload, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_document_manager(db, current_user)
    category = db.get(DocumentCategory, category_id)
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="التصنيف غير موجود")
    category.is_active = payload.is_active
    write_audit(db, "document_category_status_updated", "document_category", actor=current_user, entity_id=str(category.id), ip_address=client_ip(request), user_agent=request_user_agent(request), metadata={"is_active": payload.is_active})
    db.commit()
    return category


@router.get("")
def list_documents(
    q: str | None = Query(default=None),
    category_code: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    classification: str | None = Query(default=None),
    owner_department_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = (
        select(Document)
        .join(DocumentCategory)
        .options(selectinload(Document.category), selectinload(Document.owner_department), selectinload(Document.current_version))
        .order_by(Document.updated_at.desc(), Document.id.desc())
    )
    if category_code:
        query = query.where(DocumentCategory.code == category_code)
    if status_filter:
        query = query.where(Document.status == status_filter)
    if classification:
        query = query.where(Document.classification == classification)
    if owner_department_id:
        query = query.where(Document.owner_department_id == owner_department_id)
    if q:
        like = f"%{q.strip()}%"
        query = query.where(or_(Document.title_ar.ilike(like), Document.title_en.ilike(like), Document.document_number.ilike(like), Document.keywords.ilike(like), DocumentCategory.name_ar.ilike(like)))
    documents = db.scalars(query).all()
    return [document_summary(db, item, current_user) for item in documents if can_access_document(db, current_user, item, "view")]


@router.get("/search")
def search_documents(q: str = Query(default=""), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return list_documents(q=q, category_code=None, status_filter=None, classification=None, owner_department_id=None, db=db, current_user=current_user)


@router.get("/settings/bootstrap")
def document_settings_bootstrap(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_document_manager(db, current_user)
    categories = list_categories(include_inactive=True, db=db, current_user=current_user)
    documents = list_documents(
        q=None,
        category_code=None,
        status_filter=None,
        classification=None,
        owner_department_id=None,
        db=db,
        current_user=current_user,
    )
    departments = db.scalars(select(Department).order_by(Department.name_ar)).all()
    roles = db.scalars(select(Role).where(Role.is_active == True).order_by(Role.label_ar)).all()
    permission_rows = db.scalars(
        select(DocumentPermission).options(
            selectinload(DocumentPermission.category),
            selectinload(DocumentPermission.document),
            selectinload(DocumentPermission.role),
            selectinload(DocumentPermission.department),
        )
    ).all()
    return {
        "categories": categories,
        "documents": documents,
        "departments": departments,
        "roles": [
            {
                "id": role.id,
                "name": role.name,
                "name_ar": role.name_ar or role.label_ar,
                "label_ar": role.label_ar,
                "name_en": role.name_en,
                "code": role.code or role.name,
            }
            for role in roles
        ],
        "permissions": [permission_summary(row) for row in permission_rows],
    }






@router.get("/{document_id:int}")
def get_document(document_id: int, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    document = get_document_or_404(db, document_id)
    require_document_access(db, current_user, document, "view")
    log_document_action(db, request, current_user, document, "viewed", document.current_version, "document_viewed")
    db.commit()
    return document_summary(db, document, current_user)


@router.post("")
async def create_document(
    request: Request,
    title_ar: str = Form(...),
    title_en: str | None = Form(default=None),
    category_id: int = Form(...),
    document_number: str | None = Form(default=None),
    description: str | None = Form(default=None),
    owner_department_id: int | None = Form(default=None),
    classification: str = Form(default="internal"),
    issue_date: str | None = Form(default=None),
    effective_date: str | None = Form(default=None),
    review_date: str | None = Form(default=None),
    requires_acknowledgement: bool = Form(default=False),
    keywords: str | None = Form(default=None),
    change_summary: str | None = Form(default=None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    require_document_manager(db, current_user)
    category = db.get(DocumentCategory, category_id)
    if not category or not category.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="التصنيف غير صالح أو غير مفعل")
    if classification not in PUBLIC_CLASSIFICATIONS | RESTRICTED_CLASSIFICATIONS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="درجة السرية غير صحيحة")
    content, original_filename = await read_pdf_upload(db, file)
    relative_path, checksum, size = save_pdf_file(content, original_filename)
    document = Document(
        category_id=category_id,
        title_ar=title_ar.strip(),
        title_en=title_en,
        document_number=document_number,
        description=description,
        owner_department_id=owner_department_id,
        classification=classification,
        status="active",
        requires_acknowledgement=requires_acknowledgement,
        keywords=keywords,
        created_by=current_user.id,
        is_active=True,
    )
    db.add(document)
    db.flush()
    version = DocumentVersion(
        document_id=document.id,
        version_number=1,
        file_name=original_filename,
        file_path=relative_path,
        file_size=size,
        mime_type="application/pdf",
        checksum=checksum,
        issue_date=parse_optional_date(issue_date),
        effective_date=parse_optional_date(effective_date),
        review_date=parse_optional_date(review_date),
        uploaded_by=current_user.id,
        change_summary=change_summary,
        is_current=True,
    )
    db.add(version)
    db.flush()
    document.current_version_id = version.id
    log_document_action(db, request, current_user, document, "uploaded", version, "document_uploaded")
    db.commit()
    db.refresh(document)
    return document_summary(db, get_document_or_404(db, document.id), current_user)


@router.put("/{document_id:int}")
def update_document(document_id: int, payload: DocumentUpdatePayload, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    document = get_document_or_404(db, document_id)
    require_document_access(db, current_user, document, "manage")
    old_value = document_summary(db, document, current_user)
    updates = payload.model_dump(exclude_unset=True)
    if "classification" in updates and updates["classification"] not in PUBLIC_CLASSIFICATIONS | RESTRICTED_CLASSIFICATIONS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="درجة السرية غير صحيحة")
    if "status" in updates and updates["status"] not in DOCUMENT_STATUSES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="حالة الوثيقة غير صحيحة")
    for key, value in updates.items():
        setattr(document, key, value)
    log_document_action(db, request, current_user, document, "updated", document.current_version, "document_updated")
    write_audit(db, "document_metadata_updated", "document", actor=current_user, entity_id=str(document.id), ip_address=client_ip(request), user_agent=request_user_agent(request), metadata={"old": old_value, "new": updates})
    db.commit()
    return document_summary(db, get_document_or_404(db, document.id), current_user)


@router.patch("/{document_id:int}/status")
def update_document_status(document_id: int, payload: DocumentStatusPayload, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    document = get_document_or_404(db, document_id)
    require_document_access(db, current_user, document, "manage")
    if payload.status not in DOCUMENT_STATUSES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="حالة الوثيقة غير صحيحة")
    document.status = payload.status
    document.is_active = payload.is_active
    log_document_action(db, request, current_user, document, "archived" if payload.status == "archived" else "status_updated", document.current_version, "document_archived" if payload.status == "archived" else "document_status_updated")
    db.commit()
    return document_summary(db, get_document_or_404(db, document.id), current_user)


@router.get("/{document_id:int}/versions")
def list_versions(document_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    document = get_document_or_404(db, document_id)
    require_document_access(db, current_user, document, "view")
    if not can_access_document(db, current_user, document, "versions") and document.classification in RESTRICTED_CLASSIFICATIONS:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="لا تملك صلاحية عرض إصدارات هذه الوثيقة")
    versions = db.scalars(select(DocumentVersion).where(DocumentVersion.document_id == document.id).order_by(DocumentVersion.version_number.desc())).all()
    return [version_summary(version) for version in versions]


@router.post("/{document_id:int}/versions")
async def upload_version(
    document_id: int,
    request: Request,
    issue_date: str | None = Form(default=None),
    effective_date: str | None = Form(default=None),
    review_date: str | None = Form(default=None),
    change_summary: str | None = Form(default=None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    document = get_document_or_404(db, document_id)
    require_document_access(db, current_user, document, "manage")
    content, original_filename = await read_pdf_upload(db, file)
    relative_path, checksum, size = save_pdf_file(content, original_filename)
    last_version = db.scalar(select(func.max(DocumentVersion.version_number)).where(DocumentVersion.document_id == document.id)) or 0
    db.query(DocumentVersion).filter(DocumentVersion.document_id == document.id).update({"is_current": False})
    version = DocumentVersion(
        document_id=document.id,
        version_number=last_version + 1,
        file_name=original_filename,
        file_path=relative_path,
        file_size=size,
        mime_type="application/pdf",
        checksum=checksum,
        issue_date=parse_optional_date(issue_date),
        effective_date=parse_optional_date(effective_date),
        review_date=parse_optional_date(review_date),
        uploaded_by=current_user.id,
        change_summary=change_summary,
        is_current=True,
    )
    db.add(version)
    db.flush()
    document.current_version_id = version.id
    log_document_action(db, request, current_user, document, "version_uploaded", version, "document_version_uploaded")
    db.commit()
    return version_summary(version)


@router.post("/{document_id:int}/versions/{version_id:int}/set-current")
def set_current_version(document_id: int, version_id: int, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    document = get_document_or_404(db, document_id)
    require_document_access(db, current_user, document, "manage")
    version = db.scalar(select(DocumentVersion).where(DocumentVersion.document_id == document.id, DocumentVersion.id == version_id))
    if not version:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="الإصدار غير موجود")
    db.query(DocumentVersion).filter(DocumentVersion.document_id == document.id).update({"is_current": False})
    version.is_current = True
    document.current_version_id = version.id
    log_document_action(db, request, current_user, document, "version_set_current", version, "document_version_set_current")
    db.commit()
    return version_summary(version)


def document_file_response(db: Session, request: Request, current_user: User, document_id: int, action: str, inline: bool) -> FileResponse:
    document = get_document_or_404(db, document_id)
    require_document_access(db, current_user, document, action)
    version = document.current_version
    if not version:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="لا يوجد ملف PDF لهذه الوثيقة")
    path = stored_document_path(version.file_path)
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ملف الوثيقة غير موجود على الخادم")
    log_document_action(db, request, current_user, document, "printed" if action == "print" else action, version, f"document_{'printed' if action == 'print' else action}ed")
    db.commit()
    return FileResponse(
        path,
        media_type="application/pdf",
        filename=version.file_name,
        content_disposition_type="inline" if inline else "attachment",
    )


@router.get("/{document_id:int}/preview")
def preview_document(document_id: int, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return document_file_response(db, request, current_user, document_id, "view", inline=True)


@router.get("/{document_id:int}/download")
def download_document(document_id: int, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return document_file_response(db, request, current_user, document_id, "download", inline=False)


@router.get("/{document_id:int}/print")
def print_document(document_id: int, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return document_file_response(db, request, current_user, document_id, "print", inline=True)


@router.post("/{document_id:int}/acknowledge")
def acknowledge_document(document_id: int, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    document = get_document_or_404(db, document_id)
    require_document_access(db, current_user, document, "view")
    if not document.requires_acknowledgement:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="هذه الوثيقة لا تتطلب إقرار اطلاع")
    if not document.current_version:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="لا يوجد إصدار حالي للوثيقة")
    existing = db.scalar(
        select(DocumentAcknowledgement).where(
            DocumentAcknowledgement.document_id == document.id,
            DocumentAcknowledgement.version_id == document.current_version.id,
            DocumentAcknowledgement.user_id == current_user.id,
        )
    )
    if not existing:
        db.add(DocumentAcknowledgement(document_id=document.id, version_id=document.current_version.id, user_id=current_user.id))
    log_document_action(db, request, current_user, document, "acknowledged", document.current_version, "document_acknowledged")
    db.commit()
    return {"ok": True, "message": "تم تسجيل إقرار الاطلاع"}


@router.get("/{document_id:int}/acknowledgements")
def list_acknowledgements(document_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    document = get_document_or_404(db, document_id)
    require_document_access(db, current_user, document, "manage")
    rows = db.scalars(
        select(DocumentAcknowledgement)
        .where(DocumentAcknowledgement.document_id == document.id)
        .options(selectinload(DocumentAcknowledgement.user), selectinload(DocumentAcknowledgement.version))
        .order_by(DocumentAcknowledgement.acknowledged_at.desc())
    ).all()
    return [
        {
            "id": row.id,
            "acknowledged_at": row.acknowledged_at,
            "user": user_summary(row.user),
            "version": version_summary(row.version),
        }
        for row in rows
    ]


def build_acknowledgement_report(db: Session, document: Document, department_id: int | None = None) -> dict:
    version = document.current_version
    if not version:
        return {
            "document": {"id": document.id, "title_ar": document.title_ar, "requires_acknowledgement": document.requires_acknowledgement},
            "version": None,
            "total": 0,
            "acknowledged_count": 0,
            "pending_count": 0,
            "acknowledged": [],
            "pending": [],
        }

    acknowledgements = db.scalars(
        select(DocumentAcknowledgement)
        .where(DocumentAcknowledgement.document_id == document.id, DocumentAcknowledgement.version_id == version.id)
        .options(selectinload(DocumentAcknowledgement.user).selectinload(User.department), selectinload(DocumentAcknowledgement.version))
        .order_by(DocumentAcknowledgement.acknowledged_at.desc())
    ).all()
    acknowledged_by_user = {row.user_id: row for row in acknowledgements}

    if not document.requires_acknowledgement:
        return {
            "document": {"id": document.id, "title_ar": document.title_ar, "requires_acknowledgement": False},
            "version": version_summary(version),
            "total": 0,
            "acknowledged_count": 0,
            "pending_count": 0,
            "acknowledged": [
                {
                    "id": row.id,
                    "acknowledged_at": row.acknowledged_at,
                    "user": user_summary(row.user),
                    "version": version_summary(row.version),
                }
                for row in acknowledgements
            ],
            "pending": [],
        }

    users_query = select(User).where(User.is_active == True).options(selectinload(User.department))
    if department_id:
        users_query = users_query.where(User.department_id == department_id)
    eligible_users = [user for user in db.scalars(users_query).all() if can_access_document(db, user, document, "view")]
    acknowledged_rows = [acknowledged_by_user[user.id] for user in eligible_users if user.id in acknowledged_by_user]
    pending_users = [user for user in eligible_users if user.id not in acknowledged_by_user]

    return {
        "document": {"id": document.id, "title_ar": document.title_ar, "requires_acknowledgement": True},
        "version": version_summary(version),
        "total": len(eligible_users),
        "acknowledged_count": len(acknowledged_rows),
        "pending_count": len(pending_users),
        "acknowledged": [
            {
                "id": row.id,
                "acknowledged_at": row.acknowledged_at,
                "user": user_summary(row.user),
                "version": version_summary(row.version),
            }
            for row in acknowledged_rows
        ],
        "pending": [{"user": user_summary(user)} for user in pending_users],
    }


@router.get("/{document_id:int}/acknowledgements/report")
def get_acknowledgement_report(
    document_id: int,
    department_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    document = get_document_or_404(db, document_id)
    require_document_access(db, current_user, document, "manage")
    return build_acknowledgement_report(db, document, department_id)


@router.post("/{document_id:int}/acknowledgements/remind")
def remind_pending_acknowledgements(
    document_id: int,
    payload: AcknowledgementReminderPayload,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    document = get_document_or_404(db, document_id)
    require_document_access(db, current_user, document, "manage")
    if not document.requires_acknowledgement:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="هذه الوثيقة لا تتطلب إقرار اطلاع")
    report = build_acknowledgement_report(db, document, payload.department_id)
    pending_user_ids = {item["user"]["id"] for item in report["pending"] if item.get("user")}
    if payload.user_ids:
        pending_user_ids = pending_user_ids.intersection(set(payload.user_ids))
    for user_id in pending_user_ids:
        db.add(
            Notification(
                user_id=user_id,
                title="تذكير بإقرار الاطلاع",
                body=f"يرجى الاطلاع على الوثيقة «{document.title_ar}» وتسجيل إقرار الاطلاع من مكتبة الوثائق.",
                channel="in_app",
            )
        )
    broadcast_notification(
        list(pending_user_ids),
        {
            "type": "notification",
            "title": "تذكير بإقرار الاطلاع",
            "body": f"يرجى الاطلاع على الوثيقة «{document.title_ar}» وتسجيل إقرار الاطلاع.",
            "related_route": f"/documents/{document.id}",
            "created_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    write_audit(
        db,
        "document_acknowledgement_reminder_sent",
        "document",
        actor=current_user,
        entity_id=str(document.id),
        ip_address=client_ip(request),
        user_agent=request_user_agent(request),
        metadata={"sent_count": len(pending_user_ids), "department_id": payload.department_id},
    )
    db.commit()
    return {"sent_count": len(pending_user_ids)}


@router.get("/{document_id:int}/access-logs")
def list_access_logs(document_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    document = get_document_or_404(db, document_id)
    require_document_access(db, current_user, document, "logs")
    rows = db.scalars(
        select(DocumentAccessLog)
        .where(DocumentAccessLog.document_id == document.id)
        .options(selectinload(DocumentAccessLog.user))
        .order_by(DocumentAccessLog.created_at.desc())
        .limit(200)
    ).all()
    return [
        {
            "id": row.id,
            "action": row.action,
            "created_at": row.created_at,
            "ip_address": row.ip_address,
            "user_agent": row.user_agent,
            "user": {"id": row.user.id, "full_name_ar": row.user.full_name_ar, "email": row.user.email} if row.user else None,
        }
        for row in rows
    ]


@router.get("/permissions/list")
def list_permissions(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_document_manager(db, current_user)
    rows = db.scalars(select(DocumentPermission).options(selectinload(DocumentPermission.category), selectinload(DocumentPermission.document), selectinload(DocumentPermission.role), selectinload(DocumentPermission.department))).all()
    return [permission_summary(row) for row in rows]


@router.post("/permissions")
def create_permission(payload: PermissionPayload, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_document_manager(db, current_user)
    if not any([payload.category_id, payload.document_id]):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="يجب تحديد تصنيف أو وثيقة")
    if not any([payload.role_id, payload.department_id]):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="يجب تحديد دور أو إدارة")
    row = DocumentPermission(**payload.model_dump())
    db.add(row)
    db.flush()
    write_audit(db, "document_permission_changed", "document_permission", actor=current_user, entity_id=str(row.id), ip_address=client_ip(request), user_agent=request_user_agent(request), metadata=payload.model_dump())
    db.commit()
    db.refresh(row)
    return permission_summary(
        db.scalar(
            select(DocumentPermission)
            .where(DocumentPermission.id == row.id)
            .options(selectinload(DocumentPermission.category), selectinload(DocumentPermission.document), selectinload(DocumentPermission.role), selectinload(DocumentPermission.department))
        )
    )


@router.put("/permissions/{permission_id:int}")
def update_permission(permission_id: int, payload: PermissionPayload, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_document_manager(db, current_user)
    if not any([payload.category_id, payload.document_id]):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="يجب تحديد تصنيف أو وثيقة")
    if not any([payload.role_id, payload.department_id]):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="يجب تحديد دور أو إدارة")
    row = db.scalar(
        select(DocumentPermission)
        .where(DocumentPermission.id == permission_id)
        .options(selectinload(DocumentPermission.category), selectinload(DocumentPermission.document), selectinload(DocumentPermission.role), selectinload(DocumentPermission.department))
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="صلاحية الوثيقة غير موجودة")
    old_value = permission_summary(row)
    for key, value in payload.model_dump().items():
        setattr(row, key, value)
    db.flush()
    write_audit(db, "document_permission_changed", "document_permission", actor=current_user, entity_id=str(row.id), ip_address=client_ip(request), user_agent=request_user_agent(request), metadata={"old": old_value, "new": payload.model_dump()})
    db.commit()
    return permission_summary(
        db.scalar(
            select(DocumentPermission)
            .where(DocumentPermission.id == row.id)
            .options(selectinload(DocumentPermission.category), selectinload(DocumentPermission.document), selectinload(DocumentPermission.role), selectinload(DocumentPermission.department))
        )
    )


@router.delete("/permissions/{permission_id:int}")
def delete_permission(permission_id: int, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_document_manager(db, current_user)
    row = db.scalar(
        select(DocumentPermission)
        .where(DocumentPermission.id == permission_id)
        .options(selectinload(DocumentPermission.category), selectinload(DocumentPermission.document), selectinload(DocumentPermission.role), selectinload(DocumentPermission.department))
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="صلاحية الوثيقة غير موجودة")
    old_value = permission_summary(row)
    db.delete(row)
    write_audit(db, "document_permission_deleted", "document_permission", actor=current_user, entity_id=str(permission_id), ip_address=client_ip(request), user_agent=request_user_agent(request), metadata={"old": old_value})
    db.commit()
    return {"ok": True}
