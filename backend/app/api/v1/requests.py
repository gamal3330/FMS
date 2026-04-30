from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from uuid import uuid4
from zoneinfo import ZoneInfo

import arabic_reshaper
from bidi.algorithm import get_display
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse, StreamingResponse
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_user
from app.core.config import get_settings
from app.db.session import get_db
from app.models.enums import ApprovalAction, RequestStatus, RequestType, UserRole
from app.models.request import ApprovalStep, Attachment, RequestComment, ServiceRequest
from app.models.settings import RequestTypeField, RequestTypeSetting, SettingsGeneral
from app.models.user import User
from app.schemas.request import ApprovalDecision, AttachmentRead, CommentCreate, ServiceRequestCreate, ServiceRequestRead, ServiceRequestUpdate
from app.services.audit import write_audit
from app.services.workflow import (
    IMPLEMENTATION_STEP_ROLES,
    advance_workflow,
    create_approval_steps,
    next_request_number,
    reset_workflow_for_resubmission,
    step_can_return_for_edit,
)
from app.api.v1.request_type_management import create_snapshot_steps, validate_form_data

router = APIRouter(prefix="/requests", tags=["Service Requests"])
settings = get_settings()
PDF_FONT = "ArabicRequestPdfFont"

STATUS_LABELS = {
    "draft": "مسودة",
    "submitted": "مرسل",
    "pending_approval": "بانتظار الموافقة",
    "approved": "معتمد",
    "rejected": "مرفوض",
    "in_implementation": "قيد التنفيذ",
    "completed": "مكتمل",
    "closed": "مغلق",
    "cancelled": "ملغي",
}
PRIORITY_LABELS = {"low": "منخفضة", "medium": "متوسطة", "high": "عالية", "critical": "حرجة"}
ACTION_LABELS = {"pending": "بانتظار الإجراء", "approved": "تمت الموافقة", "rejected": "تم الرفض", "returned_for_edit": "أعيد للتعديل", "skipped": "تم التجاوز"}
ROLE_LABELS = {
    "direct_manager": "المدير المباشر",
    "information_security": "أمن المعلومات",
    "it_manager": "مدير تقنية المعلومات",
    "it_staff": "فريق تقنية المعلومات",
    "executive_management": "الإدارة التنفيذية",
    "implementation_engineer": "مهندس التنفيذ",
    "implementation": "التنفيذ",
    "execution": "التنفيذ",
}
FIELD_LABELS = {
    "assigned_section": "القسم المختص",
    "administrative_section": "القسم المختص",
    "assigned_section_label": "القسم المختص",
    "administrative_section_label": "القسم المختص",
    "request_type_code": "رمز نوع الطلب",
    "request_type_label": "نوع الطلب",
    "reason": "المبرر",
    "issue_description": "وصف المشكلة",
}

ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
}
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
SECTION_KEYWORDS = {
    "servers": ["server", "servers", "srv", "سيرفر", "خوادم"],
    "networks": ["network", "networks", "net", "شبكة", "شبكات"],
    "support": ["support", "helpdesk", "دعم", "فني"],
    "development": ["development", "software", "dev", "تطوير", "برامج"],
}


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
        select(func.count())
        .select_from(User)
        .where(User.role == UserRole.IT_STAFF, User.is_active == True, User.administrative_section == request_section)
    ) or 0
    return section_staff_count == 0


def request_query():
    return select(ServiceRequest).options(
        selectinload(ServiceRequest.requester).selectinload(User.department),
        selectinload(ServiceRequest.department),
        selectinload(ServiceRequest.approvals).selectinload(ApprovalStep.approver),
        selectinload(ServiceRequest.comments),
        selectinload(ServiceRequest.attachments),
    )


