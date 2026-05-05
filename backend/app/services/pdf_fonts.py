from pathlib import Path

import arabic_reshaper
from bidi.algorithm import get_display
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

ARABIC_PDF_FONT = "FMSArabicPdfFont"


def arabic_font_candidates() -> list[Path]:
    return [
        Path("/usr/share/fonts/truetype/noto/NotoNaskhArabic-Regular.ttf"),
        Path("/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf"),
        Path("/usr/share/fonts/opentype/noto/NotoNaskhArabic-Regular.ttf"),
        Path("/usr/share/fonts/opentype/noto/NotoSansArabic-Regular.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        Path("/Library/Fonts/Tajawal-Regular.ttf"),
        Path("/System/Library/Fonts/Supplemental/Tajawal-Regular.ttf"),
        Path("/System/Library/Fonts/Supplemental/Arial Unicode.ttf"),
        Path("/Library/Fonts/Arial Unicode.ttf"),
        Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
        Path("/System/Library/Fonts/GeezaPro.ttc"),
        Path("/System/Library/Fonts/SFArabic.ttf"),
        Path("C:/Windows/Fonts/tahoma.ttf"),
        Path("C:/Windows/Fonts/arial.ttf"),
        Path("C:/Windows/Fonts/calibri.ttf"),
    ]


def register_arabic_pdf_font() -> str:
    if ARABIC_PDF_FONT in pdfmetrics.getRegisteredFontNames():
        return ARABIC_PDF_FONT

    for path in arabic_font_candidates():
        if path.exists():
            pdfmetrics.registerFont(TTFont(ARABIC_PDF_FONT, str(path)))
            return ARABIC_PDF_FONT

    return "Helvetica"


def rtl_text(value: object) -> str:
    text = str(value or "")
    if not text:
        return ""
    return get_display(arabic_reshaper.reshape(text))
