"""Versioned, preview-first data exchange without I/O or Home Assistant access.

JSON is a full backup. CSV has one metadata row and one row per code (or a
code-free record row). Every data cell is escaped by prepending an apostrophe;
the importer removes exactly that one character. This protects text, leading
zeros and formula-like values without losing literal leading apostrophes.

Invalid individual records are returned as __error__/__key__/__raw__ sentinels.
Malformed documents, unsupported schemas and excessive sizes raise ValueError.
Sentinels must never be persisted. Preview rows omit their raw contents.
"""

# ruff: noqa: TRY004 -- all invalid external input uses the public ValueError contract.

from __future__ import annotations

import csv
import hashlib
import io
import json
from collections import Counter
from copy import deepcopy
from typing import Any
from uuid import NAMESPACE_URL, uuid5

from .inventory import MAX_RECORDS, TEXT_LIMITS, _identifier, validate_record

SCHEMA_VERSION = 1
FORMAT_NAME = "setup-code-manager"
MAX_CONTENT_BYTES = 16 * 1024 * 1024
_RECORD_CSV_FIELDS = (
    "id",
    *TEXT_LIMITS,
    "archived",
    "created_at",
    "updated_at",
    "links",
    "source_refs",
)
CSV_FIELDS = (
    "format",
    "schema_version",
    "instance_id",
    "revision",
    "row_type",
    *_RECORD_CSV_FIELDS,
    "code_id",
    "protocol",
    "value",
    "label",
)
_ENVELOPE_FIELDS = frozenset({"format", "schema_version", "instance_id", "revision", "devices"})


class ImportIssue(dict[str, Any]):
    """Internal invalid-record marker; a JSON object cannot forge this type."""


def _revision(value: Any) -> int:
    if type(value) is not int or value < 0 or value > 2**63 - 1:
        raise ValueError("Invalid revision: expected a nonnegative integer.")
    return value


def _records(value: Any) -> list[Any]:
    if not isinstance(value, list) or len(value) > MAX_RECORDS:
        raise ValueError("Invalid devices: expected at most 10000 records.")
    return value


def _json_load(content: str) -> Any:
    def unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("Duplicate JSON object key.")
            result[key] = value
        return result

    def reject_constant(_value: str) -> None:
        raise ValueError("Non-finite numbers are not valid import data.")

    try:
        return json.loads(content, object_pairs_hook=unique_object, parse_constant=reject_constant)
    except (json.JSONDecodeError, RecursionError) as err:
        raise ValueError("The import is not valid JSON.") from err


def _invalid(raw: Any, error: str, index: int) -> dict[str, Any]:
    raw_id = raw.get("id") if isinstance(raw, dict) else None
    try:
        record_id = _identifier(raw_id, "record ID")
    except ValueError:
        record_id = f"invalid-{index}"
    name = raw.get("name", "") if isinstance(raw, dict) else ""
    return ImportIssue(
        {
            "id": record_id,
            "name": name[:256] if isinstance(name, str) else "",
            "__error__": error,
            "__key__": f"invalid-{index}",
            "__raw__": deepcopy(raw),
        }
    )


def _validated_import(records: list[Any], *, preserve_links: bool) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for index, raw in enumerate(records):
        if isinstance(raw, ImportIssue):
            results.append(raw)
            continue
        try:
            record = validate_record(raw)
            if not preserve_links:
                record["links"] = []
            results.append(record)
        except ValueError as err:
            results.append(_invalid(raw, str(err), index))
    counts = Counter(record["id"] for record in results)
    return [
        _invalid(record.get("__raw__", record), "Duplicate record ID in the import.", index)
        if counts[record["id"]] > 1
        else record
        for index, record in enumerate(results)
    ]