def ensure_request_access(service_request: ServiceRequest, current_user: User, db: Session | None = None) -> None:
    if current_user.role in {UserRole.SUPER_ADMIN, UserRole.IT_MANAGER}:
        return
    if service_request.requester_id == current_user.id:
        return
    if current_user.role == UserRole.DIRECT_MANAGER and service_request.requester and service_request.requester.manager_id == current_user.id:
        return
    if current_user.role != UserRole.IT_STAFF and any(step.role == current_user.role for step in service_request.approvals):
        return
    if current_user.role == UserRole.IT_STAFF and any(step.role in IMPLEMENTATION_STEP_ROLES for step in service_request.approvals):
        if request_matches_it_staff_section(service_request, current_user) or (db and unassigned_it_staff_can_cover_request(db, service_request, current_user)):
            return
    if current_user.role == UserRole.IT_STAFF and any(step.role == UserRole.IT_STAFF for step in service_request.approvals):
        if request_matches_it_staff_section(service_request, current_user):
            return
    raise HTTPException(status_code=403, detail="Insufficient permissions")


def enrich_approval_steps(db: Session, service_request: ServiceRequest | None) -> ServiceRequest | None:
    if not service_request:
        return service_request
    for step in service_request.approvals or []:
        step.can_return_for_edit = step.action == ApprovalAction.PENDING and step_can_return_for_edit(db, service_request, step)
    return service_request


def enrich_request_list(db: Session, requests: list[ServiceRequest]) -> list[ServiceRequest]:
    for service_request in requests:
        enrich_approval_steps(db, service_request)
    return requests


