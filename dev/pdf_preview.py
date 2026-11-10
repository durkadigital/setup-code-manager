"""Generate and inspect synthetic PDF examples without Home Assistant or network access.

Run with the project's .venv/bin/python. Only public protocol test vectors are
used. Intermediate documents and raster images stay in /tmp.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import importlib
import json
import os
import re
import shutil
import subprocess
import sys
import types
from pathlib import Path

from PIL import Image
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
TEMP = Path("/tmp/scm-pdf-validation")
OUTPUT = ROOT / "output/pdf/setup-code-manager-example.pdf"

# Load the standalone production modules without executing HA's integration setup.
package = types.ModuleType("scm_pdf_preview")
package.__path__ = [str(ROOT / "custom_components/setup_code_manager")]
sys.modules[package.__name__] = package
pdf_module = importlib.import_module("scm_pdf_preview.device_pdf")
codes_module = importlib.import_module("scm_pdf_preview.matter_code")

MATTER = "MT:Y.K9042C00KA0648G00"  # CHIP test VID 0xfff1, PIN 20202021.
HOMEKIT = "X-HM://0023ISYWY7STT"  # Existing project protocol test vector.
MANUAL = "34970112332"
NOTE = "OPTIONALE NOTIZTESTDATEN: Äpfel, Öl, Überprüfung, größere Küche und süße Grüße."


def zwave_payload(length: int | None = None) -> str:
    dsk = "0000100002000030000400005000060000765535"
    required = "0010" + "0000100002" + "0220" + "00001000020000300256"
    extra = ""
    if length is not None:
        remaining = length - (52 + len(required))
        while remaining:
            size = min(99, remaining - 4)
            assert size >= 0
            extra += f"98{size:02d}" + "0" * size
            remaining -= 4 + size
    body = "007" + dsk + required + extra
    checksum = int.from_bytes(
        hashlib.sha1(body.encode("ascii"), usedforsecurity=False).digest()[:2], "big"
    )
    result = f"9001{checksum:05d}{body}"
    assert length is None or len(result) == length
    assert codes_module.normalize_setup_code("zwave", result) == result
    return result


def record(name: str, protocol: str, value: str) -> dict:
    code = {
        "protocol": protocol,
        "value": value,
        "label": "TESTDATEN - öffentlicher Protokoll-Testvektor",
    }
    if protocol == "matter":
        code["manual_value"] = MANUAL
    return {
        "name": name,
        "location": "Küche / Obergeschoss",
        "manufacturer": "TESTDATEN",
        "model": "Mustergerät ÄÖÜ äöü ß",
        "serial_number": "TEST-001",
        "notes": NOTE,
        "codes": [code],
    }


def normalized_text(reader: PdfReader) -> str:
    text = "\n".join(page.extract_text() for page in reader.pages)
    text = text.replace("Setup Code Manager", "").replace(
        "Enthält lesbare Einrichtungscodes. Geschützt aufbewahren.", ""
    )
    return re.sub(r"\s+", "", re.sub(r"Seite\s+\d+", "", text))


def build(path: Path, records: list[dict], *, notes: bool = True) -> dict:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = pdf_module.build_device_pdf(records, language="de", include_notes=notes)
    path.write_bytes(data)
    reader = PdfReader(path)
    text = normalized_text(reader)
    for entry in records:
        assert re.sub(r"\s+", "", entry["name"]) in text, (
            "The complete device name must survive line wrapping."
        )
        if notes:
            assert re.sub(r"\s+", "", entry["notes"]) in text, (
                "Opted-in notes must survive all page breaks."
            )
        for code in entry["codes"]:
            assert code["value"] in text, "The complete raw payload must survive pagination."
            if code.get("manual_value"):
                assert "3497-011-2332" in text, (
                    "Matter manual code must remain separate and grouped."
                )
    assert "ÄÖÜäöüß" in text, "German umlauts must survive PDF text extraction."
    assert ("OPTIONALENOTIZTESTDATEN" in text) is notes
    assert "/OpenAction" not in reader.trailer["/Root"]
    assert all(not page.get("/Annots") for page in reader.pages), (
        "Test text must not create links or executable actions."
    )
    return {
        "path": str(path),
        "pages": len(reader.pages),
        "bytes": len(data),
        "records": len(records),
    }


def poppler_tool(name: str, directory: Path | None) -> str | None:
    """Prefer an explicit Poppler directory, then its tool environment override and PATH."""
    if directory is not None:
        return shutil.which(str(directory / name))
    return shutil.which(os.environ.get(name.upper()) or name)


def render(
    path: Path,
    prefix: str,
    *,
    tool: str,
    first: int | None = None,
    last: int | None = None,
    dpi: int = 150,
) -> list[Path]:
    command = [tool, "-png", "-r", str(dpi)]
    if first is not None:
        command += ["-f", str(first)]
    if last is not None:
        command += ["-l", str(last)]
    fontconfig = TEMP / "fonts.conf"
    fontconfig.write_text(f"""<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig><dir>/System/Library/Fonts</dir><dir>/Library/Fonts</dir>
