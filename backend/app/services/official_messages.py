from __future__ import annotations

from datetime import datetime, timezone
from html.parser import HTMLParser
from io import BytesIO
from pathlib import Path
from uuid import uuid4
import copy
import hashlib
import re
from zoneinfo import ZoneInfo

from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from sqlalchemy import inspect, select, text
from sqlalchemy.orm import Session, selectinload

from app.core.config import get_settings
from app.db.session import Base
from app.models.message import (
    InternalMessage,
    InternalMessageRecipient,
    OfficialLetterheadTemplate,
    OfficialMessageDocument,
    OfficialMessageSettings,
    OfficialStamp,
    UserSignature,
)
from app.models.settings import SettingsGeneral
from app.models.user import ActionPermission, User
from app.models.enums import UserRole
from app.services.audit import write_audit
from app.services.pdf_fonts import register_arabic_pdf_font, rtl_text
from app.services.pdf_template import format_pdf_datetime, hex_to_rgb, pdf_theme

settings = get_settings()

OFFICIAL_UPLOAD_SUBDIR = "official-messages"
OFFICIAL_IMAGE_SUBDIR = "official-assets"
_OFFICIAL_RUNTIME_READY = False


class HtmlTextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        if data:
            self.parts.append(data)

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag in {"br", "p", "div", "li", "tr"}:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"p", "div", "li", "tr"}:
            self.parts.append("\n")

    def text(self) -> str:
        value = "".join(self.parts)
        value = re.sub(r"\n{3,}", "\n\n", value)
        value = re.sub(r"[ \t]{2,}", " ", value)
        return value.strip()


def html_to_text(value: str | None) -> str:
    parser = HtmlTextExtractor()
    parser.feed(value or "")
    return parser.text() or str(value or "").strip()


def official_storage_dir() -> Path:
    root = Path(settings.upload_dir)
    if not root.is_absolute():
        root = Path.cwd() / root
    target = root / OFFICIAL_UPLOAD_SUBDIR
    target.mkdir(parents=True, exist_ok=True)
    return target


def official_asset_dir() -> Path:
    root = Path(settings.upload_dir)
    if not root.is_absolute():
        root = Path.cwd() / root
    target = root / OFFICIAL_IMAGE_SUBDIR
    target.mkdir(parents=True, exist_ok=True)
    return target


def resolve_upload_path(path_value: str | None) -> Path | None:
    if not path_value:
        return None
    path = Path(path_value)
    if path.is_absolute():
        return path if path.exists() else None
    root = Path(settings.upload_dir)
    if not root.is_absolute():
        root = Path.cwd() / root
    candidate = root / path
    return candidate if candidate.exists() else None


