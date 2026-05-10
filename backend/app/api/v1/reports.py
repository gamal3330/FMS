from datetime import date, datetime, time, timezone
from io import BytesIO
from typing import Iterable

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import require_roles
from app.db.session import get_db
from app.models.enums import UserRole
from app.models.request import ServiceRequest
from app.models.settings import SettingsGeneral
from app.models.user import Department, User
from app.services.audit import write_audit
from app.services.pdf_fonts import register_arabic_pdf_font
from app.services.pdf_template import (
    draw_cover_header,
    draw_footer,
    draw_ltr_text,
    draw_page_header,
    draw_section_header,
    draw_text,
    format_pdf_datetime,
    pdf_theme,
)

router = APIRouter(prefix="/reports", tags=["Reports"])

REPORT_ROLES = (UserRole.DEPARTMENT_MANAGER, UserRole.SUPER_ADMIN, UserRole.EXECUTIVE)
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

PRIORITY_LABELS = {
    "low": "منخفضة",
    "medium": "متوسطة",
    "high": "عالية",
    "critical": "حرجة",
}

EXCEL_HEADERS = ["رقم الطلب", "العنوان", "الموظف", "الإدارة", "نوع الطلب", "الحالة", "الأولوية", "تاريخ الإنشاء"]


def label(value, labels: dict[str, str]) -> str:
    return labels.get(str(value), str(value or ""))


def filtered_requests_stmt(
    from_date: date | None = None,
    to_date: date | None = None,
    employee_id: int | None = None,
    request_type: str | None = None,
    request_type_id: int | None = None,
):
    stmt = (
        select(ServiceRequest)
        .options(selectinload(ServiceRequest.requester), selectinload(ServiceRequest.department))
        .order_by(ServiceRequest.created_at.desc())
    )
    if from_date:
        stmt = stmt.where(ServiceRequest.created_at >= datetime.combine(from_date, time.min))
    if to_date:
        stmt = stmt.where(ServiceRequest.created_at <= datetime.combine(to_date, time.max))
    if employee_id:
        stmt = stmt.where(ServiceRequest.requester_id == employee_id)
    if request_type_id:
        stmt = stmt.where(ServiceRequest.request_type_id == request_type_id)
    if request_type:
        stmt = stmt.where(ServiceRequest.request_type == request_type)
    return stmt


def scoped_report_requests_stmt(stmt, actor: User):
    if actor.role in {UserRole.SUPER_ADMIN, UserRole.EXECUTIVE}:
        return stmt
    if actor.role == UserRole.DEPARTMENT_MANAGER:
        managed_departments = select(Department.id).where(Department.manager_id == actor.id, Department.is_active == True)
        return stmt.where(or_(ServiceRequest.requester_id == actor.id, ServiceRequest.department_id.in_(managed_departments)))
    return stmt.where(ServiceRequest.requester_id == actor.id)


def request_type_label(item: ServiceRequest) -> str:
    form_data = item.form_data or {}
    return form_data.get("request_type_label") or form_data.get("request_type_code") or str(item.request_type or "")


def report_rows(items: Iterable[ServiceRequest]) -> list[list[str]]:
    rows = []
    for item in items:
        requester_name = item.requester.full_name_ar if getattr(item, "requester", None) else ""
        department_name = item.department.name_ar if getattr(item, "department", None) else ""
        created_at = getattr(item, "created_at", None)
        rows.append(
            [
                str(getattr(item, "request_number", "") or ""),
                str(getattr(item, "title", "") or ""),
                str(requester_name or ""),
                str(department_name or ""),
                str(request_type_label(item) or ""),
                label(getattr(item, "status", ""), STATUS_LABELS),
                label(getattr(item, "priority", ""), PRIORITY_LABELS),
                created_at.strftime("%Y/%m/%d %H:%M") if isinstance(created_at, datetime) else str(created_at or ""),
            ]
        )
    return rows


def build_excel_report(items: Iterable[ServiceRequest]) -> BytesIO:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "تقرير الطلبات"
    sheet.sheet_view.rightToLeft = True
    sheet.freeze_panes = "A2"
    sheet.append(EXCEL_HEADERS)

    header_alignment = Alignment(horizontal="right", vertical="center", readingOrder=2, wrap_text=True)
    body_alignment = Alignment(horizontal="right", vertical="center", readingOrder=2, wrap_text=True)
    for cell in sheet[1]:
        cell.font = Font(bold=True)
        cell.alignment = header_alignment

    for row in report_rows(items):
        sheet.append(row)

    for row in sheet.iter_rows(min_row=2):
        for cell in row:
            cell.alignment = body_alignment

    widths = [18, 34, 26, 26, 24, 20, 14, 24]
    for index, width in enumerate(widths, start=1):
        sheet.column_dimensions[chr(64 + index)].width = width

    stream = BytesIO()
    workbook.save(stream)
    stream.seek(0)
    return stream


