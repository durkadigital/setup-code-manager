"""Synthetic offline PDFs: values, Unicode, pagination, actions and resource bounds."""

import io
from copy import deepcopy

import pytest
from pypdf import PdfReader

from custom_components.setup_code_manager import device_pdf
from custom_components.setup_code_manager.device_pdf import DevicePDFError, build_device_pdf

MATTER = "MT:Y.K9042C00KA0648G00"
HOMEKIT = "X-HM://0023ISYWY7STT"


def record(**overrides):
    return {
        "name": "Synthetisches Gerät Küche €",
        "location": "Kinderzimmer",
        "manufacturer": "Example",
        "model": "Demo",
        "serial_number": "SYNTHETIC-001",
        "notes": "Private synthetic note",
        "codes": [
            {
                "protocol": "matter",
                "value": MATTER,
                "manual_value": "34970112332",
                "label": "Original",
            }
        ],
        **overrides,
    }


def read(document):
    assert document.startswith(b"%PDF-")
    assert len(document) < device_pdf.MAX_PDF_BYTES
    reader = PdfReader(io.BytesIO(document))
    return reader, "\n".join(page.extract_text() for page in reader.pages)


@pytest.mark.parametrize("language", ["de", "en"])
def test_pdf_has_original_payload_derived_manual_code_and_embedded_unicode_fonts(language):
    source = record()
    before = deepcopy(source)
    reader, text = read(build_device_pdf([source], language=language))
    assert MATTER in text and "3497-011-2332" in text
    assert "Synthetisches Gerät Küche €" in text and "Kinderzimmer" in text
    assert "Original" in text and "Example" in text and "SYNTHETIC-001" in text
    assert "Private synthetic note" not in text
    assert ("Manueller Einrichtungscode" if language == "de" else "Manual setup code") in text
    assert source == before
    fonts = [font.get_object() for font in reader.pages[0]["/Resources"]["/Font"].values()]
    embedded = [font for font in fonts if "/FontDescriptor" in font]
    assert len(embedded) >= 2
    assert all("/FontFile2" in font["/FontDescriptor"] for font in embedded)
    assert "/OpenAction" not in reader.trailer["/Root"]
    assert "/Names" not in reader.trailer["/Root"]
    assert all("/Annots" not in page and "/AA" not in page for page in reader.pages)
    operations = reader.pages[0].get_contents().operations
    assert sum(operator == b"re" for _operands, operator in operations) > 20


def test_long_manual_code_keeps_leading_zero_and_manual_inputs_do_not_gain_qr_or_derived_value():
    reader, text = read(
        build_device_pdf(
            [
                record(
                    codes=[
                        {
                            "protocol": "matter",
                            "value": "03497011233",
                            "manual_value": "34970112332",
                        },
                        {
                            "protocol": "homekit",
                            "value": "031-45-154",
                            "manual_value": "34970112332",
                        },
                    ]
                )
            ]
        )
    )
    assert "03497011233" in text and "031-45-154" in text
    assert "3497-011-2332" not in text
    assert (
        sum(operator == b"re" for _operands, operator in reader.pages[0].get_contents().operations)
        == 0
    )
    _reader, long_text = read(
        build_device_pdf(
            [
                record(
                    codes=[
                        {
                            "protocol": "matter",
                            "value": MATTER,
                            "manual_value": "012345678901234567890",
                        }
                    ]
                )
            ]
        )
    )
    assert "0123-456-789-01234-56789-0" in long_text


def test_homekit_and_zwave_original_families_have_vector_qrs():
    for protocol, value in (("homekit", HOMEKIT), ("zwave", "90" + "1234567890" * 6)):
        reader, text = read(
            build_device_pdf([record(codes=[{"protocol": protocol, "value": value}])])
        )
        assert value in text.replace("\n", "")
        assert (
            sum(
                operator == b"re"
                for _operands, operator in reader.pages[0].get_contents().operations
            )
            > 20
        )


def test_metadata_is_escaped_not_markup_and_missing_glyphs_are_explicit():
    injected = '<img src="https://example.invalid/private"/><a href="javascript:alert(1)">'
    reader, text = read(
        build_device_pdf(
            [
                record(
                    name="Küche 😀 漢",
                    notes=injected,
                    codes=[
                        {
                            "protocol": "homekit",
                            "value": "031-45-154",
                            "label": injected,
                        }
                    ],
                )
            ],
            include_notes=True,
        )
    )
    assert "Küche [U+1F600] [U+6F22]" in text
    assert '<img src="https://example.invalid/private"/>' in text
    assert "javascript:alert(1)" in text
    assert all("/Annots" not in page for page in reader.pages)