def ensure_official_message_runtime(db: Session) -> None:
    global _OFFICIAL_RUNTIME_READY
    if _OFFICIAL_RUNTIME_READY:
        return
    bind = db.get_bind()
    try:
        Base.metadata.create_all(
            bind=bind,
            tables=[
                OfficialLetterheadTemplate.__table__,
                UserSignature.__table__,
                OfficialStamp.__table__,
                OfficialMessageDocument.__table__,
                OfficialMessageSettings.__table__,
            ],
        )
        inspector = inspect(bind)
        table_names = set(inspector.get_table_names())
        if "internal_messages" in inspector.get_table_names():
            columns = {column["name"] for column in inspector.get_columns("internal_messages")}
            additions = {
                "is_official": "BOOLEAN DEFAULT FALSE",
                "official_reference_number": "VARCHAR(80)",
                "include_in_request_pdf": "BOOLEAN DEFAULT FALSE",
                "official_pdf_document_id": "INTEGER",
                "official_status": "VARCHAR(40)",
            }
            for column, definition in additions.items():
                if column not in columns:
                    db.execute(text(f"ALTER TABLE internal_messages ADD COLUMN {column} {definition}"))
            db.execute(text('CREATE INDEX IF NOT EXISTS "idx_internal_messages_is_official_created" ON "internal_messages" (is_official, created_at)'))
            db.execute(text('CREATE INDEX IF NOT EXISTS "idx_internal_messages_official_reference" ON "internal_messages" (official_reference_number)'))

        ensure_table_columns(
            db,
            inspector,
            table_names,
            "official_letterhead_templates",
            {
                "name_ar": "VARCHAR(160)",
                "name_en": "VARCHAR(160)",
                "code": "VARCHAR(80)",
                "logo_path": "VARCHAR(500)",
                "template_pdf_path": "VARCHAR(500)",
                "header_html": "TEXT",
                "footer_html": "TEXT",
                "primary_color": "VARCHAR(20) DEFAULT '#0f5132'",
                "secondary_color": "VARCHAR(20) DEFAULT '#9bd84e'",
                "show_page_number": "BOOLEAN DEFAULT TRUE",
                "show_confidentiality_label": "BOOLEAN DEFAULT TRUE",
                "is_default": "BOOLEAN DEFAULT FALSE",
                "is_active": "BOOLEAN DEFAULT TRUE",
                "created_by": "INTEGER",
                "created_at": "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
                "updated_at": "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
            },
        )
        ensure_table_columns(
            db,
            inspector,
            table_names,
            "official_message_settings",
            {
                "default_letterhead_template_id": "INTEGER",
                "enable_official_letterhead": "BOOLEAN DEFAULT TRUE",
                "official_message_requires_approval": "BOOLEAN DEFAULT FALSE",
                "allow_unverified_signature": "BOOLEAN DEFAULT FALSE",
                "allow_signature_upload_by_user": "BOOLEAN DEFAULT TRUE",
                "include_official_messages_in_request_pdf": "BOOLEAN DEFAULT TRUE",
                "updated_at": "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
            },
        )
        ensure_table_columns(
            db,
            inspector,
            table_names,
            "user_signatures",
            {
                "user_id": "INTEGER",
                "signature_image_path": "VARCHAR(500)",
                "signature_label": "VARCHAR(160)",
                "is_verified": "BOOLEAN DEFAULT FALSE",
                "is_active": "BOOLEAN DEFAULT TRUE",
                "uploaded_at": "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
                "verified_by": "INTEGER",
                "verified_at": "TIMESTAMP",
            },
        )
        ensure_table_columns(
            db,
            inspector,
            table_names,
            "official_stamps",
            {
                "name_ar": "VARCHAR(160)",
                "code": "VARCHAR(80)",
                "stamp_image_path": "VARCHAR(500)",
                "allowed_roles_json": "JSON",
                "is_active": "BOOLEAN DEFAULT TRUE",
                "created_by": "INTEGER",
                "created_at": "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
                "updated_at": "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
            },
        )
        ensure_table_columns(
            db,
            inspector,
            table_names,
            "official_message_documents",
            {
                "message_id": "INTEGER",
                "related_request_id": "INTEGER",
                "letterhead_template_id": "INTEGER",
                "signature_id": "INTEGER",
                "stamp_id": "INTEGER",
                "reference_number": "VARCHAR(80)",
                "pdf_file_path": "VARCHAR(500)",
                "file_size": "INTEGER DEFAULT 0",
                "checksum": "VARCHAR(128)",
                "generated_by": "INTEGER",
                "generated_at": "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
            },
        )

        seed_default_letterhead(db)
        seed_default_official_settings(db)
        db.commit()
        _OFFICIAL_RUNTIME_READY = True
    except Exception:
        db.rollback()
        raise


def ensure_table_columns(db: Session, inspector, table_names: set[str], table_name: str, additions: dict[str, str]) -> None:
    if table_name not in table_names:
        return
    columns = {column["name"] for column in inspector.get_columns(table_name)}
    for column, definition in additions.items():
        if column not in columns:
            db.execute(text(f'ALTER TABLE "{table_name}" ADD COLUMN "{column}" {definition}'))


def seed_default_letterhead(db: Session) -> OfficialLetterheadTemplate:
    template = db.scalar(select(OfficialLetterheadTemplate).where(OfficialLetterheadTemplate.code == "default_bank_letterhead"))
    if template:
        return template
    template = OfficialLetterheadTemplate(
        name_ar="الترويسة الرسمية الافتراضية",
        name_en="Default Official Bank Letterhead",
        code="default_bank_letterhead",
        template_pdf_path=None,
        header_html="{{bank_name_ar}} - {{bank_name_en}}",
        footer_html="QIB Service Portal",
        primary_color="#0f5132",
        secondary_color="#9bd84e",
        show_page_number=True,
        show_confidentiality_label=True,
        is_default=True,
        is_active=True,
    )
    db.add(template)
    db.flush()
    return template