def export_data(format: str, data: dict[str, Any]) -> str:
    """Export a validated store as JSON or formula-safe, versioned CSV."""
    if not isinstance(data, dict):
        raise ValueError("Invalid export data.")
    instance_id = _identifier(data.get("instance_id"), "instance ID")
    revision = _revision(data.get("revision", 0))
    devices = [validate_record(record) for record in _records(data.get("devices"))]
    if len({record["id"] for record in devices}) != len(devices):
        raise ValueError("Duplicate record IDs in export data.")
    envelope = {
        "format": FORMAT_NAME,
        "schema_version": SCHEMA_VERSION,
        "instance_id": instance_id,
        "revision": revision,
        "devices": devices,
    }
    if format == "json":
        result = json.dumps(envelope, ensure_ascii=False, indent=2) + "\n"
    elif format == "csv":
        result = _export_csv(envelope)
    else:
        raise ValueError("Supported export formats are json and csv.")
    if len(result.encode("utf-8")) > MAX_CONTENT_BYTES:
        raise ValueError("The export exceeds the 16 MiB exchange-file limit.")
    return result


def _export_csv(data: dict[str, Any]) -> str:
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(
        stream, fieldnames=CSV_FIELDS, lineterminator="\r\n", quoting=csv.QUOTE_ALL
    )
    writer.writeheader()
    base = {
        "format": FORMAT_NAME,
        "schema_version": str(SCHEMA_VERSION),
        "instance_id": data["instance_id"],
        "revision": str(data["revision"]),
    }

    def write(row: dict[str, str]) -> None:
        writer.writerow({field: "'" + row.get(field, "") for field in CSV_FIELDS})

    write({**base, "row_type": "metadata"})
    for record in data["devices"]:
        fields = {field: record[field] for field in _RECORD_CSV_FIELDS}
        fields["archived"] = "true" if record["archived"] else "false"
        for field in ("links", "source_refs"):
            fields[field] = json.dumps(record[field], ensure_ascii=False, separators=(",", ":"))
        if not record["codes"]:
            write({**base, **fields, "row_type": "record"})
        for code in record["codes"]:
            write(
                {
                    **base,
                    **fields,
                    "row_type": "code",
                    "code_id": code["id"],
                    "protocol": code["protocol"],
                    "value": code["value"],
                    "label": code["label"],
                }
            )
    return stream.getvalue()


def parse_import(format: str, content: str, instance_id: str) -> list[dict[str, Any]]:
    """Parse records for preview, never writing data or matching by name/code.

    JSON/CSV from a different instance lose HA links. ``legacy`` means a local
    original Setup Codes file and retains links for the caller to revalidate.
    For an uploaded legacy file, the caller must clear links before applying it.
    """
    _identifier(instance_id, "instance ID")
    if not isinstance(content, str):
        raise ValueError("Import content must be UTF-8 text.")
    try:
        byte_length = len(content.encode("utf-8"))
    except UnicodeEncodeError as err:
        raise ValueError("Import content must be valid UTF-8 text.") from err
    if byte_length > MAX_CONTENT_BYTES:
        raise ValueError("Import file exceeds the 16 MiB limit.")
    content = content.removeprefix("\ufeff")
    if format == "csv":
        return _parse_csv(content, instance_id)
    if format not in ("json", "legacy"):
        raise ValueError("Supported import formats are json, csv and legacy.")
    data = _json_load(content)
    if not isinstance(data, dict):
        raise ValueError("Import must contain a JSON object.")
    if format == "legacy":
        return _parse_legacy(data)
    if set(data) != _ENVELOPE_FIELDS:
        raise ValueError("Invalid JSON backup fields.")
    if (
        data["format"] != FORMAT_NAME
        or type(data["schema_version"]) is not int
        or data["schema_version"] != SCHEMA_VERSION
    ):
        raise ValueError("Unsupported JSON backup format or schema version.")
    source = _identifier(data["instance_id"], "source instance ID")
    _revision(data["revision"])
    return _validated_import(_records(data["devices"]), preserve_links=source == instance_id)


