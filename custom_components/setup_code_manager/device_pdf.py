"""Bounded, offline PDF device cards from an already serialized inventory snapshot."""

from __future__ import annotations

import io
import re
import threading
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape

import reportlab
from reportlab.graphics.barcode.qrencoder import QRCode, QRErrorCorrectLevel
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Flowable,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
)

MAX_PDF_RECORDS = 100
MAX_PDF_BYTES = 8 * 1024 * 1024
MAX_PDF_TEXT_CHARS = 250_000
MAX_PDF_PAGES = 300
MAX_QR_PAYLOAD_CHARS = 1024
MAX_QR_VERSION = 20
MAX_QR_MODULES = 1_500_000
_FONT_LOCK = threading.Lock()
_REGULAR = "SCM-Vera"
_BOLD = "SCM-Vera-Bold"
_PROTOCOLS = {"matter": "Matter", "homekit": "HomeKit", "zwave": "Z-Wave"}
_MESSAGES = {
    "title": ("Gerätekarten", "Device cards"),
    "room": ("Raum", "Room"),
    "noRoom": ("Ohne Raum", "No room"),
    "serial": ("Seriennummer", "Serial number"),
    "codes": ("Kopplungscodes", "Setup codes"),
    "noCode": ("Kein Kopplungscode hinterlegt.", "No setup code saved."),
    "original": ("Einrichtungscode", "Setup code"),
    "payload": ("QR-Inhalt", "QR payload"),
    "manual": ("Manueller Einrichtungscode", "Manual setup code"),
    "derived": ("Aus dem Matter-QR-Code berechnet", "Derived from the Matter QR code"),
    "qrUnavailable": (
        "Für diesen Inhalt ist im PDF kein QR-Code verfügbar. Verwende den vollständigen Inhalt unten.",
        "A QR code is unavailable for this payload in the PDF. Use the complete payload below.",
    ),
    "note": ("Notiz", "Note"),
    "page": ("Seite", "Page"),
    "warning": (
        "Enthält lesbare Einrichtungscodes. Geschützt aufbewahren.",
        "Contains readable setup codes. Keep this file safe.",
    ),
}


class DevicePDFError(Exception):
    """Safe PDF error code; never include submitted contents in diagnostics."""

    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


class _PDFBuffer(io.BytesIO):
    def write(self, data):
        if self.tell() + len(data) > MAX_PDF_BYTES:
            raise DevicePDFError("pdf_too_large")
        return super().write(data)


class _BoundedDocument(SimpleDocTemplate):
    def afterPage(self):  # noqa: N802 -- ReportLab hook name.
        if self.page > MAX_PDF_PAGES:
            raise DevicePDFError("pdf_too_large")


class _VectorQR(Flowable):
    """Draw horizontal black runs directly as PDF paths, with a white quiet zone."""

    def __init__(self, modules: list[list[bool]]) -> None:
        super().__init__()
        self.modules = modules
        self.width = self.height = max(36 * mm, (len(modules) + 8) * 0.4 * mm)
        self.hAlign = "LEFT"

    def draw(self):
        canvas, count = self.canv, len(self.modules)
        unit = self.width / (count + 8)
        canvas.setFillColor(colors.white)
        canvas.rect(0, 0, self.width, self.height, fill=1, stroke=0)
        path = canvas.beginPath()
        for row_number, row in enumerate(self.modules):
            start = None
            for column in range(count + 1):
                black = column < count and row[column]
                if black and start is None:
                    start = column
                elif not black and start is not None:
                    path.rect(
                        (start + 4) * unit,
                        (count + 3 - row_number) * unit,
                        (column - start) * unit,
                        unit,
                    )
                    start = None
        canvas.setFillColor(colors.black)
        canvas.drawPath(path, fill=1, stroke=0)


def _fonts() -> set[int]:
    if _REGULAR not in pdfmetrics.getRegisteredFontNames():
        directory = Path(reportlab.__file__).parent / "fonts"
        pdfmetrics.registerFont(TTFont(_REGULAR, str(directory / "Vera.ttf")))
        pdfmetrics.registerFont(TTFont(_BOLD, str(directory / "VeraBd.ttf")))
    # Metadata uses only glyphs supported in both regular and bold faces.
    return set(pdfmetrics.getFont(_REGULAR).face.charToGlyph) & set(
        pdfmetrics.getFont(_BOLD).face.charToGlyph
    )


