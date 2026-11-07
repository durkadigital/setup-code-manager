"""Setup-code integrity: actual onboarding fields, malformed data and zeroes.

All credentials below are synthetic test vectors, never real device secrets.
Protocol references used for these regression cases:
https://github.com/project-chip/connectedhomeip/tree/master/src/setup_payload
https://github.com/apple/HomeKitADK/blob/master/HAP/HAPAccessorySetup.c
https://github.com/zwave-js/zwave-js/tree/master/packages/core/src/qr
"""

import hashlib

import pytest

from custom_components.setup_code_manager.homekit_code import (
    parse_xhm_payload,
    setup_code_from_xhm,
)
from custom_components.setup_code_manager.matter_code import (
    SetupCodeError,
    encode_manual_pairing_code,
    manual_pairing_code_from_mt,
    normalize_setup_code,
    parse_mt_payload,
    verhoeff_check_digit,
)
from custom_components.setup_code_manager.zwave_code import canonicalize_dsk

MATTER = "MT:Y.K9042C00KA0648G00"
HOMEKIT = "X-HM://0023ISYWY7STT"
DSK = "00001-00002-00003-00004-00005-00006-00007-65535"


def matter_qr(
    *,
    version=0,
    vendor=0xFFF1,
    product=0x8000,
    flow=0,
    discovery=2,
    discriminator=3840,
    pin=20202021,
    padding=0,
    tlv=b"",
):
    """Pack independently specified protocol fields into a synthetic label."""
    fields = [
        (version, 3),
        (vendor, 16),
        (product, 16),
        (flow, 2),
        (discovery, 8),
        (discriminator, 12),
        (pin, 27),
        (padding, 4),
    ]
    value = 0
    shift = 0
    for field, size in fields:
        value |= field << shift
        shift += size
    data = value.to_bytes(11, "little") + tlv
    alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-."
    result = ""
    for index in range(0, len(data), 3):
        chunk = data[index : index + 3]
        value = int.from_bytes(chunk, "little")
        for _ in range({1: 2, 2: 4, 3: 5}[len(chunk)]):
            result += alphabet[value % 38]
            value //= 38
    return "MT:" + result


def homekit_qr(
    *, code=3145154, category=2, flags=2, version=0, reserved=0, high_bits=0, setup_id="7STT"
):
    value = code | (flags << 27) | (category << 31) | (reserved << 39) | (version << 43) | high_bits
    encoded = ""
    for _ in range(9):
        value, digit = divmod(value, 36)
        encoded = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"[digit] + encoded
    return "X-HM://" + encoded + setup_id


def zwave_qr(
    *, version=1, keys=7, dsk=DSK.replace("-", ""), tlv="00100000100001022000001000020000300256"
):
    body = f"{keys:03d}{dsk}{tlv}"
    checksum = int.from_bytes(
        hashlib.sha1(body.encode("ascii"), usedforsecurity=False).digest()[:2], "big"
    )
    return f"90{version:02d}{checksum:05d}{body}"


def test_known_matter_vector_keeps_original_qr_and_yields_manual_code():
    assert matter_qr() == MATTER
    assert normalize_setup_code("matter", MATTER) == MATTER
    assert manual_pairing_code_from_mt(MATTER) == "34970112332"
    assert parse_mt_payload(MATTER) == {
        "vendor_id": 65521,
        "product_id": 32768,
        "flow": 0,
        "discriminator": 3840,
        "passcode": 20202021,
    }
    assert normalize_setup_code("matter", " 3497-011-2332 ") == "34970112332"


@pytest.mark.parametrize(
    "fields",
    [
        {"version": 1},
        {"version": 7},
        {"padding": 1},
        {"flow": 3},
        {"vendor": 65535},
        {"product": 0},
        {"pin": 0},
        {"pin": 12345678},
        {"pin": 11111111},
        {"pin": 99999999},
        {"pin": 134217727},
    ],
)
def test_matter_rejects_invalid_fixed_fields(fields):
    code = matter_qr(**fields)
    assert parse_mt_payload(code) is None
    with pytest.raises(SetupCodeError):
        normalize_setup_code("matter", code)


@pytest.mark.parametrize(
    "fields", [{"flow": 1}, {"flow": 2}, {"vendor": 0, "product": 0}, {"pin": 1}, {"pin": 99999998}]
)
def test_matter_accepts_supported_flow_and_pin_boundaries(fields):
    code = matter_qr(**fields)
    assert normalize_setup_code("matter", code) == code


@pytest.mark.parametrize(
    "raw",
    [
        "MT:",
        "MT:00",
        "MT:ZZZZZ",
        MATTER[:-1],
        MATTER + "*BAD",
        MATTER + "%BAD",
        "https://example.com/" + MATTER,
    ],
)
def test_matter_rejects_incomplete_or_unsupported_compound_labels(raw):
    with pytest.raises(SetupCodeError):
        normalize_setup_code("matter", raw)


@pytest.mark.parametrize("tlv", [b"\x15\x18", b"\x15\x2c\x00\x04TEST\x18", b"\x15\x24\x80\x01\x18"])
def test_matter_preserves_optional_tlv_in_original_qr(tlv):
    code = matter_qr(tlv=tlv)
    assert normalize_setup_code("matter", code) == code
    assert manual_pairing_code_from_mt(code) == "34970112332"