<dir>/System/Library/Fonts/Supplemental</dir><dir>/usr/share/fonts</dir>
<dir>/usr/local/share/fonts</dir><cachedir>{TEMP / "fontconfig-cache"}</cachedir></fontconfig>""")
    environment = {
        **os.environ,
        "FONTCONFIG_FILE": str(fontconfig),
        "XDG_CACHE_HOME": str(TEMP / "cache"),
    }
    subprocess.run(
        [*command, str(path), str(TEMP / prefix)],
        check=True,
        env=environment,
        capture_output=True,
        timeout=45,
    )
    return sorted(TEMP.glob(f"{prefix}-*.png"))


def decode_raster(path: Path, expected: str) -> dict:
    image = Image.open(path).convert("RGBA")
    raw = path.with_suffix(".rgba")
    raw.write_bytes(image.tobytes())
    script = """
const fs = require('node:fs');
const decode = require(process.argv[1]);
const rgba = new Uint8ClampedArray(fs.readFileSync(process.argv[2]));
const result = decode(rgba,Number(process.argv[3]),Number(process.argv[4]));
if (!result) throw new Error('No QR found in rasterized PDF page');
process.stdout.write(JSON.stringify({data:result.data,location:result.location}));
"""
    decoded = json.loads(
        subprocess.check_output(
            [
                "node",
                "-e",
                script,
                str(ROOT / "custom_components/setup_code_manager/www/vendor/jsQR.js"),
                str(raw),
                str(image.width),
                str(image.height),
            ],
            text=True,
        )
    )
    assert decoded["data"] == expected, "Rasterized QR must decode to the exact original payload."
    raw.unlink()
    return {
        "image": str(path),
        "exact_payload_match": True,
        "payload_sha256": hashlib.sha256(expected.encode()).hexdigest(),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--poppler-dir",
        type=Path,
        help="Directory containing pdftoppm and optionally pdfinfo; otherwise use PDFTOPPM/PDFINFO or PATH.",
    )
    parser.add_argument(
        "--skip-render",
        action="store_true",
        help="Generate and check PDF text only; do not run raster or QR validation.",
    )
    args = parser.parse_args()
    TEMP.mkdir(parents=True, exist_ok=True)
    assert codes_module.normalize_setup_code("matter", MATTER) == MATTER
    assert codes_module.manual_pairing_code_from_mt(MATTER) == MANUAL
    assert codes_module.normalize_setup_code("homekit", HOMEKIT) == HOMEKIT
    zwave = zwave_payload()
    samples = [
        record("TESTDATEN - Matter-Gerät ÄÖÜ äöü ß", "matter", MATTER),
        record("TESTDATEN - Wohnzimmer: HomeKit-Gerät", "homekit", HOMEKIT),
        record("TESTDATEN - Flur: Z-Wave-Gerät", "zwave", zwave),
    ]
    samples[1]["location"] = "Wohnzimmer"
    samples[2]["location"] = "Flur"
    results = [build(OUTPUT, samples)]
    assert results[0]["pages"] == 3
    results.append(build(TEMP / "without-notes.pdf", samples, notes=False))
    multi = copy.deepcopy(samples[0])
    multi["name"] = "TESTDATEN - ein Gerät mit drei Kopplungsprotokollen"
    multi["codes"] = [copy.deepcopy(entry["codes"][0]) for entry in samples]
    results.append(build(TEMP / "three-protocols-one-record.pdf", [multi]))
    extreme = record("TESTDATEN - " + "ÄÖÜäöüß" * 35, "zwave", zwave_payload(4096))
    extreme["name"] = (extreme["name"] + "x" * 256)[:256]
    extreme["notes"] = (NOTE + "\nÜberlange Notiz zum Prüfen von Umbrüchen und Umlauten. " * 200)[
        :10000
    ]
    assert len(extreme["name"]) == 256 and len(extreme["notes"]) == 10000
    results.append(build(TEMP / "long-limits.pdf", [extreme]))
    hundred = [copy.deepcopy(samples[0]) for _ in range(100)]
    for index, entry in enumerate(hundred, 1):
        entry["name"] = f"TESTDATEN {index:03d} - ÄÖÜ äöü ß"
    results.append(build(TEMP / "hundred-records.pdf", hundred))
    assert results[-1]["pages"] == 100
    summary = {"documents": results, "raster_qr_readback": [], "synthetic_data_only": True}
    pdfinfo = poppler_tool("pdfinfo", args.poppler_dir)
    if pdfinfo:
        info = subprocess.check_output([pdfinfo, str(OUTPUT)], text=True, timeout=20)
        (TEMP / "example-pdfinfo.txt").write_text(info)
    pdftoppm = poppler_tool("pdftoppm", args.poppler_dir)
    if args.skip_render or not pdftoppm:
        summary["raster_validation"] = "not_run"
        (TEMP / "validation.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        if not args.skip_render:
            parser.exit(
                2,
                "PDF files were generated, but raster/QR validation was not run: pdftoppm was not found. Supply --poppler-dir PATH, set PDFTOPPM=/path/to/pdftoppm, or add Poppler to PATH.\n",
            )
        return
    sample_images = render(OUTPUT, "example", tool=pdftoppm)
    decode_results = [
        decode_raster(image, entry["codes"][0]["value"])
        for image, entry in zip(sample_images, samples, strict=True)
    ]
    render(TEMP / "three-protocols-one-record.pdf", "three-protocols", tool=pdftoppm)
    render(TEMP / "long-limits.pdf", "long-limits", tool=pdftoppm, dpi=110)
    render(TEMP / "hundred-records.pdf", "hundred-first", tool=pdftoppm, first=1, last=1, dpi=110)
    render(
        TEMP / "hundred-records.pdf", "hundred-last", tool=pdftoppm, first=100, last=100, dpi=110
    )
    summary["raster_qr_readback"] = decode_results
    (TEMP / "validation.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