def register_pdf_font() -> str:
    candidates = [
        Path("C:/Windows/Fonts/tajawal.ttf"),
        Path("C:/Windows/Fonts/Tajawal-Regular.ttf"),
        Path("C:/Windows/Fonts/arial.ttf"),
        Path("C:/Windows/Fonts/tahoma.ttf"),
        Path("C:/Windows/Fonts/calibri.ttf"),
        Path("/usr/share/fonts/truetype/noto/NotoNaskhArabic-Regular.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    ]
    for path in candidates:
        if path.exists():
            if PDF_FONT not in pdfmetrics.getRegisteredFontNames():
                pdfmetrics.registerFont(TTFont(PDF_FONT, str(path)))
            return PDF_FONT
    return "Helvetica"


def rtl(text: object) -> str:
    return get_display(arabic_reshaper.reshape(str(text or "")))


def label(value: object, labels: dict[str, str]) -> str:
    return labels.get(str(value or ""), str(value or ""))


def system_timezone(db: Session) -> ZoneInfo:
    general = db.scalar(select(SettingsGeneral).limit(1))
    try:
        return ZoneInfo(general.timezone if general and general.timezone else "Asia/Qatar")
    except Exception:
        return ZoneInfo("Asia/Qatar")


def format_pdf_datetime(value: datetime | None, tz: ZoneInfo) -> str:
    if not value:
        return "-"
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(tz).strftime("%Y/%m/%d %H:%M")


def logo_file_path(db: Session) -> Path | None:
    general = db.scalar(select(SettingsGeneral).limit(1))
    if not general or not general.logo_url:
        return None
    path = Path(settings.upload_dir) / "logos" / Path(general.logo_url).name
    return path if path.exists() and path.suffix.lower() in {".png", ".jpg", ".jpeg"} else None


class RequestPdfBuilder:
    def __init__(self, service_request: ServiceRequest, actor: User, db: Session):
        self.request = service_request
        self.actor = actor
        self.db = db
        self.stream = BytesIO()
        self.pdf = canvas.Canvas(self.stream, pagesize=A4)
        self.font = register_pdf_font()
        self.tz = system_timezone(db)
        self.width, self.height = A4
        self.left = 38
        self.right = self.width - 38
        self.y = self.height - 38
        self.pdf.setTitle(f"Request {service_request.request_number}")

    def page_break(self, needed: int = 70) -> None:
        if self.y < needed:
            self.pdf.showPage()
            self.y = self.height - 38

    def text(self, value: object, x: float, y: float, size: int = 11) -> None:
        self.pdf.setFont(self.font, size)
        self.pdf.drawRightString(x, y, rtl(value))

    def muted_text(self, value: object, x: float, y: float, size: int = 10) -> None:
        self.pdf.setFillColorRGB(0.36, 0.42, 0.48)
        self.text(value, x, y, size)
        self.pdf.setFillColorRGB(0, 0, 0)

    def wrapped(self, value: object, x: float, y: float, max_chars: int = 78, size: int = 11, leading: int = 16) -> float:
        words = str(value or "-").split()
        lines: list[str] = []
        current = ""
        for word in words:
            candidate = f"{current} {word}".strip()
            if len(candidate) > max_chars and current:
                lines.append(current)
                current = word
            else:
                current = candidate
        if current:
            lines.append(current)
        for line in lines or ["-"]:
            self.page_break(55)
            self.text(line, x, y, size)
            y -= leading
        return y

    def header(self) -> None:
        logo_path = logo_file_path(self.db)
        if logo_path:
            try:
                self.pdf.drawImage(ImageReader(str(logo_path)), self.left, self.y - 38, width=78, height=38, preserveAspectRatio=True, mask="auto")
            except Exception:
                pass
        general = self.db.scalar(select(SettingsGeneral).limit(1))
        self.text(general.system_name if general else "النظام", self.right, self.y, 14)
        self.y -= 24
        self.text(f"رقم الطلب: {self.request.request_number}", self.right, self.y, 18)
        self.y -= 25
        self.muted_text(f"تاريخ الطباعة: {format_pdf_datetime(datetime.now(timezone.utc), self.tz)}", self.right, self.y, 10)
        self.y -= 17
        self.muted_text(f"طُبع بواسطة: {self.actor.full_name_ar or self.actor.email}", self.right, self.y, 10)
        self.y -= 24
        self.pdf.line(self.left, self.y, self.right, self.y)
        self.y -= 18

    def section(self, title: str) -> None:
        self.page_break(90)
        self.pdf.setFillColorRGB(0.93, 0.97, 0.95)
        self.pdf.roundRect(self.left, self.y - 23, self.right - self.left, 30, 5, fill=1, stroke=0)
        self.pdf.setFillColorRGB(0, 0, 0)
        self.text(title, self.right - 12, self.y - 15, 13)
        self.y -= 42

    def pair(self, key: str, value: object) -> None:
        self.page_break(52)
        self.muted_text(f"{key}:", self.right, self.y, 10)
        self.y = self.wrapped(value, self.right - 140, self.y, max_chars=52, size=11)
        self.y -= 4

    def pairs(self, values: list[tuple[str, object]]) -> None:
        for key, value in values:
            self.pair(key, value)

    def build(self) -> BytesIO:
        self.header()
        steps = sorted(self.request.approvals or [], key=lambda step: step.step_order)

        self.section("مسار الموافقات ومبرر العمل")
        self.draw_approval_circles(steps)
        self.y -= 12
        self.text("مبرر العمل:", self.right, self.y, 12)
        self.y -= 18
        self.y = self.wrapped(self.request.business_justification or "لا يوجد مبرر مسجل.", self.right, self.y, max_chars=82, size=11)

        self.section("بيانات الطلب")
        form_data = self.request.form_data or {}
        values = [
            ("رقم الطلب", self.request.request_number),
            ("العنوان", self.request.title),
            ("مقدم الطلب", self.request.requester.full_name_ar if self.request.requester else "-"),
            ("الإدارة", self.request.department.name_ar if self.request.department else "-"),
            ("نوع الطلب", form_data.get("request_type_label") or self.request.request_type),
            ("الحالة", label(self.request.status, STATUS_LABELS)),
            ("الأولوية", label(self.request.priority, PRIORITY_LABELS)),
            ("تاريخ الإنشاء", format_pdf_datetime(self.request.created_at, self.tz)),
            ("القسم المختص", form_data.get("assigned_section_label") or form_data.get("administrative_section_label") or form_data.get("assigned_section") or "-"),
        ]
        for key, value in form_data.items():
            values.append((FIELD_LABELS.get(key, key), value))
        self.pairs(values)

        self.pdf.save()
        self.stream.seek(0)
        return self.stream

    def draw_approval_circles(self, steps: list[ApprovalStep]) -> None:
        self.page_break(145)
        if not steps:
            self.text("لا يوجد مسار موافقات مسجل.", self.right, self.y, 11)
            self.y -= 24
            return

        count = len(steps)
        start_x = self.right - 32
        end_x = self.left + 32
        gap = 0 if count == 1 else (start_x - end_x) / (count - 1)
        circle_y = self.y - 20

        if count > 1:
            self.pdf.setStrokeColorRGB(0.82, 0.86, 0.9)
            self.pdf.setLineWidth(2)
            self.pdf.line(end_x, circle_y, start_x, circle_y)

        for index, step in enumerate(steps):
            x = start_x - (gap * index)
            if step.action == ApprovalAction.APPROVED:
                fill = (0.05, 0.45, 0.26)
                text_color = (1, 1, 1)
                marker = "✓"
            elif step.action == ApprovalAction.REJECTED:
                fill = (0.76, 0.12, 0.16)
                text_color = (1, 1, 1)
                marker = "×"
            elif step.action == ApprovalAction.SKIPPED:
                fill = (0.58, 0.64, 0.72)
                text_color = (1, 1, 1)
                marker = "-"
            else:
                fill = (0.95, 0.97, 0.99)
                text_color = (0.18, 0.24, 0.32)
                marker = str(step.step_order)

            self.pdf.setFillColorRGB(*fill)
            self.pdf.setStrokeColorRGB(0.82, 0.86, 0.9)
            self.pdf.circle(x, circle_y, 14, fill=1, stroke=1)
            self.pdf.setFillColorRGB(*text_color)
            self.pdf.setFont(self.font, 10)
            self.pdf.drawCentredString(x, circle_y - 4, rtl(marker))
            self.pdf.setFillColorRGB(0, 0, 0)

            role = label(step.role, ROLE_LABELS)
            self.text(role[:18], x + 28, circle_y - 31, 8)
            self.muted_text(label(step.action, ACTION_LABELS), x + 28, circle_y - 45, 7)

        self.y -= 90


def scoped_requests_stmt(stmt, current_user: User):
    if current_user.role in {UserRole.SUPER_ADMIN, UserRole.IT_MANAGER}:
        return stmt

    own_request = ServiceRequest.requester_id == current_user.id

    if current_user.role == UserRole.EMPLOYEE:
        return stmt.where(own_request)

    if current_user.role == UserRole.DIRECT_MANAGER:
        team_members = select(User.id).where(User.manager_id == current_user.id)
        return stmt.where(or_(own_request, ServiceRequest.requester_id.in_(team_members)))

    approval_requests = select(ApprovalStep.request_id).where(ApprovalStep.role == current_user.role)

    if current_user.role == UserRole.IT_STAFF:
        it_staff_roles = [UserRole.IT_STAFF, *IMPLEMENTATION_STEP_ROLES]
        approval_requests = select(ApprovalStep.request_id).where(ApprovalStep.role.in_(it_staff_roles))
        staff_section = user_administrative_section(current_user)
        request_section = func.coalesce(
            ServiceRequest.form_data["assigned_section"].as_string(),
            ServiceRequest.form_data["administrative_section"].as_string(),
        )
        if staff_section:
            return stmt.where(
                or_(
                    own_request,
                    and_(
                        ServiceRequest.id.in_(approval_requests),
                        request_section == staff_section,
                    ),
                )
            )
        section_has_staff = (
            select(func.count())
            .select_from(User)
            .where(User.role == UserRole.IT_STAFF, User.is_active == True, User.administrative_section == request_section)
            .correlate(ServiceRequest)
            .scalar_subquery()
        )
        return stmt.where(or_(own_request, and_(ServiceRequest.id.in_(approval_requests), request_section.is_not(None), section_has_staff == 0)))

    if current_user.role in {UserRole.INFOSEC, UserRole.EXECUTIVE, UserRole.IT_STAFF}:
        return stmt.where(or_(own_request, ServiceRequest.id.in_(approval_requests)))

    return stmt.where(own_request)


@router.get("", response_model=list[ServiceRequestRead])
def list_requests(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    status_filter: RequestStatus | None = Query(default=None, alias="status"),
    request_type: RequestType | None = None,
):
    stmt = request_query().order_by(ServiceRequest.created_at.desc())
    stmt = scoped_requests_stmt(stmt, current_user)
    if status_filter:
        stmt = stmt.where(ServiceRequest.status == status_filter)
    if request_type:
        stmt = stmt.where(ServiceRequest.request_type == request_type)
    return enrich_request_list(db, db.scalars(stmt).all())


@router.post("", response_model=ServiceRequestRead, status_code=status.HTTP_201_CREATED)
def create_request(payload: ServiceRequestCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role == UserRole.EMPLOYEE and not current_user.manager_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="حسابك غير مرتبط بمدير مباشر. يرجى التواصل مع مدير النظام لربطك بمدير إدارة مباشر قبل رفع الطلب.",
        )
    request_type_record = db.get(RequestTypeSetting, payload.request_type_id) if payload.request_type_id else None
    if payload.request_type_id:
        if not request_type_record or not request_type_record.is_active:
            raise HTTPException(status_code=404, detail="Request type not available")
        fields = db.scalars(select(RequestTypeField).where(RequestTypeField.request_type_id == payload.request_type_id, RequestTypeField.is_active == True)).all()
        validate_form_data(fields, payload.form_data)
    service_request = ServiceRequest(
        request_number=next_request_number(db),
        title=payload.title,
        request_type=payload.request_type,
        request_type_id=payload.request_type_id,
        priority=payload.priority,
        requester_id=current_user.id,
        department_id=current_user.department_id,
        form_data=payload.form_data,
        business_justification=payload.business_justification,
    )
    db.add(service_request)
    db.flush()
    if request_type_record:
        create_snapshot_steps(db, service_request, request_type_record.id)
        service_request.status = RequestStatus.PENDING_APPROVAL
    else:
        create_approval_steps(db, service_request)
    write_audit(db, "request_created", "service_request", actor=current_user, entity_id=str(service_request.id))
    db.commit()
    return enrich_approval_steps(db, db.scalar(request_query().where(ServiceRequest.id == service_request.id)))


@router.get("/{request_id}", response_model=ServiceRequestRead)
def get_request(request_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service_request = db.scalar(request_query().where(ServiceRequest.id == request_id))
    if not service_request:
        raise HTTPException(status_code=404, detail="Request not found")
    ensure_request_access(service_request, current_user, db)
    return enrich_approval_steps(db, service_request)


@router.get("/{request_id}/print.pdf")
def print_request_pdf(request_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service_request = db.scalar(request_query().where(ServiceRequest.id == request_id))
    if not service_request:
        raise HTTPException(status_code=404, detail="Request not found")
    ensure_request_access(service_request, current_user, db)
    stream = RequestPdfBuilder(service_request, current_user, db).build()
    write_audit(db, "request_printed_pdf", "service_request", actor=current_user, entity_id=str(service_request.id))
    db.commit()
    filename = f"{service_request.request_number or request_id}.pdf"
    return StreamingResponse(
        stream,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.patch("/{request_id}", response_model=ServiceRequestRead)
def update_request(request_id: int, payload: ServiceRequestUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service_request = db.scalar(request_query().where(ServiceRequest.id == request_id))
    if not service_request:
        raise HTTPException(status_code=404, detail="Request not found")
    if service_request.requester_id != current_user.id and current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Only requester or admin can edit")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(service_request, field, value)
    write_audit(db, "request_edited", "service_request", actor=current_user, entity_id=str(service_request.id))
    db.commit()
    return enrich_approval_steps(db, db.scalar(request_query().where(ServiceRequest.id == request_id)))


@router.post("/{request_id}/resubmit", response_model=ServiceRequestRead)
def resubmit_request(request_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service_request = db.scalar(request_query().where(ServiceRequest.id == request_id))
    if not service_request:
        raise HTTPException(status_code=404, detail="Request not found")
    if service_request.requester_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only requester can resubmit")
    if service_request.status != RequestStatus.RETURNED_FOR_EDIT:
        raise HTTPException(status_code=400, detail="Only returned requests can be resubmitted")
    if service_request.request_type_id:
        fields = db.scalars(select(RequestTypeField).where(RequestTypeField.request_type_id == service_request.request_type_id, RequestTypeField.is_active == True)).all()
        validate_form_data(fields, service_request.form_data or {})
    reset_workflow_for_resubmission(service_request)
    write_audit(db, "request_resubmitted", "service_request", actor=current_user, entity_id=str(service_request.id))
    db.commit()
    return enrich_approval_steps(db, db.scalar(request_query().where(ServiceRequest.id == request_id)))


@router.post("/{request_id}/approval", response_model=ServiceRequestRead)
def decide(request_id: int, payload: ApprovalDecision, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if payload.action not in {ApprovalAction.APPROVED, ApprovalAction.REJECTED, ApprovalAction.RETURNED_FOR_EDIT}:
        raise HTTPException(status_code=400, detail="Approval action must be approved, rejected, or returned_for_edit")
    service_request = db.scalar(request_query().where(ServiceRequest.id == request_id))
    if not service_request:
        raise HTTPException(status_code=404, detail="Request not found")
    try:
        advance_workflow(db, service_request, current_user, payload.action, payload.note)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    write_audit(db, f"request_{payload.action}", "service_request", actor=current_user, entity_id=str(service_request.id))
    db.commit()
    return enrich_approval_steps(db, db.scalar(request_query().where(ServiceRequest.id == request_id)))


@router.post("/{request_id}/comments")
def add_comment(request_id: int, payload: CommentCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service_request = db.get(ServiceRequest, request_id)
    if not service_request:
        raise HTTPException(status_code=404, detail="Request not found")
    ensure_request_access(service_request, current_user, db)
    comment = RequestComment(request_id=request_id, author_id=current_user.id, body=payload.body, is_internal=payload.is_internal)
    db.add(comment)
    write_audit(db, "comment_added", "service_request", actor=current_user, entity_id=str(request_id))
    db.commit()
    return {"id": comment.id, "message": "Comment added"}


@router.post("/{request_id}/attachments", response_model=AttachmentRead, status_code=status.HTTP_201_CREATED)
def upload_attachment(
    request_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service_request = db.get(ServiceRequest, request_id)
    if not service_request:
        raise HTTPException(status_code=404, detail="Request not found")
    ensure_request_access(service_request, current_user, db)
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="File type is not allowed")

    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    extension = Path(file.filename or "attachment").suffix.lower()
    stored_name = f"{uuid4().hex}{extension}"
    destination = upload_dir / stored_name

    size = 0
    with destination.open("wb") as buffer:
        while chunk := file.file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_UPLOAD_BYTES:
                buffer.close()
                destination.unlink(missing_ok=True)
                raise HTTPException(status_code=400, detail="File exceeds maximum size")
            buffer.write(chunk)

    attachment = Attachment(
        request_id=request_id,
        uploaded_by_id=current_user.id,
        original_name=file.filename or stored_name,
        stored_name=stored_name,
        content_type=file.content_type or "application/octet-stream",
        size_bytes=size,
    )
    db.add(attachment)
    db.flush()
    write_audit(db, "attachment_uploaded", "service_request", actor=current_user, entity_id=str(request_id), metadata={"attachment_id": attachment.id})
    db.commit()
    db.refresh(attachment)
    return attachment


@router.get("/{request_id}/attachments", response_model=list[AttachmentRead])
def list_attachments(request_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service_request = db.get(ServiceRequest, request_id)
    if not service_request:
        raise HTTPException(status_code=404, detail="Request not found")
    ensure_request_access(service_request, current_user, db)
    return db.scalars(select(Attachment).where(Attachment.request_id == request_id).order_by(Attachment.created_at.desc())).all()


@router.get("/{request_id}/attachments/{attachment_id}/download")
def download_attachment(request_id: int, attachment_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service_request = db.get(ServiceRequest, request_id)
    if not service_request:
        raise HTTPException(status_code=404, detail="Request not found")
    ensure_request_access(service_request, current_user, db)
    attachment = db.scalar(select(Attachment).where(Attachment.id == attachment_id, Attachment.request_id == request_id))
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    path = Path(settings.upload_dir) / attachment.stored_name
    if not path.exists():
        raise HTTPException(status_code=404, detail="Stored file not found")
    write_audit(db, "attachment_downloaded", "service_request", actor=current_user, entity_id=str(request_id), metadata={"attachment_id": attachment.id})
    db.commit()
    return FileResponse(path, media_type=attachment.content_type, filename=attachment.original_name)