@pytest.mark.parametrize(
    "tlv",
    [
        b"\x00",
        b"\x15",
        b"\x15\x2c\x00\x05TEST\x18",
        b"\x15\x24\x80\x18",
        b"\x15\x18\x00",
        b"\x15\x2c\x00\x01\xff\x18",
    ],
)
def test_matter_rejects_invalid_optional_tlv(tlv):
    with pytest.raises(SetupCodeError):
        normalize_setup_code("matter", matter_qr(tlv=tlv))


def test_matter_manual_checksum_and_long_code_identity_are_checked():
    long_code = encode_manual_pairing_code(3840, 20202021, vendor_id=65521, product_id=32768)
    assert normalize_setup_code("matter", long_code) == long_code
    with pytest.raises(SetupCodeError):
        normalize_setup_code("matter", "34970112333")
    invalid_vendor = long_code[:10] + "65535" + long_code[15:20]
    invalid_vendor += verhoeff_check_digit(invalid_vendor)
    with pytest.raises(SetupCodeError):
        normalize_setup_code("matter", invalid_vendor)


@pytest.mark.parametrize("flow", [1, 2])
def test_nonstandard_matter_flow_keeps_vendor_product_in_derived_manual_code(flow):
    derived = manual_pairing_code_from_mt(matter_qr(flow=flow))
    assert len(derived) == 21
    assert derived[10:20] == "6552132768"
    assert normalize_setup_code("matter", derived) == derived


def test_homekit_preserves_leading_zero_in_manual_and_qr_codes():
    assert homekit_qr() == HOMEKIT
    assert normalize_setup_code("homekit", "031-45-154") == "03145154"
    assert normalize_setup_code("homekit", HOMEKIT) == HOMEKIT
    assert setup_code_from_xhm(HOMEKIT) == "03145154"
    assert parse_xhm_payload(HOMEKIT)["setup_id"] == "7STT"


@pytest.mark.parametrize(
    "fields",
    [
        {"version": 1},
        {"reserved": 1},
        {"flags": 8},
        {"flags": 0},
        {"category": 0},
        {"high_bits": 1 << 46},
        {"code": 0},
        {"code": 12345678},
        {"code": 100000000},
        {"setup_id": "7sTT"},
        {"setup_id": "7ÄTT"},
    ],
)
def test_homekit_rejects_invalid_payload_fields(fields):
    with pytest.raises(SetupCodeError):
        normalize_setup_code("homekit", homekit_qr(**fields))


@pytest.mark.parametrize("prefix", ["X-HM:", "X-HM:/", "X-HM:///", "X-HM:// "])
def test_homekit_does_not_repair_malformed_uri_scheme(prefix):
    with pytest.raises(SetupCodeError):
        normalize_setup_code("homekit", prefix + HOMEKIT[7:])


@pytest.mark.parametrize(
    "protocol,raw",
    [
        ("matter", "３4970112332"),
        ("matter", "²4970112332"),
        ("homekit", "０3145154"),
        ("homekit", "²3145154"),
        ("zwave", "²" + DSK[1:]),
        ("zwave", "０" + DSK[1:]),
    ],
)
def test_unicode_lookalikes_fail_with_safe_domain_error(protocol, raw):
    with pytest.raises(SetupCodeError) as error:
        normalize_setup_code(protocol, raw)
    assert raw not in str(error.value)


def test_zwave_dsk_preserves_all_zeroes_and_group_boundaries():
    assert normalize_setup_code("zwave", DSK) == DSK
    assert canonicalize_dsk(DSK.replace("-", " ")) == DSK
    assert canonicalize_dsk("65536" + DSK[5:]) is None
    with pytest.raises(SetupCodeError):
        normalize_setup_code("zwave", DSK[:-1])


@pytest.mark.parametrize("version", [0, 1])
def test_zwave_complete_s2_and_smartstart_qr_roundtrip(version):
    code = zwave_qr(version=version)
    assert normalize_setup_code("zwave", code) == code
    assert normalize_setup_code("zwave", "\n".join([code[:30], code[30:]])) == code


def test_zwave_qr_checksum_detects_a_single_changed_digit():
    code = zwave_qr()
    changed = code[:20] + str((int(code[20]) + 1) % 10) + code[21:]
    with pytest.raises(SetupCodeError):
        normalize_setup_code("zwave", changed)


@pytest.mark.parametrize(
    "fields",
    [
        {"version": 2},
        {"keys": 999},
        {"keys": 8},
        {"dsk": "65536" + DSK.replace("-", "")[5:]},
        {"tlv": ""},
        {"tlv": "00100000100001"},
        {"tlv": "001000001000010220000010000200003002561"},
        {"tlv": "001000001000010220000010000200003002569900"},
        {"tlv": "0009000010000022000001000020000300256"},
    ],
)
def test_zwave_rejects_invalid_structure_even_with_valid_checksum(fields):
    with pytest.raises(SetupCodeError):
        normalize_setup_code("zwave", zwave_qr(**fields))


def test_zwave_unknown_noncritical_tlv_is_preserved():
    code = zwave_qr(tlv="001000001000010220000010000200003002569803123")
    assert normalize_setup_code("zwave", code) == code