def _parse_csv(content: str, instance_id: str) -> list[dict[str, Any]]:
    reader = csv.DictReader(io.StringIO(content, newline=""), strict=True)
    try:
        if reader.fieldnames != list(CSV_FIELDS):
            raise ValueError("CSV columns do not match the versioned export schema.")
        rows = []
        for row in reader:
            if len(rows) >= MAX_RECORDS * 3 + 1:
                raise ValueError("Too many CSV rows.")
            if set(row) != set(CSV_FIELDS) or any(
                not isinstance(value, str) or not value.startswith("'") for value in row.values()
            ):
                raise ValueError("Invalid CSV row or missing reversible text escaping.")
            rows.append({key: value[1:] for key, value in row.items()})
    except csv.Error as err:
        raise ValueError("The import is not valid CSV.") from err
    if not rows or rows[0]["row_type"] != "metadata":
        raise ValueError("CSV metadata row is missing.")
    metadata = rows[0]
    if metadata["format"] != FORMAT_NAME or metadata["schema_version"] != str(SCHEMA_VERSION):
        raise ValueError("Unsupported CSV format or schema version.")
    source = _identifier(metadata["instance_id"], "source instance ID")
    if (
        len(metadata["revision"]) > 19
        or not metadata["revision"].isascii()
        or not metadata["revision"].isdigit()
    ):
        raise ValueError("Invalid CSV revision.")
    _revision(int(metadata["revision"]))
    if any(
        metadata[field] for field in (*_RECORD_CSV_FIELDS, "code_id", "protocol", "value", "label")
    ):
        raise ValueError("CSV metadata row contains record data.")
    groups: dict[str, list[dict[str, str]]] = {}
    for row in rows[1:]:
        if any(
            row[field] != metadata[field]
            for field in ("format", "schema_version", "instance_id", "revision")
        ):
            raise ValueError("CSV contains inconsistent metadata.")
        if row["row_type"] not in ("record", "code"):
            raise ValueError("Unsupported CSV row type.")
        groups.setdefault(row["id"], []).append(row)
    _records(list(groups))
    records = []
    for index, group in enumerate(groups.values()):
        first = group[0]
        record = {field: first[field] for field in _RECORD_CSV_FIELDS}
        try:
            if any(
                any(row[field] != first[field] for field in _RECORD_CSV_FIELDS) for row in group
            ):
                raise ValueError("CSV rows for one record contain conflicting metadata.")
            if first["archived"] not in ("true", "false"):
                raise ValueError("Invalid CSV archive flag.")
            record["archived"] = first["archived"] == "true"
            for field in ("links", "source_refs"):
                record[field] = _json_load(first[field])
            record["codes"] = []
            for row in group:
                if row["row_type"] == "record":
                    if len(group) != 1 or any(
                        row[field] for field in ("code_id", "protocol", "value", "label")
                    ):
                        raise ValueError("A code-free CSV record must occupy one empty-code row.")
                else:
                    record["codes"].append(
                        {
                            "id": row["code_id"],
                            "protocol": row["protocol"],
                            "value": row["value"],
                            "label": row["label"],
                        }
                    )
            records.append(record)
        except ValueError as err:
            records.append(_invalid(record, str(err), index))
    return _validated_import(records, preserve_links=source == instance_id)


