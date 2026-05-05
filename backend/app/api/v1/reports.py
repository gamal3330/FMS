from datetime import date, datetime, time
from io import BytesIO
from typing import Iterable

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import require_roles
from app.db.session import get_db
from app.models.enums import UserRole
from app.models.request import ServiceRequest
from app.models.user import User
from app.services.audit import write_audit
from app.services.pdf_fonts import register_arabic_pdf_font, rtl_text

router = APIRouter(prefix="/reports", tags=["Reports"])

REPORT_ROLES = (UserRole.IT_MANAGER, UserRole.SUPER_ADMIN, UserRole.EXECUTIVE)
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


def build_pdf_report(items: Iterable[ServiceRequest]) -> BytesIO:
    stream = BytesIO()
    pdf = canvas.Canvas(stream, pagesize=A4)
    font_name = register_arabic_pdf_font()
    pdf.setTitle("تقرير الطلبات")

    right = A4[0] - 40
    left = 40
    y = 800
    pdf.setFont(font_name, 15)
    pdf.drawRightString(right, y, rtl_text("تقرير طلبات خدمات تقنية المعلومات"))

    y -= 30
    pdf.setFont(font_name, 10)
    columns = [
        ("رقم الطلب", right),
        ("العنوان", right - 95),
        ("الموظف", right - 265),
        ("الحالة", left + 90),
    ]
    for header, x in columns:
        pdf.drawRightString(x, y, rtl_text(header))

    y -= 8
    pdf.line(left, y, right, y)

    for row in report_rows(items)[:80]:
        y -= 22
        if y < 45:
            pdf.showPage()
            y = 800
            pdf.setFont(font_name, 10)
            for header, x in columns:
                pdf.drawRightString(x, y, rtl_text(header))
            y -= 8
            pdf.line(left, y, right, y)
        request_number, title, employee_name, _, _, status, _, _ = row
        pdf.drawRightString(right, y, str(request_number)[:18])
        pdf.drawRightString(right - 95, y, rtl_text(title[:32]))
        pdf.drawRightString(right - 265, y, rtl_text(employee_name[:24]))
        pdf.drawRightString(left + 90, y, rtl_text(status))

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
    items = db.scalars(filtered_requests_stmt(from_date, to_date, employee_id, request_type, request_type_id)).all()
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
    items = db.scalars(filtered_requests_stmt(from_date, to_date, employee_id, request_type, request_type_id).limit(80)).all()
    stream = build_pdf_report(items)
    write_audit(db, "report_exported_pdf", "report", actor=actor)
    db.commit()
    return StreamingResponse(stream, media_type="application/pdf", headers={"Content-Disposition": "attachment; filename=qib-requests.pdf"})