def seed_default_official_settings(db: Session) -> OfficialMessageSettings:
    settings_row = db.scalar(select(OfficialMessageSettings).limit(1))
    if settings_row:
        return settings_row
    template = seed_default_letterhead(db)
    settings_row = OfficialMessageSettings(
        default_letterhead_template_id=template.id,
        enable_official_letterhead=True,
        official_message_requires_approval=False,
        allow_unverified_signature=False,
        allow_signature_upload_by_user=True,
        include_official_messages_in_request_pdf=True,
    )
    db.add(settings_row)
    db.flush()
    return settings_row


def official_message_settings(db: Session) -> OfficialMessageSettings:
    ensure_official_message_runtime(db)
    return seed_default_official_settings(db)


def default_letterhead(db: Session) -> OfficialLetterheadTemplate:
    ensure_official_message_runtime(db)
    settings_row = seed_default_official_settings(db)
    template = None
    if settings_row.default_letterhead_template_id:
        template = db.get(OfficialLetterheadTemplate, settings_row.default_letterhead_template_id)
    if not template:
        template = db.scalar(select(OfficialLetterheadTemplate).where(OfficialLetterheadTemplate.is_default == True, OfficialLetterheadTemplate.is_active == True).limit(1))
    if not template:
        template = seed_default_letterhead(db)
    return template


def user_role_code(user: User) -> str:
    role_record = getattr(user, "role_record", None)
    if role_record and role_record.code:
        return str(role_record.code)
    return str(getattr(user.role, "value", user.role))


def can_manage_official_assets(user: User) -> bool:
    return user.role in {UserRole.SUPER_ADMIN, UserRole.DEPARTMENT_MANAGER}


def has_action_permission(db: Session, user: User, action_code: str, *, default: bool = False) -> bool:
    if user.role == UserRole.SUPER_ADMIN:
        return True
    if action_code.startswith("manage_"):
        default = default or can_manage_official_assets(user)
    direct = db.scalar(select(ActionPermission).where(ActionPermission.user_id == user.id, ActionPermission.action_code == action_code))
    if direct is not None:
        return bool(direct.is_allowed)
    if user.role_id:
        role_permission = db.scalar(select(ActionPermission).where(ActionPermission.role_id == user.role_id, ActionPermission.action_code == action_code))
        if role_permission is not None:
            return bool(role_permission.is_allowed)
    return default


def require_official_permission(db: Session, user: User, action_code: str, *, default: bool = False, detail: str = "لا تملك صلاحية تنفيذ هذا الإجراء") -> None:
    if not has_action_permission(db, user, action_code, default=default):
        raise PermissionError(detail)


def validate_signature_usage(db: Session, user: User, signature_id: int | None, allow_unverified: bool) -> UserSignature | None:
    if not signature_id:
        return None
    signature = db.get(UserSignature, signature_id)
    if not signature or not signature.is_active:
        raise ValueError("التوقيع غير موجود أو غير مفعل")
    if signature.user_id != user.id and not has_action_permission(db, user, "manage_user_signatures", default=can_manage_official_assets(user)):
        raise PermissionError("لا يمكن استخدام توقيع مستخدم آخر")
    if not allow_unverified and not signature.is_verified:
        raise ValueError("التوقيع غير موثق")
    return signature


def validate_stamp_usage(db: Session, user: User, stamp_id: int | None) -> OfficialStamp | None:
    if not stamp_id:
        return None
    stamp = db.get(OfficialStamp, stamp_id)
    if not stamp or not stamp.is_active:
        raise ValueError("الختم غير موجود أو غير مفعل")
    allowed_roles = {str(item) for item in (stamp.allowed_roles_json or []) if str(item).strip()}
    if allowed_roles and user_role_code(user) not in allowed_roles and str(user.role) not in allowed_roles:
        raise PermissionError("لا تملك صلاحية استخدام هذا الختم")
    if not has_action_permission(db, user, "use_official_stamp", default=can_manage_official_assets(user)):
        raise PermissionError("لا تملك صلاحية استخدام الأختام الرسمية")
    return stamp


def wrap_arabic_text(text_value: str, max_chars: int = 74) -> list[str]:
    lines: list[str] = []
    for raw_line in (text_value or "").splitlines() or [""]:
        words = raw_line.split()
        if not words:
            lines.append("")
            continue
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
    return lines