def build_pdf_report(items: Iterable[ServiceRequest], db: Session, actor: User) -> BytesIO:
    items = list(items)
    stream = BytesIO()
    pdf = canvas.Canvas(stream, pagesize=A4)
    font_name = register_arabic_pdf_font()
    general = db.scalar(select(SettingsGeneral).limit(1))
    theme = pdf_theme(general)
    pdf.setTitle("تقرير الطلبات")

    left = 36
    right = A4[0] - 36
    actor_name = actor.full_name_ar or actor.email

    y = draw_cover_header(
        pdf,
        theme,
        font_name,
        "تقرير طلبات خدمات البنك",
        f"تاريخ الطباعة: {format_pdf_datetime(datetime.now(timezone.utc), theme.timezone)}",
    )
    y = draw_section_header(pdf, theme, font_name, "ملخص التقرير", left, right, y)

    summary_gap = 12
    summary_width = (right - left - summary_gap) / 2
    pdf.setFillColorRGB(0.98, 0.99, 1)
    pdf.setStrokeColorRGB(0.88, 0.91, 0.94)
    pdf.roundRect(right - summary_width, y - 52, summary_width, 52, 5, fill=1, stroke=1)
    pdf.roundRect(left, y - 52, summary_width, 52, 5, fill=1, stroke=1)
    draw_text(pdf, font_name, "عدد الطلبات", right - 12, y - 17, 8, (0.45, 0.5, 0.58))
    draw_ltr_text(pdf, font_name, str(len(items)), right - summary_width + 16, y - 36, 13, (0.06, 0.09, 0.16))
    draw_text(pdf, font_name, "تم إنشاء التقرير بواسطة", left + summary_width - 12, y - 17, 8, (0.45, 0.5, 0.58))
    draw_text(pdf, font_name, actor_name, left + summary_width - 12, y - 36, 10, (0.06, 0.09, 0.16))
    y -= 76

    y = draw_section_header(pdf, theme, font_name, "قائمة الطلبات", left, right, y)

    columns = [
        ("رقم الطلب", right - 8, 92),
        ("العنوان", right - 112, 150),
        ("الموظف", right - 274, 116),
        ("الحالة", right - 402, 82),
        ("التاريخ", left + 92, 86),
    ]

    def draw_table_header(current_y: float) -> float:
        pdf.setFillColorRGB(0.96, 0.98, 1)
        pdf.setStrokeColorRGB(0.88, 0.91, 0.94)
        pdf.roundRect(left, current_y - 28, right - left, 28, 5, fill=1, stroke=1)
        for header, x, _ in columns:
            draw_text(pdf, font_name, header, x, current_y - 18, 8, (0.45, 0.5, 0.58))
        return current_y - 34

    y = draw_table_header(y)
    for item in items[:80]:
        if y < 58:
            draw_footer(pdf, font_name, f"طُبع بواسطة: {actor_name}", left, right)
            pdf.showPage()
            y = draw_page_header(pdf, theme, font_name, "تقرير الطلبات")
            y = draw_table_header(y)

        requester_name = item.requester.full_name_ar if getattr(item, "requester", None) else "-"
        created_at = item.created_at if isinstance(item.created_at, datetime) else None
        pdf.setStrokeColorRGB(0.92, 0.94, 0.96)
        pdf.line(left, y - 7, right, y - 7)
        draw_ltr_text(pdf, font_name, str(item.request_number or "")[:18], right - 95, y + 5, 9, (0.06, 0.09, 0.16))
        draw_text(pdf, font_name, str(item.title or "-")[:34], right - 112, y + 5, 9, (0.06, 0.09, 0.16))
        draw_text(pdf, font_name, requester_name[:24], right - 274, y + 5, 9, (0.06, 0.09, 0.16))
        status_value = getattr(item.status, "value", item.status)
        draw_text(pdf, font_name, label(status_value, STATUS_LABELS), right - 402, y + 5, 9, theme.brand_dark)
        draw_ltr_text(pdf, font_name, format_pdf_datetime(created_at, theme.timezone), left + 8, y + 5, 8, (0.36, 0.42, 0.48))
        y -= 24

    draw_footer(pdf, font_name, f"طُبع بواسطة: {actor_name}", left, right)
    pdf.save()
    stream.seek(0)
    return stream


@router.get("/requests.xlsx")
def export_excel(
    db: Session = Depends(get_db),
    actor: User = Depends(require_roles(*REPORT_ROLES)),
    from_date: date | None = Query(default=None),
    to_date: date | None = Query(default=None),
    employee_id: int | None = Query(default=None),
    request_type: str | None = Query(default=None),
    request_type_id: int | None = Query(default=None),
):
    stmt = scoped_report_requests_stmt(filtered_requests_stmt(from_date, to_date, employee_id, request_type, request_type_id), actor)
    items = db.scalars(stmt).all()
    stream = build_excel_report(items)
    write_audit(db, "report_exported_excel", "report", actor=actor)
    db.commit()
    return StreamingResponse(
        stream,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=qib-requests.xlsx"},
    )


@router.get("/requests.pdf")
def export_pdf(
    db: Session = Depends(get_db),
    actor: User = Depends(require_roles(*REPORT_ROLES)),
    from_date: date | None = Query(default=None),
    to_date: date | None = Query(default=None),
    employee_id: int | None = Query(default=None),
    request_type: str | None = Query(default=None),
    request_type_id: int | None = Query(default=None),
):
    stmt = scoped_report_requests_stmt(filtered_requests_stmt(from_date, to_date, employee_id, request_type, request_type_id), actor)
    items = db.scalars(stmt.limit(80)).all()
    stream = build_pdf_report(items, db, actor)
    write_audit(db, "report_exported_pdf", "report", actor=actor)
    db.commit()
    return StreamingResponse(stream, media_type="application/pdf", headers={"Content-Disposition": "attachment; filename=qib-requests.pdf"})