def test_long_notes_continue_across_pages_without_keep_together_or_truncation():
    notes = ("Lange Notiz mit Übergröße und € Kosten.\n" * 260)[:9800] + "\nEND-NOTE-SYNTHETIC"
    reader, text = read(build_device_pdf([record(notes=notes)], include_notes=True))
    assert len(reader.pages) > 2
    assert "END-NOTE-SYNTHETIC" in text
    assert text.count("Lange Notiz mit Übergröße") == notes.count("Lange Notiz mit Übergröße")


def test_each_device_starts_on_a_new_page_and_selection_order_is_preserved():
    reader, _text = read(
        build_device_pdf(
            [record(name="Second requested", codes=[]), record(name="First requested", codes=[])]
        )
    )
    assert len(reader.pages) == 2
    assert "Second requested" in reader.pages[0].extract_text()
    assert "First requested" in reader.pages[1].extract_text()
    assert "Kein Kopplungscode hinterlegt." in reader.pages[1].extract_text()


def test_protocol_heading_and_source_label_stay_with_their_qr_on_page_break():
    reader, _text = read(
        build_device_pdf(
            [
                record(
                    codes=[
                        {
                            "protocol": "matter",
                            "value": MATTER,
                            "manual_value": "34970112332",
                            "label": "Matter source",
                        },
                        {"protocol": "homekit", "value": HOMEKIT, "label": "HomeKit source"},
                        {
                            "protocol": "zwave",
                            "value": "90" + "1234567890" * 6,
                            "label": "Z-Wave source",
                        },
                    ]
                )
            ]
        )
    )
    assert len(reader.pages) >= 2
    for page in reader.pages:
        text = page.extract_text()
        if "Z-Wave source" in text:
            assert "Z-Wave" in text
            assert "90" + "1234567890" * 6 in text.replace("\n", "")
            assert (
                sum(operator == b"re" for _operands, operator in page.get_contents().operations)
                > 20
            )


def test_qr_overflow_is_visible_and_original_payload_is_complete():
    payload = "MT:" + "A" * 1300
    _reader, text = read(
        build_device_pdf(
            [
                record(
                    codes=[{"protocol": "matter", "value": payload, "manual_value": "34970112332"}]
                )
            ]
        )
    )
    assert "kein QR-Code verfügbar" in text
    assert payload in text.replace("\n", "")
    assert "3497-011-2332" in text


@pytest.mark.parametrize("budget,value", [("MAX_QR_MODULES", 0), ("MAX_QR_VERSION", 1)])
def test_qr_resource_limits_fall_back_without_dropping_the_code(monkeypatch, budget, value):
    monkeypatch.setattr(device_pdf, budget, value)
    _reader, text = read(build_device_pdf([record()]))
    assert "kein QR-Code verfügbar" in text and MATTER in text


@pytest.mark.parametrize(
    "budget,value", [("MAX_PDF_TEXT_CHARS", 10), ("MAX_PDF_PAGES", 0), ("MAX_PDF_BYTES", 100)]
)
def test_pdf_resource_limits_fail_with_safe_error(monkeypatch, budget, value):
    monkeypatch.setattr(device_pdf, budget, value)
    with pytest.raises(DevicePDFError, match="^pdf_too_large$"):
        build_device_pdf([record()])


@pytest.mark.parametrize(
    "records", [None, [], [None], [{}] * 101, [record(codes=[{}])], [record(name=3)]]
)
def test_invalid_renderer_inputs_are_rejected_without_including_values_in_errors(records):
    with pytest.raises(ValueError) as error:
        build_device_pdf(records)
    assert MATTER not in str(error.value)


def test_one_hundred_typical_device_cards_remain_within_pdf_byte_and_page_budgets():
    records = [record(name=f"Synthetic device {number}") for number in range(100)]
    reader, text = read(build_device_pdf(records))
    assert len(reader.pages) == 100
    assert text.count(MATTER) == 100
    assert text.count("3497-011-2332") == 100