def draw_right(pdf: canvas.Canvas, font_name: str, value: object, x: float, y: float, size: int = 10, color: tuple[float, float, float] = (0, 0, 0)) -> None:
    pdf.setFillColorRGB(*color)
    pdf.setFont(font_name, size)
    pdf.drawRightString(x, y, rtl_text(value))
    pdf.setFillColorRGB(0, 0, 0)


def draw_center(pdf: canvas.Canvas, font_name: str, value: object, x: float, y: float, size: int = 10, color: tuple[float, float, float] = (0, 0, 0)) -> None:
    pdf.setFillColorRGB(*color)
    pdf.setFont(font_name, size)
    pdf.drawCentredString(x, y, rtl_text(value))
    pdf.setFillColorRGB(0, 0, 0)


def merge_pdf_background(background_path: Path, overlay_content: bytes) -> bytes:
    try:
        from pypdf import PdfReader, PdfWriter
    except ImportError as error:
        raise RuntimeError("مكتبة pypdf غير مثبتة. ثبت متطلبات الخلفية الرسمية قبل استخدام قالب PDF.") from error

    background_reader = PdfReader(str(background_path))
    overlay_reader = PdfReader(BytesIO(overlay_content))
    if not background_reader.pages:
        raise ValueError("قالب الترويسة PDF لا يحتوي على صفحات")

    writer = PdfWriter()
    background_page = background_reader.pages[0]
    for overlay_page in overlay_reader.pages:
        page = copy.deepcopy(background_page)
        page.merge_page(overlay_page)
        writer.add_page(page)

    merged = BytesIO()
    writer.write(merged)
    merged.seek(0)
    return merged.read()