def _parse_legacy(data: dict[str, Any]) -> list[dict[str, Any]]:
    if "data" in data:
        if (
            data.get("key") != "setup_codes"
            or type(data.get("version")) is not int
            or data["version"] != 1
        ):
            raise ValueError("Unsupported legacy storage key or version.")
        data = data["data"]
    if not isinstance(data, dict) or set(data) != {"devices"}:
        raise ValueError("Expected original Setup Codes storage data.")
    records = []
    for index, raw in enumerate(_records(data["devices"])):
        try:
            if not isinstance(raw, dict):
                raise ValueError("Invalid legacy record.")
            legacy_id = raw.get("id")
            if legacy_id is not None:
                legacy_id = _identifier(legacy_id, "legacy record ID")
            else:
                legacy_id = hashlib.sha256(
                    json.dumps(raw, sort_keys=True, ensure_ascii=False).encode()
                ).hexdigest()
            source_ref = f"setup_codes:{legacy_id}"
            record_id = uuid5(NAMESPACE_URL, f"setup-code-manager:{source_ref}").hex
            record: dict[str, Any] = {
                "id": record_id,
                "name": raw.get("name") or "Gerät",
                "archived": False,
                "codes": [],
                "links": [],
                "source_refs": [source_ref],
                "created_at": raw.get("created_at") or "",
                "updated_at": raw.get("updated_at") or "",
            }
            # Keep historical identifiers as provenance only. Include the
            # original record ID so equal area/native IDs never become a shared
            # reference that could accidentally merge two imported devices.
            for field in ("native_id", "area_id"):
                original = raw.get(field)
                if original is not None and original != "":
                    if not isinstance(original, str):
                        raise ValueError("Invalid legacy identifier metadata.")
                    record["source_refs"].append(f"{source_ref}:{field}={original}")
            for field in TEXT_LIMITS:
                if field != "name":
                    record[field] = raw.get(field) if raw.get(field) is not None else ""
            # The original file can contain a historical area name, but an area
            # ID is an instance-local identifier, not a human-readable location.
            if not record["location"] and raw.get("area_name"):
                record["location"] = raw["area_name"]
            code = raw.get("setup_code")
            if code is not None and code != "":
                record["codes"] = [
                    {
                        "id": uuid5(NAMESPACE_URL, f"{source_ref}:code").hex,
                        "protocol": raw.get("protocol"),
                        "value": code,
                        "label": "",
                    }
                ]
            ha_id = raw.get("ha_device_id")
            if (
                ha_id
                and raw.get("status") != "removed"
                and raw.get("in_home_assistant") is not False
            ):
                record["links"] = [{"ha_device_id": ha_id}]
            # Validate here so invalid legacy values remain visible in preview.
            records.append(validate_record(record))
        except (ValueError, TypeError) as err:
            message = str(err) if isinstance(err, ValueError) else "Invalid legacy record data."
            records.append(_invalid(raw, message, index))
    return _validated_import(records, preserve_links=True)


def _comparison(record: dict[str, Any]) -> dict[str, Any]:
    result = deepcopy(record)
    result["codes"] = sorted(result["codes"], key=lambda code: code["id"])
    result["links"] = sorted(result["links"], key=lambda link: link["ha_device_id"])
    result["source_refs"] = sorted(result["source_refs"])
    return result


def preview_import(
    current: list[dict[str, Any]], incoming: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Compare by ID only; never merge by a name, link, or shared setup code.

    Each row has key/id/name/status/reason/existing/incoming. Invalid raw data is
    deliberately excluded from preview rows. Callers must apply decisions under
    their own revision check and persistence lock.
    """
    records = [validate_record(record) for record in _records(current)]
    by_id = {record["id"]: record for record in records}
    if len(by_id) != len(records):
        raise ValueError("Duplicate record IDs in current inventory.")
    candidates = _validated_import(_records(incoming), preserve_links=True)
    result = []
    for index, record in enumerate(candidates):
        record_id = record["id"]
        invalid = "__error__" in record
        existing = by_id.get(record_id)
        status = (
            "invalid"
            if invalid
            else "new"
            if existing is None
            else ("unchanged" if _comparison(existing) == _comparison(record) else "conflict")
        )
        result.append(
            {
                "key": f"row-{index}",
                "id": record_id,
                "name": record["name"],
                "status": status,
                "reason": record.get("__error__", ""),
                "existing": deepcopy(existing) if not invalid else None,
                "incoming": deepcopy(record) if not invalid else None,
            }
        )
    return result
