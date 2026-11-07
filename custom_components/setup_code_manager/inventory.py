"""Pure validation for durable inventory records (no Home Assistant imports)."""

# ruff: noqa: TRY004 -- all invalid external input uses the public ValueError contract.

from __future__ import annotations

import re
from copy import deepcopy
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from .matter_code import normalize_setup_code

PROTOCOLS = frozenset({"matter", "homekit", "zwave"})
MAX_RECORDS = 10000
MAX_CODES = 3
MAX_LINKS = 32
MAX_SOURCE_REFS = 64
TEXT_LIMITS = {
    "name": 256,
    "manufacturer": 256,
    "model": 256,
    "serial_number": 256,
    "location": 256,
    "notes": 10000,
}
RECORD_FIELDS = frozenset(
    {
        "id",
        *TEXT_LIMITS,
        "archived",
        "codes",
        "links",
        "created_at",
        "updated_at",
        "source_refs",
    }
)
_IDENTIFIER = re.compile(r"[A-Za-z0-9_.:-]{1,128}\Z")


def _text(value: Any, field: str, limit: int, *, nonempty: bool = False) -> str:
    if not isinstance(value, str) or len(value) > limit or "\x00" in value:
        raise ValueError(f"Invalid {field}: expected text up to {limit} characters.")
    if nonempty and not value.strip():
        raise ValueError(f"Invalid {field}: text is required.")
    return value


def _identifier(value: Any, field: str) -> str:
    if not isinstance(value, str) or not _IDENTIFIER.fullmatch(value):
        raise ValueError(f"Invalid {field}: expected a nonempty identifier.")
    return value


def _object(value: Any, fields: frozenset[str], context: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"Invalid {context}: expected an object.")
    if set(value) - fields:
        raise ValueError(f"Invalid {context}: unknown fields are not supported.")
    return value


def _timestamp(value: Any, field: str) -> str:
    text = _text(value, field, 64)
    if text:
        try:
            parsed = datetime.fromisoformat(text)
        except ValueError as err:
            raise ValueError(f"Invalid {field}: expected an ISO timestamp.") from err
        if parsed.tzinfo is None:
            raise ValueError(f"Invalid {field}: timestamp needs a timezone.")
    return text


def validate_record(record: Any) -> dict[str, Any]:
    """Validate and copy a record, canonicalizing codes and adding optional defaults.

    Unknown fields are rejected. IDs and code IDs are mandatory. Empty codes must
    be represented by an empty codes list, never by a code with an empty value.
    Messages deliberately contain no supplied values or setup codes.
    """
    raw = _object(record, RECORD_FIELDS, "record")
    result = {"id": _identifier(raw.get("id"), "record ID")}
    for field, limit in TEXT_LIMITS.items():
        result[field] = _text(raw.get(field, ""), field, limit, nonempty=field == "name")
    archived = raw.get("archived", False)
    if type(archived) is not bool:
        raise ValueError("Invalid archived: expected a boolean.")
    result["archived"] = archived
    for field in ("created_at", "updated_at"):
        result[field] = _timestamp(raw.get(field, ""), field)

    codes = raw.get("codes", [])
    if not isinstance(codes, list) or len(codes) > MAX_CODES:
        raise ValueError("Invalid codes: expected at most three protocol codes.")
    result["codes"] = []
    seen_protocols: set[str] = set()
    seen_ids: set[str] = set()
    for value in codes:
        code = _object(value, frozenset({"id", "protocol", "value", "label"}), "code")
        code_id = _identifier(code.get("id"), "code ID")
        protocol = code.get("protocol")
        if not isinstance(protocol, str) or protocol not in PROTOCOLS:
            raise ValueError("Invalid code protocol.")
        if protocol in seen_protocols or code_id in seen_ids:
            raise ValueError("Duplicate code ID or protocol within one record.")
        raw_code = _text(code.get("value"), "setup code", 4096, nonempty=True)
        if not raw_code.isascii():
            raise ValueError("Invalid setup code: only ASCII code characters are accepted.")
        try:
            normalized = normalize_setup_code(protocol, raw_code)
        except (ValueError, IndexError, TypeError) as err:
            raise ValueError(f"Invalid {protocol} setup code.") from err
        if not normalized:
            raise ValueError("An empty setup code must be removed from the code list.")
        result["codes"].append(
            {
                "id": code_id,
                "protocol": protocol,
                "value": normalized,
                "label": _text(code.get("label", ""), "code label", 256),
            }
        )
        seen_ids.add(code_id)
        seen_protocols.add(protocol)

    links = raw.get("links", [])
    if not isinstance(links, list) or len(links) > MAX_LINKS:
        raise ValueError("Invalid links: expected at most 32 device links.")
    result["links"] = []
    seen_links: set[str] = set()
    for value in links:
        link = _object(value, frozenset({"ha_device_id"}), "device link")
        ha_id = _identifier(link.get("ha_device_id"), "Home Assistant device ID")
        if ha_id in seen_links:
            raise ValueError("Duplicate Home Assistant device link.")
        result["links"].append({"ha_device_id": ha_id})
        seen_links.add(ha_id)

    refs = raw.get("source_refs", [])
    if not isinstance(refs, list) or len(refs) > MAX_SOURCE_REFS:
        raise ValueError("Invalid source references.")
    result["source_refs"] = []
    for ref in refs:
        ref = _text(ref, "source reference", 512, nonempty=True)
        if ref in result["source_refs"]:
            raise ValueError("Duplicate source reference.")
        result["source_refs"].append(ref)
    return result


def new_record(name: str = "Gerät", **fields: Any) -> dict[str, Any]:
    """Create a validated record; missing record/code IDs and times are generated."""
    now = datetime.now(UTC).isoformat()
    raw: dict[str, Any] = {
        "id": uuid4().hex,
        "name": name,
        "created_at": now,
        "updated_at": now,
        **deepcopy(fields),
    }
    codes = raw.get("codes", [])
    if isinstance(codes, list):
        for code in codes:
            if isinstance(code, dict) and "id" not in code:
                code["id"] = uuid4().hex
    return validate_record(raw)
