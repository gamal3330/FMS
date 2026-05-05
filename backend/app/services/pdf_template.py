from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen.canvas import Canvas

from app.core.config import get_settings
from app.models.settings import SettingsGeneral
from app.services.pdf_fonts import rtl_text

settings = get_settings()


@dataclass(frozen=True)
class PdfTheme:
    system_name: str
    brand: tuple[float, float, float]
    brand_dark: tuple[float, float, float]
    brand_soft: tuple[float, float, float]
    logo_path: Path | None
    timezone: ZoneInfo


def hex_to_rgb(hex_value: str | None, fallback: tuple[float, float, float] = (0.05, 0.39, 0.22)) -> tuple[float, float, float]:
    if not hex_value or not isinstance(hex_value, str) or not hex_value.startswith("#") or len(hex_value) != 7:
        return fallback
    try:
        return tuple(int(hex_value[index : index + 2], 16) / 255 for index in (1, 3, 5))
    except ValueError:
        return fallback


def pdf_theme(general: SettingsGeneral | None) -> PdfTheme:
    brand = hex_to_rgb(general.brand_color if general else None)
    timezone_name = general.timezone if general and general.timezone else "Asia/Qatar"
    try:
        tz = ZoneInfo(timezone_name)
    except Exception:
        tz = ZoneInfo("Asia/Qatar")

    return PdfTheme(
        system_name=(general.system_name if general and general.system_name else "النظام"),
        brand=brand,
        brand_dark=tuple(max(channel * 0.62, 0) for channel in brand),
        brand_soft=tuple(channel + (1 - channel) * 0.88 for channel in brand),
        logo_path=logo_file_path(general),
        timezone=tz,
    )


def logo_file_path(general: SettingsGeneral | None) -> Path | None:
    if not general or not general.logo_url:
        return None
    path = Path(settings.upload_dir) / "logos" / Path(general.logo_url).name
    return path if path.exists() and path.suffix.lower() in {".png", ".jpg", ".jpeg"} else None


def format_pdf_datetime(value: datetime | None, tz: ZoneInfo) -> str:
    if not value:
        return "-"
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    formatted = value.astimezone(tz).strftime("%Y/%m/%d %I:%M %p")
    return formatted.replace("AM", "ص").replace("PM", "م")


def draw_text(pdf: Canvas, font: str, value: object, x: float, y: float, size: int = 10, color: tuple[float, float, float] = (0, 0, 0)) -> None:
    pdf.setFillColorRGB(*color)
    pdf.setFont(font, size)
    pdf.drawRightString(x, y, rtl_text(value))
    pdf.setFillColorRGB(0, 0, 0)


def draw_ltr_text(pdf: Canvas, font: str, value: object, x: float, y: float, size: int = 9, color: tuple[float, float, float] = (0, 0, 0)) -> None:
    pdf.setFillColorRGB(*color)
    pdf.setFont(font, size)
    pdf.drawString(x, y, str(value or ""))
    pdf.setFillColorRGB(0, 0, 0)


def draw_cover_header(pdf: Canvas, theme: PdfTheme, font: str, title: str, subtitle: str = "") -> float:
    width, height = A4
    left = 36
    right = width - 36
    pdf.setFillColorRGB(*theme.brand)
    pdf.rect(0, height - 92, width, 92, fill=1, stroke=0)

    if theme.logo_path:
        try:
            pdf.drawImage(ImageReader(str(theme.logo_path)), left + 4, height - 71, width=92, height=44, preserveAspectRatio=True, mask="auto")
        except Exception:
            pass

    draw_text(pdf, font, theme.system_name, right, height - 30, 13, (1, 1, 1))
    draw_text(pdf, font, title[:48], right, height - 58, 21, (1, 1, 1))
    if subtitle:
        draw_text(pdf, font, subtitle, right, height - 77, 9, (0.88, 0.96, 0.91))
    return height - 122


def draw_page_header(pdf: Canvas, theme: PdfTheme, font: str, document_ref: str = "") -> float:
    width, height = A4
    left = 36
    right = width - 36
    pdf.setFillColorRGB(*theme.brand)
    pdf.rect(0, height - 8, width, 8, fill=1, stroke=0)
    draw_ltr_text(pdf, font, document_ref, left, height - 24, 8, (0.45, 0.5, 0.58))
    draw_text(pdf, font, theme.system_name, right, height - 24, 8, (0.45, 0.5, 0.58))
    pdf.setStrokeColorRGB(0.9, 0.92, 0.95)
    pdf.line(left, height - 31, right, height - 31)
    return height - 48


def draw_footer(pdf: Canvas, font: str, actor_text: str, left: float = 36, right: float | None = None) -> None:
    width, _ = A4
    right = right or width - left
    pdf.setStrokeColorRGB(0.9, 0.92, 0.95)
    pdf.line(left, 26, right, 26)
    draw_text(pdf, font, actor_text, right, 14, 8, (0.45, 0.5, 0.58))
    draw_ltr_text(pdf, font, f"Page {pdf.getPageNumber()}", left, 14, 8, (0.45, 0.5, 0.58))


def draw_section_header(pdf: Canvas, theme: PdfTheme, font: str, title: str, left: float, right: float, y: float) -> float:
    pdf.setFillColorRGB(*theme.brand_soft)
    pdf.roundRect(left, y - 27, right - left, 32, 6, fill=1, stroke=0)
    pdf.setFillColorRGB(*theme.brand_dark)
    pdf.circle(right - 18, y - 11, 4, fill=1, stroke=0)
    draw_text(pdf, font, title, right - 32, y - 16, 12, theme.brand_dark)
    return y - 44


def draw_field_box(pdf: Canvas, font: str, key: str, value: object, x: float, y: float, width: float) -> None:
    pdf.setFillColorRGB(0.98, 0.99, 1)
    pdf.setStrokeColorRGB(0.88, 0.91, 0.94)
    pdf.roundRect(x, y - 52, width, 52, 5, fill=1, stroke=1)
    draw_text(pdf, font, key, x + width - 12, y - 17, 8, (0.45, 0.5, 0.58))
    draw_text(pdf, font, str(value or "-")[:44], x + width - 12, y - 36, 10, (0.06, 0.09, 0.16))
