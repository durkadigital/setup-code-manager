"""Z-Wave DSK / SmartStart QR checks."""

from __future__ import annotations

import hashlib

from .matter_code import SetupCodeError

_DSK_GROUPS = 8
_DSK_GROUP_LEN = 5
_DSK_DIGITS = _DSK_GROUPS * _DSK_GROUP_LEN
_DSK_GROUP_MAX = 0xFFFF
_QR_PREFIX = "90"
_QR_MIN_LEN = 52


def canonicalize_dsk(raw: str) -> str | None:
    """Return canonical ``aaaaa-bbbbb-…`` DSK, or None if this is not a DSK."""
    digits = "".join(char for char in raw if char in "0123456789")
    leftover = "".join(
        char
        for char in raw.strip()
        if char not in "0123456789" and not char.isspace() and char not in "-."
    )
    if leftover or len(digits) != _DSK_DIGITS:
        return None
    groups = [
        digits[index : index + _DSK_GROUP_LEN] for index in range(0, _DSK_DIGITS, _DSK_GROUP_LEN)
    ]
    if any(int(group) > _DSK_GROUP_MAX for group in groups):
        return None
    return "-".join(groups)


def _store_qr_payload(raw: str) -> str:
    digits = "".join(char for char in raw if char in "0123456789")
    leftover = "".join(
        char for char in raw.strip() if char not in "0123456789" and not char.isspace()
    )
    if leftover:
        raise SetupCodeError(
            "Z-Wave SmartStart QR codes are digits starting with 90 (spaces are OK)."
        )
    if not digits.startswith(_QR_PREFIX) or len(digits) < _QR_MIN_LEN:
        raise SetupCodeError("Z-Wave SmartStart QR codes start with 90 and are at least 52 digits.")
    if len(digits) > 4096:
        raise SetupCodeError("This Z-Wave QR payload is too long.")

    # Z-Wave S2 / SmartStart: version, SHA-1 prefix checksum, requested keys,
    # eight 16-bit DSK groups, then length-delimited provisioning fields.
    # Reference: zwave-js/zwave-js packages/core/src/qr/{parse,utils}.ts.
    def invalid() -> None:
        raise SetupCodeError("This is not a valid Z-Wave S2 / SmartStart QR payload.")

    if int(digits[2:4]) not in (0, 1):
        invalid()
    checksum = int.from_bytes(
        hashlib.sha1(digits[9:].encode("ascii"), usedforsecurity=False).digest()[:2], "big"
    )
    if int(digits[4:9]) != checksum:
        invalid()
    if int(digits[9:12]) & ~0x87:
        invalid()
    if canonicalize_dsk(digits[12:52]) is None:
        invalid()
    offset = 52
    required = set()
    while offset < len(digits):
        if offset + 4 > len(digits):
            invalid()
        tag = int(digits[offset : offset + 2])
        size = int(digits[offset + 2 : offset + 4])
        offset += 4
        if offset + size > len(digits):
            invalid()
        value = digits[offset : offset + size]
        offset += size
        kind, critical = tag >> 1, tag & 1
        if kind in (0, 1):
            expected_size = 10 if kind == 0 else 20
            if size != expected_size or any(
                int(value[index : index + 5]) > 65535 for index in range(0, size, 5)
            ):
                invalid()
            required.add(kind)
        elif kind == 2:
            if size != 2:
                invalid()
        elif kind == 3:
            if size != 42 or value[:2] != "00" or canonicalize_dsk(value[2:]) is None:
                invalid()
        elif kind == 4:
            if size not in (2, 3, 5) or int(value) > (65535 if size == 5 else 255):
                invalid()
        elif critical:
            invalid()
    if required != {0, 1}:
        invalid()
    return digits


def validate_zwave_setup_code(raw: str) -> str:
    """Normalize a Z-Wave DSK or SmartStart QR payload for storage."""
    stripped = raw.strip()
    digits = "".join(char for char in stripped if char in "0123456789")
    if digits.startswith(_QR_PREFIX) and len(digits) >= _QR_MIN_LEN:
        return _store_qr_payload(stripped)
    dsk = canonicalize_dsk(stripped)
    if dsk is None:
        raise SetupCodeError("Z-Wave setup codes are a 40-digit DSK (8 groups of 5) or a 90… QR.")
    return dsk