def _metadata(value: str, glyphs: set[int]) -> str:
    value = value.replace("\r\n", "\n").replace("\r", "\n").replace("\t", "    ")
    return "".join(
        char
        if char == "\n" or ord(char) >= 32 and ord(char) != 127 and ord(char) in glyphs
        else f"[U+{ord(char):04X}]"
        for char in value
    )


def _paragraph(value: str, style: ParagraphStyle, glyphs: set[int] | None = None) -> Paragraph:
    text = _metadata(value, glyphs) if glyphs is not None else value
    return Paragraph(escape(text).replace("\n", "<br/>"), style)


def _is_qr(code: dict[str, Any]) -> bool:
    value, protocol = code["value"], code["protocol"]
    return (
        protocol == "matter"
        and value.startswith("MT:")
        or protocol == "homekit"
        and value.startswith("X-HM://")
        or protocol == "zwave"
        and re.fullmatch(r"90[0-9]{30,}", value) is not None
    )


def _qr(value: str, remaining: int) -> tuple[_VectorQR | None, int]:
    if len(value) > MAX_QR_PAYLOAD_CHARS:
        return None, 0
    try:
        qr = QRCode(None, QRErrorCorrectLevel.M)
        qr.addData(value)
        version = qr.calculate_version()
        count = 17 + 4 * version
        if version > MAX_QR_VERSION or count * count > remaining:
            return None, 0
        qr.version = version
        qr.make()
        return _VectorQR(qr.modules), count * count
    except Exception:
        # The full original payload and Matter manual value remain available.
        return None, 0


def _checked_records(records: Any, include_notes: bool) -> list[dict[str, Any]]:
    if not isinstance(records, list) or not 1 <= len(records) <= MAX_PDF_RECORDS:
        raise ValueError("Invalid PDF record selection")
    total = 0
    for record in records:
        if not isinstance(record, dict):
            raise ValueError("Invalid PDF record")
        for field in ("name", "location", "manufacturer", "model", "serial_number", "notes"):
            value = record.get(field, "")
            if not isinstance(value, str) or len(value) > (10_000 if field == "notes" else 256):
                raise ValueError("Invalid PDF metadata")
            if field != "notes" or include_notes:
                total += len(value)
        codes = record.get("codes", [])
        if not isinstance(codes, list) or len(codes) > 3:
            raise ValueError("Invalid PDF codes")
        for code in codes:
            if (
                not isinstance(code, dict)
                or not isinstance(code.get("protocol"), str)
                or code["protocol"] not in _PROTOCOLS
                or not isinstance(code.get("value"), str)
                or not 1 <= len(code["value"]) <= 4096
                or not code["value"].isascii()
                or not isinstance(code.get("label", ""), str)
                or len(code.get("label", "")) > 256
            ):
                raise ValueError("Invalid PDF code")
            total += len(code["value"]) + len(code.get("label", ""))
        if total > MAX_PDF_TEXT_CHARS:
            raise DevicePDFError("pdf_too_large")
    return records