def generate_official_pdf_bytes(
    *,
    db: Session,
    message: InternalMessage,
    actor: User,
    template: OfficialLetterheadTemplate,
    reference_number: str | None,
    correspondence_type: str | None,
    signature: UserSignature | None,
    stamp: OfficialStamp | None,
    show_sender_department: bool = True,
    show_recipients: bool = True,
    show_generated_by: bool = True,
    show_generated_at: bool = True,
) -> bytes:
    stream = BytesIO()
    pdf = canvas.Canvas(stream, pagesize=A4)
    font_name = register_arabic_pdf_font()
    width, height = A4
    left = 42
    right = width - 42
    y = height - 42
    background_path = resolve_upload_path(getattr(template, "template_pdf_path", None))
    uses_pdf_template = bool(background_path)
    primary = hex_to_rgb(template.primary_color, (0.05, 0.32, 0.2))
    secondary = hex_to_rgb(template.secondary_color, (0.6, 0.85, 0.3))
    general = db.scalar(select(SettingsGeneral).limit(1))
    theme = pdf_theme(general)
    tz = theme.timezone if theme else ZoneInfo("Asia/Aden")
    now = datetime.now(timezone.utc)

    pdf.setTitle(f"Official Correspondence {message.message_uid or message.id}")
    if uses_pdf_template:
        left = 58
        right = width - 58
        y = height - 150
    else:
        pdf.setFillColorRGB(*primary)
        pdf.rect(0, height - 8, width, 8, fill=1, stroke=0)

        logo_path = resolve_upload_path(template.logo_path) or (theme.logo_path if theme else None)
        if logo_path:
            try:
                pdf.drawImage(ImageReader(str(logo_path)), left, height - 75, width=95, height=45, preserveAspectRatio=True, mask="auto")
            except Exception:
                pass

        bank_name_ar = "بنك القطيبي الإسلامي"
        bank_name_en = "Al Qutaibi Islamic Bank"
        draw_right(pdf, font_name, bank_name_ar, right, y - 8, 16, primary)
        pdf.setFont(font_name, 9)
        pdf.setFillColorRGB(0.32, 0.38, 0.44)
        pdf.drawRightString(right, y - 27, bank_name_en)
        draw_right(pdf, font_name, correspondence_type or "مراسلة رسمية", right, y - 52, 12, primary)
        pdf.setStrokeColorRGB(*secondary)
        pdf.setLineWidth(1.2)
        pdf.line(left, height - 96, right, height - 96)
        y = height - 128

    created_label = format_pdf_datetime(message.created_at or now, tz)
    metadata_rows = [
        ("التاريخ", created_label),
        ("الرقم المرجعي", reference_number or message.message_uid or f"MSG-{message.id}"),
    ]
    if message.related_request and message.related_request.request_number:
        metadata_rows.append(("رقم الطلب", message.related_request.request_number))
    for label, value in metadata_rows:
        draw_right(pdf, font_name, label, right, y, 9, (0.42, 0.47, 0.53))
        draw_right(pdf, font_name, value, right - 100, y, 10, (0.06, 0.09, 0.16))
        y -= 20

    y -= 14
    draw_right(pdf, font_name, "الموضوع", right, y, 9, (0.42, 0.47, 0.53))
    draw_right(pdf, font_name, message.subject, right - 78, y, 13, primary)
    y -= 28

    if show_recipients:
        recipients = "، ".join(recipient.recipient.full_name_ar for recipient in message.recipients if recipient.recipient) or "-"
        draw_right(pdf, font_name, "إلى", right, y, 9, (0.42, 0.47, 0.53))
        for line in wrap_arabic_text(recipients, 60)[:3]:
            draw_right(pdf, font_name, line, right - 48, y, 10)
            y -= 16
        y -= 4

    sender_department = message.sender.department.name_ar if getattr(message.sender, "department", None) else None
    if show_sender_department and sender_department:
        draw_right(pdf, font_name, "إدارة المرسل", right, y, 9, (0.42, 0.47, 0.53))
        draw_right(pdf, font_name, sender_department, right - 92, y, 10)
        y -= 24

    if not uses_pdf_template:
        pdf.setFillColorRGB(0.98, 0.99, 1)
        pdf.setStrokeColorRGB(0.88, 0.91, 0.94)
        pdf.roundRect(left, y - 12, right - left, 24, 5, fill=1, stroke=1)
        draw_right(pdf, font_name, "نص الخطاب", right - 12, y - 4, 10, primary)
        y -= 34
    else:
        y -= 10

    body_text = html_to_text(message.body)
    for line in wrap_arabic_text(body_text, 78):
        if y < 110:
            if not uses_pdf_template:
                draw_footer(pdf, font_name, actor, template, show_generated_by, show_generated_at, now, left, right)
            pdf.showPage()
            y = height - 150 if uses_pdf_template else height - 60
        draw_right(pdf, font_name, line, right, y, 11, (0.08, 0.11, 0.15))
        y -= 18

    y -= 18
    draw_right(pdf, font_name, "مع التحية،", right, y, 11, primary)
    y -= 26
    draw_right(pdf, font_name, message.sender.full_name_ar if message.sender else actor.full_name_ar, right, y, 11)
    if show_sender_department and sender_department:
        y -= 18
        draw_right(pdf, font_name, sender_department, right, y, 9, (0.42, 0.47, 0.53))

    if signature:
        signature_path = resolve_upload_path(signature.signature_image_path)
        if signature_path:
            try:
                pdf.drawImage(ImageReader(str(signature_path)), right - 145, y - 72, width=120, height=48, preserveAspectRatio=True, mask="auto")
            except Exception:
                pass
        draw_right(pdf, font_name, signature.signature_label or "التوقيع", right, y - 82, 8, (0.42, 0.47, 0.53))

    if stamp:
        stamp_path = resolve_upload_path(stamp.stamp_image_path)
        if stamp_path:
            try:
                pdf.drawImage(ImageReader(str(stamp_path)), left + 24, y - 86, width=92, height=72, preserveAspectRatio=True, mask="auto")
            except Exception:
                pass
        draw_center(pdf, font_name, stamp.name_ar, left + 70, y - 96, 8, (0.42, 0.47, 0.53))

    if not uses_pdf_template:
        draw_footer(pdf, font_name, actor, template, show_generated_by, show_generated_at, now, left, right)
    elif template.show_page_number:
        pdf.setFont(font_name, 7)
        pdf.setFillColorRGB(0.42, 0.47, 0.53)
        pdf.drawString(left, 24, f"Page {pdf.getPageNumber()}")
        pdf.setFillColorRGB(0, 0, 0)
    pdf.save()
    stream.seek(0)
    content = stream.read()
    if uses_pdf_template and background_path:
        return merge_pdf_background(background_path, content)
    return content


