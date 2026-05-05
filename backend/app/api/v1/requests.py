from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse, StreamingResponse
from reportlab.lib.pagesizes import A4
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
from app.services.pdf_fonts import register_arabic_pdf_font, rtl_text
from app.services.pdf_template import (
    draw_cover_header,
    draw_field_box,
    draw_footer,
    draw_page_header,
    draw_section_header,
    format_pdf_datetime,
    pdf_theme,
)
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
    "source_ip": "عنوان المصدر",
    "destination_ip": "عنوان الوجهة",
    "destination_port": "منفذ الوجهة",
    "nat_port": "منفذ NAT",
    "asset_tag": "رقم الجهاز",
    "current_location": "الموقع الحالي",
    "new_location": "الموقع الجديد",
    "assigned_section": "القسم المختص",
    "administrative_section": "القسم المختص",
    "assigned_section_label": "القسم المختص",
    "administrative_section_label": "القسم المختص",
    "request_type_code": "رمز نوع الطلب",
    "request_type_label": "نوع الطلب",
    "reason": "المبرر",
    "issue_description": "وصف المشكلة",
}
PDF_HIDDEN_FORM_KEYS = {
    "request_type_code",
    "request_type_label",
    "assigned_section",
    "administrative_section",
    "assigned_section_label",
    "administrative_section_label",
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
    return register_arabic_pdf_font()


def rtl(text: object) -> str:
    return rtl_text(text)


def label(value: object, labels: dict[str, str]) -> str:
    return labels.get(str(value or ""), str(value or ""))


def pdf_form_pairs(form_data: dict) -> list[tuple[str, object]]:
    pairs: list[tuple[str, object]] = []
    seen_labels = {"نوع الطلب", "القسم المختص"}
    for key, value in form_data.items():
        if key in PDF_HIDDEN_FORM_KEYS or value in (None, ""):
            continue
        field_label = FIELD_LABELS.get(key, key.replace("_", " "))
        if field_label in seen_labels:
            continue
        seen_labels.add(field_label)
        pairs.append((field_label, value))
    return pairs


class RequestPdfBuilder:
    def __init__(self, service_request: ServiceRequest, actor: User, db: Session):
        self.request = service_request
        self.actor = actor
        self.db = db
        self.general = db.scalar(select(SettingsGeneral).limit(1))
        self.stream = BytesIO()
        self.pdf = canvas.Canvas(self.stream, pagesize=A4)
        self.font = register_pdf_font()
        self.theme = pdf_theme(self.general)
        self.tz = self.theme.timezone
        self.width, self.height = A4
        self.left = 36
        self.right = self.width - 36
        self.content_width = self.right - self.left
        self.brand_dark = self.theme.brand_dark
        self.brand_soft = self.theme.brand_soft
        self.y = self.height - 36
        self.pdf.setTitle(f"Request {service_request.request_number}")

    def page_break(self, needed: int = 70) -> None:
        if self.y < needed:
            self.footer()
            self.pdf.showPage()
            self.y = self.height - 36
            self.page_header()

    def text(self, value: object, x: float, y: float, size: int = 11) -> None:
        self.pdf.setFont(self.font, size)
        self.pdf.drawRightString(x, y, rtl(value))

    def centered_text(self, value: object, x: float, y: float, size: int = 10) -> None:
        self.pdf.setFont(self.font, size)
        self.pdf.drawCentredString(x, y, rtl(value))

    def muted_text(self, value: object, x: float, y: float, size: int = 10) -> None:
        self.pdf.setFillColorRGB(0.36, 0.42, 0.48)
        self.text(value, x, y, size)
        self.pdf.setFillColorRGB(0, 0, 0)

    def summary_item(self, title: str, value: object, x: float, y: float, width: float, value_size: int = 12) -> None:
        self.pdf.setFillColorRGB(0.45, 0.5, 0.58)
        self.text(title, x + width - 12, y - 24, 9)
        self.pdf.setFillColorRGB(0.06, 0.09, 0.16)
        self.text(str(value or "-")[:38], x + width - 12, y - 50, value_size)
        self.pdf.setFillColorRGB(0, 0, 0)

    def wrapped(self, value: object, x: float, y: float, max_chars: int = 78, size: int = 11, leading: int = 16, color: tuple[float, float, float] = (0.08, 0.12, 0.18)) -> float:
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
        self.pdf.setFillColorRGB(*color)
        for line in lines or ["-"]:
            self.page_break(55)
            self.text(line, x, y, size)
            y -= leading
        self.pdf.setFillColorRGB(0, 0, 0)
        return y

    def page_header(self) -> None:
        self.y = draw_page_header(self.pdf, self.theme, self.font, str(self.request.request_number or ""))

    def footer(self) -> None:
        draw_footer(self.pdf, self.font, f"طُبع بواسطة: {self.actor.full_name_ar or self.actor.email}", self.left, self.right)

    def status_pill(self, value: str, x: float, y: float, width: float = 86) -> None:
        status = str(self.request.status or "")
        if status in {"rejected", "cancelled"}:
            fill = (0.99, 0.9, 0.9)
            text_color = (0.72, 0.11, 0.11)
        elif status in {"completed", "closed", "approved"}:
            fill = self.brand_soft
            text_color = self.brand_dark
        elif status in {"pending_approval", "in_implementation"}:
            fill = (1.0, 0.96, 0.82)
            text_color = (0.62, 0.36, 0.02)
        else:
            fill = (0.94, 0.96, 0.98)
            text_color = (0.24, 0.3, 0.38)
        self.pdf.setFillColorRGB(*fill)
        self.pdf.roundRect(x - width, y - 13, width, 24, 10, fill=1, stroke=0)
        self.pdf.setFillColorRGB(*text_color)
        self.centered_text(value, x - (width / 2), y - 4, 9)
        self.pdf.setFillColorRGB(0, 0, 0)

    def centered_muted_text(self, value: object, x: float, y: float, size: int = 8) -> None:
        self.pdf.setFillColorRGB(0.45, 0.5, 0.58)
        self.centered_text(value, x, y, size)
        self.pdf.setFillColorRGB(0, 0, 0)

    def centered_lines(self, value: object, x: float, y: float, max_chars: int = 14, max_lines: int = 2, size: int = 8, leading: int = 10, color: tuple[float, float, float] = (0.06, 0.09, 0.16)) -> int:
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
        if len(lines) > max_lines:
            lines = lines[:max_lines]
            lines[-1] = f"{lines[-1][:max_chars - 1]}…"

        self.pdf.setFillColorRGB(*color)
        for index, line in enumerate(lines or ["-"]):
            self.centered_text(line, x, y - (index * leading), size)
        self.pdf.setFillColorRGB(0, 0, 0)
        return len(lines or ["-"])

    def header(self) -> None:
        form_data = self.request.form_data or {}
        request_type_title = form_data.get("request_type_label") or self.request.request_type or "طلب خدمة"
        printed_at = format_pdf_datetime(datetime.now(timezone.utc), self.tz)
        self.y = draw_cover_header(self.pdf, self.theme, self.font, f"نموذج {request_type_title}", f"تاريخ الطباعة: {printed_at}")
        self.pdf.setFillColorRGB(1, 1, 1)
        self.pdf.setStrokeColorRGB(0.88, 0.91, 0.94)
        self.pdf.roundRect(self.left, self.y - 80, self.content_width, 80, 7, fill=1, stroke=1)

        status_width = 124
        gap = 12
        item_width = (self.content_width - status_width - (gap * 2)) / 2
        number_x = self.right - item_width
        title_x = number_x - gap - item_width
        status_x = self.left

        self.summary_item("رقم الطلب", self.request.request_number, number_x, self.y, item_width, 15)
        self.summary_item("عنوان الطلب", self.request.title, title_x, self.y, item_width, 12)

        self.pdf.setStrokeColorRGB(0.9, 0.92, 0.95)
        self.pdf.line(title_x - (gap / 2), self.y - 64, title_x - (gap / 2), self.y - 16)
        self.pdf.line(number_x - (gap / 2), self.y - 64, number_x - (gap / 2), self.y - 16)

        self.centered_muted_text("الحالة", status_x + (status_width / 2), self.y - 24, 9)
        self.status_pill(label(self.request.status, STATUS_LABELS), status_x + status_width - 16, self.y - 52, 102)
        self.y -= 104

    def section(self, title: str) -> None:
        self.page_break(90)
        self.y = draw_section_header(self.pdf, self.theme, self.font, title, self.left, self.right, self.y)

    def pair(self, key: str, value: object) -> None:
        self.page_break(72)
        self.field_box(key, value, self.left, self.y, self.content_width)
        self.y -= 64

    def pairs(self, values: list[tuple[str, object]]) -> None:
        index = 0
        while index < len(values):
            first = values[index]
            second = values[index + 1] if index + 1 < len(values) else None
            self.page_break(72)
            row_top = self.y
            if second:
                gap = 12
                box_width = (self.content_width - gap) / 2
                self.field_box(first[0], first[1], self.right - box_width, row_top, box_width)
                self.field_box(second[0], second[1], self.left, row_top, box_width)
            else:
                self.field_box(first[0], first[1], self.left, row_top, self.content_width)
            self.y -= 64
            index += 2

    def field_box(self, key: str, value: object, x: float, y: float, width: float) -> None:
        draw_field_box(self.pdf, self.font, key, value, x, y, width)

    def note_box(self, title: str, value: object) -> None:
        self.page_break(110)
        self.pdf.setFillColorRGB(0.98, 0.99, 1)
        self.pdf.setStrokeColorRGB(0.88, 0.91, 0.94)
        self.pdf.roundRect(self.left, self.y - 92, self.content_width, 92, 6, fill=1, stroke=1)
        self.pdf.setFillColorRGB(*self.brand_dark)
        self.text(title, self.right - 14, self.y - 20, 11)
        self.y = self.wrapped(value, self.right - 14, self.y - 42, max_chars=86, size=10, leading=14)
        self.y -= 18

    def build(self) -> BytesIO:
        self.header()
        steps = sorted(self.request.approvals or [], key=lambda step: step.step_order)

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
        values.extend(pdf_form_pairs(form_data))
        self.pairs(values)

        self.section("مسار الموافقات")
        self.draw_approval_circles(steps)
        self.note_box("مبرر العمل", self.request.business_justification or "لا يوجد مبرر مسجل.")

        self.footer()
        self.pdf.save()
        self.stream.seek(0)
        return self.stream

    def draw_approval_circles(self, steps: list[ApprovalStep]) -> None:
        self.page_break(175)
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
            role_line_count = self.centered_lines(role, x, circle_y - 31, max_chars=16, max_lines=2, size=8, leading=10)
            action_y = circle_y - 45 - ((role_line_count - 1) * 10)
            self.centered_lines(label(step.action, ACTION_LABELS), x, action_y, max_chars=18, max_lines=1, size=7, color=(0.36, 0.42, 0.48))
            if step.acted_at or step.approver:
                approver_name = "-"
                if step.approver:
                    approver_name = step.approver.full_name_ar or step.approver.email or "-"
                self.centered_lines(f"بواسطة: {approver_name}", x, action_y - 14, max_chars=22, max_lines=1, size=6, color=(0.36, 0.42, 0.48))
                self.centered_lines(f"في: {format_pdf_datetime(step.acted_at, self.tz)}", x, action_y - 26, max_chars=22, max_lines=1, size=6, color=(0.36, 0.42, 0.48))

        self.y -= 120


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
    page: int | None = Query(default=None, ge=1),
    per_page: int | None = Query(default=None, ge=1, le=100),
):
    stmt = request_query().order_by(ServiceRequest.created_at.desc())
    stmt = scoped_requests_stmt(stmt, current_user)
    if status_filter:
        stmt = stmt.where(ServiceRequest.status == status_filter)
    if request_type:
        stmt = stmt.where(ServiceRequest.request_type == request_type)
    if page and per_page:
        stmt = stmt.offset((page - 1) * per_page).limit(per_page)
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