def build_device_pdf(
    serialized_records: list[dict[str, Any]], language: str = "de", include_notes: bool = False
) -> bytes:
    """Return a PDF in memory; inputs never become markup, files, URLs or actions."""
    if language not in ("de", "en") or type(include_notes) is not bool:
        raise ValueError("Invalid PDF options")
    records = _checked_records(serialized_records, include_notes)
    index = 0 if language == "de" else 1

    def t(key):
        return _MESSAGES[key][index]

    # ReportLab's registered TTFont objects share document state. Serialize even
    # callers outside the manager, and retain original packaged font notices.
    with _FONT_LOCK:
        glyphs = _fonts()
        rendered_chars = 0
        for record in records:
            fields = ("name", "location", "manufacturer", "model", "serial_number") + (
                ("notes",) if include_notes else ()
            )
            rendered_chars += sum(len(_metadata(record.get(field, ""), glyphs)) for field in fields)
            rendered_chars += sum(
                len(code["value"]) + len(_metadata(code.get("label", ""), glyphs))
                for code in record.get("codes", [])
            )
            if rendered_chars > MAX_PDF_TEXT_CHARS:
                raise DevicePDFError("pdf_too_large")
        normal = ParagraphStyle(
            "body", fontName=_REGULAR, fontSize=10, leading=14, spaceAfter=6, alignment=TA_LEFT
        )
        title = ParagraphStyle(
            "title", parent=normal, fontName=_BOLD, fontSize=20, leading=25, spaceAfter=10
        )
        heading = ParagraphStyle(
            "heading",
            parent=normal,
            fontName=_BOLD,
            fontSize=12,
            leading=17,
            spaceBefore=12,
            keepWithNext=True,
        )
        muted = ParagraphStyle(
            "muted", parent=normal, fontSize=8, leading=11, textColor=colors.HexColor("#52606a")
        )
        code_label = ParagraphStyle("code-label", parent=muted, keepWithNext=True)
        code_style = ParagraphStyle(
            "code", parent=normal, fontName="Courier", fontSize=9, leading=13, splitLongWords=True
        )
        manual_style = ParagraphStyle(
            "manual", parent=normal, fontName="Courier-Bold", fontSize=14, leading=18
        )
        story, qr_modules = [], 0
        for record_number, record in enumerate(records):
            if record_number:
                story.append(PageBreak())
            story.append(_paragraph(record.get("name", ""), title, glyphs))
            story.append(
                _paragraph(f"{t('room')}: {record.get('location') or t('noRoom')}", normal, glyphs)
            )
            model = " · ".join(filter(None, [record.get("manufacturer"), record.get("model")]))
            if model:
                story.append(_paragraph(model, muted, glyphs))
            if record.get("serial_number"):
                story.append(_paragraph(f"{t('serial')}: {record['serial_number']}", muted, glyphs))
            story.append(_paragraph(t("codes"), heading, glyphs))
            codes = record.get("codes", [])
            if not codes:
                story.append(_paragraph(t("noCode"), normal, glyphs))
            for code in codes:
                code_start = [_paragraph(_PROTOCOLS[code["protocol"]], heading, glyphs)]
                if code.get("label"):
                    code_start.append(_paragraph(code["label"], code_label, glyphs))
                if _is_qr(code):
                    qr, used = _qr(code["value"], MAX_QR_MODULES - qr_modules)
                    qr_modules += used
                    code_start.extend(
                        [qr, Spacer(1, 3 * mm)]
                        if qr
                        else [_paragraph(t("qrUnavailable"), code_label, glyphs)]
                    )
                code_tail = [
                    _paragraph(t("payload") if _is_qr(code) else t("original"), code_label, glyphs)
                ]
                code_tail.append(_paragraph(code["value"], code_style))
                manual = code.get("manual_value", "")
                if (
                    code["protocol"] == "matter"
                    and code["value"].startswith("MT:")
                    and isinstance(manual, str)
                    and re.fullmatch(r"(?:[0-9]{11}|[0-9]{21})", manual)
                ):
                    parts = (
                        [manual[:4], manual[4:7], manual[7:]]
                        if len(manual) == 11
                        else [
                            manual[:4],
                            manual[4:7],
                            manual[7:10],
                            manual[10:15],
                            manual[15:20],
                            manual[20:],
                        ]
                    )
                    code_tail.append(_paragraph(t("manual"), code_label, glyphs))
                    code_tail.append(_paragraph("-".join(parts), manual_style))
                    code_tail.append(_paragraph(t("derived"), muted, glyphs))
                # Typical short codes form one bounded visual block. Long
                # payloads/notes remain splittable, while their QR keeps its
                # protocol and source label on the same page.
                if len(code["value"]) <= 256:
                    story.append(KeepTogether(code_start + code_tail))
                else:
                    story.extend([KeepTogether(code_start), *code_tail])
            if include_notes and record.get("notes"):
                story.append(_paragraph(t("note"), heading, glyphs))
                story.append(_paragraph(record["notes"], normal, glyphs))

        def footer(canvas, document):
            canvas.setFont(_REGULAR, 8)
            canvas.setFillColor(colors.HexColor("#52606a"))
            canvas.drawString(16 * mm, A4[1] - 10 * mm, "Setup Code Manager")
            canvas.drawString(16 * mm, 9 * mm, t("warning"))
            canvas.drawRightString(A4[0] - 16 * mm, 9 * mm, f"{t('page')} {document.page}")

        output = _PDFBuffer()
        document = _BoundedDocument(
            output,
            pagesize=A4,
            leftMargin=16 * mm,
            rightMargin=16 * mm,
            topMargin=18 * mm,
            bottomMargin=17 * mm,
            pageCompression=1,
            title=f"Setup Code Manager - {t('title')}",
            author="Setup Code Manager",
        )
        document.build(story, onFirstPage=footer, onLaterPages=footer)
        value = output.getvalue()
        if len(value) > MAX_PDF_BYTES:
            raise DevicePDFError("pdf_too_large")
        return value