def draw_footer(
    pdf: canvas.Canvas,
    font_name: str,
    actor: User,
    template: OfficialLetterheadTemplate,
    show_generated_by: bool,
    show_generated_at: bool,
    now: datetime,
    left: float,
    right: float,
) -> None:
    theme = pdf_theme(None)
    pdf.setStrokeColorRGB(0.9, 0.92, 0.95)
    pdf.line(left, 36, right, 36)
    footer_parts = [template.footer_html or "QIB Service Portal"]
    if show_generated_by:
        footer_parts.append(f"أنشئ بواسطة: {actor.full_name_ar}")
    if show_generated_at:
        footer_parts.append(f"تاريخ الإنشاء: {format_pdf_datetime(now, theme.timezone)}")
    draw_right(pdf, font_name, " | ".join(footer_parts), right, 22, 7, (0.42, 0.47, 0.53))
    if template.show_page_number:
        pdf.setFont(font_name, 7)
        pdf.setFillColorRGB(0.42, 0.47, 0.53)
        pdf.drawString(left, 22, f"Page {pdf.getPageNumber()}")
        pdf.setFillColorRGB(0, 0, 0)


def write_official_pdf_file(content: bytes) -> tuple[str, int, str]:
    checksum = hashlib.sha256(content).hexdigest()
    filename = f"{uuid4().hex}.pdf"
    destination = official_storage_dir() / filename
    destination.write_bytes(content)
    relative_path = f"{OFFICIAL_UPLOAD_SUBDIR}/{filename}"
    return relative_path, len(content), checksum


def generate_official_document(
    db: Session,
    *,
    message: InternalMessage,
    actor: User,
    letterhead_template_id: int | None = None,
    reference_number: str | None = None,
    correspondence_type: str | None = None,
    include_signature: bool = False,
    signature_id: int | None = None,
    include_stamp: bool = False,
    stamp_id: int | None = None,
    include_in_request_pdf: bool = False,
    show_sender_department: bool = True,
    show_recipients: bool = True,
    show_generated_by: bool = True,
    show_generated_at: bool = True,
    persist: bool = True,
) -> tuple[bytes, OfficialMessageDocument | None]:
    ensure_official_message_runtime(db)
    settings_row = seed_default_official_settings(db)
    template = db.get(OfficialLetterheadTemplate, letterhead_template_id) if letterhead_template_id else default_letterhead(db)
    if not template or not template.is_active:
        raise ValueError("قالب الترويسة غير موجود أو غير مفعل")
    signature = validate_signature_usage(db, actor, signature_id if include_signature else None, settings_row.allow_unverified_signature)
    stamp = validate_stamp_usage(db, actor, stamp_id if include_stamp else None)
    content = generate_official_pdf_bytes(
        db=db,
        message=message,
        actor=actor,
        template=template,
        reference_number=reference_number,
        correspondence_type=correspondence_type,
        signature=signature,
        stamp=stamp,
        show_sender_department=show_sender_department,
        show_recipients=show_recipients,
        show_generated_by=show_generated_by,
        show_generated_at=show_generated_at,
    )
    if not persist:
        return content, None

    relative_path, size, checksum = write_official_pdf_file(content)
    document = OfficialMessageDocument(
        message_id=message.id,
        related_request_id=message.related_request_id,
        letterhead_template_id=template.id,
        signature_id=signature.id if signature else None,
        stamp_id=stamp.id if stamp else None,
        reference_number=reference_number or message.message_uid,
        pdf_file_path=relative_path,
        file_size=size,
        checksum=checksum,
        generated_by=actor.id,
    )
    db.add(document)
    db.flush()
    message.is_official = True
    message.official_reference_number = reference_number or message.message_uid
    message.include_in_request_pdf = bool(include_in_request_pdf and message.related_request_id)
    message.official_pdf_document_id = document.id
    message.official_status = "sent"
    write_audit(
        db,
        "official_message_pdf_generated",
        "internal_message",
        actor=actor,
        entity_id=str(message.id),
        metadata={"document_id": document.id, "template_id": template.id, "signature_id": signature.id if signature else None, "stamp_id": stamp.id if stamp else None},
    )
    return content, document


def official_document_path(document: OfficialMessageDocument) -> Path:
    path = resolve_upload_path(document.pdf_file_path)
    if not path or not path.exists():
        raise FileNotFoundError("Official PDF file not found")
    return path


def load_official_message_with_document(db: Session, message_id: int) -> InternalMessage | None:
    return db.scalar(
        select(InternalMessage)
        .options(
            selectinload(InternalMessage.sender).selectinload(User.department),
            selectinload(InternalMessage.recipients).selectinload(InternalMessageRecipient.recipient),
            selectinload(InternalMessage.related_request),
            selectinload(InternalMessage.official_documents),
        )
        .where(InternalMessage.id == message_id)
    )
