"""Validate inventory boundaries without a running Home Assistant instance."""

from copy import deepcopy

import pytest

from custom_components.setup_code_manager.inventory import new_record, validate_record


def test_new_record_defaults_and_code_normalization_do_not_mutate_input():
    codes = [{"protocol": "homekit", "value": "031-45-154", "label": "Original"}]
    record = new_record("Küche", codes=codes)
    assert record["codes"][0]["value"] == "03145154"
    assert record["codes"][0]["id"]
    assert "id" not in codes[0]
    assert record["notes"] == ""
    assert record["links"] == []
    assert record["source_refs"] == []
    assert record["archived"] is False
    assert record["created_at"] == record["updated_at"]


def test_multiple_protocols_and_archived_linked_record_are_supported():
    record = new_record(
        "Lampe",
        archived=True,
        links=[{"ha_device_id": "ha-device"}],
        codes=[
            {"protocol": "matter", "value": "3497-011-2332"},
            {"protocol": "homekit", "value": "031-45-154"},
            {
                "protocol": "zwave",
                "value": "00001-00002-00003-00004-00005-00006-00007-00008",
            },
        ],
    )
    assert record["codes"][0]["value"] == "34970112332"
    assert len(record["codes"]) == 3
    assert record["archived"] and record["links"]


@pytest.mark.parametrize(
    "change",
    [
        {"name": ""},
        {"notes": None},
        {"name": "x" * 257},
        {"notes": "x" * 10001},
        {"archived": 1},
        {"links": None},
        {"codes": {}},
        {"source_refs": [None]},
        {"unexpected": "value"},
        {"created_at": "not a date"},
        {"updated_at": "2026-11-07T12:30:00"},
        {"notes": "null\x00byte"},
        {"id": "=FORMULA()"},
        {"source_refs": ["same", "same"]},
        {"links": [{"ha_device_id": "same"}, {"ha_device_id": "same"}]},
    ],
)
def test_reject_invalid_fields(change):
    record = new_record("Device")
    record.update(change)
    with pytest.raises(ValueError):
        validate_record(record)


def test_duplicate_protocol_or_code_id_rejected():
    record = new_record("Device", codes=[{"protocol": "homekit", "value": "03145154"}])
    duplicate = deepcopy(record["codes"][0])
    duplicate["id"] = "different"
    record["codes"].append(duplicate)
    with pytest.raises(ValueError, match="Duplicate"):
        validate_record(record)
    record["codes"][1].update(protocol="matter", value="34970112332", id=record["codes"][0]["id"])
    with pytest.raises(ValueError, match="Duplicate"):
        validate_record(record)


@pytest.mark.parametrize("value", ["", "00000000", "private-invalid-code", "٠٣١٤٥١٥٤"])
def test_invalid_codes_rejected_without_exposing_value(value):
    with pytest.raises(ValueError) as error:
        new_record("Device", codes=[{"protocol": "homekit", "value": value}])
    if value:
        assert value not in str(error.value)


def test_validate_returns_independent_copy():
    original = new_record("Device", codes=[{"protocol": "homekit", "value": "03145154"}])
    result = validate_record(original)
    result["codes"][0]["label"] = "Changed"
    assert original["codes"][0]["label"] == ""


def test_matter_qr_is_preserved_as_a_qr_payload():
    value = "MT:Y.K9042C00KA0648G00"
    record = new_record("Synthetic QR fixture", codes=[{"protocol": "matter", "value": value}])
    assert record["codes"][0]["value"] == value
