"""Import/export behavior, preservation and safe failure cases."""

import csv
import io
import json
from copy import deepcopy

import pytest

from custom_components.setup_code_manager.inventory import new_record
from custom_components.setup_code_manager.transfer import (
    CSV_FIELDS,
    export_data,
    parse_import,
    preview_import,
)


@pytest.fixture
def inventory_data():
    return {
        "instance_id": "home-a",
        "revision": 7,
        "devices": [
            new_record(
                '=HYPERLINK("untrusted")',
                notes="\t@formula\nGrüße, Küche\r\n'leading quote",
                manufacturer="+Vendor",
                model="-Model",
                serial_number="000123",
                location="'Office",
                archived=True,
                links=[{"ha_device_id": "ha-1"}],
                source_refs=["setup_codes:old-1"],
                codes=[
                    {"protocol": "homekit", "value": "03145154", "label": "=label"},
                    {
                        "protocol": "matter",
                        "value": "34970112332",
                        "label": "'Original",
                    },
                ],
            ),
            new_record("Noch ohne Code", notes="\nTwo lines\n"),
        ],
    }


@pytest.mark.parametrize("format", ["json", "csv"])
def test_complete_same_instance_roundtrip_is_unchanged(format, inventory_data):
    before = deepcopy(inventory_data)
    text = export_data(format, inventory_data)
    imported = parse_import(format, text, "home-a")
    assert imported == inventory_data["devices"]
    assert inventory_data == before
    assert [row["status"] for row in preview_import(imported, imported)] == [
        "unchanged",
        "unchanged",
    ]


@pytest.mark.parametrize("format", ["json", "csv"])
def test_rebuild_clears_foreign_links_but_preserves_every_record(format, inventory_data):
    imported = parse_import(format, export_data(format, inventory_data), "new-home")
    assert all(record["links"] == [] for record in imported)
    assert imported[0]["codes"] == inventory_data["devices"][0]["codes"]
    assert imported[0]["archived"] is True
    assert imported[0]["id"] == inventory_data["devices"][0]["id"]


def test_csv_all_data_cells_are_formula_safe_and_text_is_reversible(inventory_data):
    text = export_data("csv", inventory_data)
    rows = list(csv.reader(io.StringIO(text, newline="")))
    assert tuple(rows[0]) == CSV_FIELDS
    assert all(cell.startswith("'") for row in rows[1:] for cell in row)
    assert "'03145154" in text
    assert len(rows) == 5  # header, metadata, two codes, one code-free record
    assert parse_import("csv", text, "home-a")[0]["serial_number"] == "000123"


@pytest.mark.parametrize("format", ["json", "csv"])
def test_empty_inventory_roundtrip(format):
    data = {"instance_id": "home", "revision": 0, "devices": []}
    assert parse_import(format, export_data(format, data), "home") == []


def test_preview_does_not_match_names_codes_or_links(inventory_data):
    first = inventory_data["devices"][0]
    second = deepcopy(first)
    second["id"] = "another-id"
    rows = preview_import([first], [second])
    assert rows[0]["status"] == "new"
    assert rows[0]["existing"] is None
    second["id"] = first["id"]
    second["notes"] = "Changed intentionally"
    row = preview_import([first], [second])[0]
    assert row["status"] == "conflict"
    assert row["existing"] == first
    assert row["incoming"] == second


def test_duplicate_ids_are_all_invalid_not_partially_imported(inventory_data):
    data = json.loads(export_data("json", inventory_data))
    data["devices"].append(deepcopy(data["devices"][0]))
    records = parse_import("json", json.dumps(data), "home-a")
    rows = preview_import([], records)
    assert [row["status"] for row in rows] == ["invalid", "new", "invalid"]
    assert rows[0]["incoming"] is None
    assert rows[0]["key"] != rows[2]["key"]


def test_invalid_record_is_visible_without_raw_data_in_preview(inventory_data):
    data = json.loads(export_data("json", inventory_data))
    data["devices"][0]["codes"][0]["value"] = "PRIVATE-INVALID-CODE"
    records = parse_import("json", json.dumps(data), "home-a")
    assert records[0]["__raw__"]["codes"][0]["value"] == "PRIVATE-INVALID-CODE"
    rows = preview_import([], records)
    assert rows[0]["status"] == "invalid"
    assert "PRIVATE-INVALID-CODE" not in json.dumps(rows)
    assert rows[0]["incoming"] is None
    assert rows[1]["status"] == "new"


def test_user_cannot_forge_internal_invalid_marker(inventory_data):
    data = json.loads(export_data("json", inventory_data))
    data["devices"][0]["__error__"] = "UNTRUSTED-ERROR-CONTENT"
    records = parse_import("json", json.dumps(data), "home-a")
    rows = preview_import([], records)
    assert rows[0]["status"] == "invalid"
    assert "UNTRUSTED-ERROR-CONTENT" not in json.dumps(rows)


@pytest.mark.parametrize("content", ["{", "[]", '{"format":1,"format":2}', '{"x":NaN}'])
def test_malformed_json_rejected_as_document(content):
    with pytest.raises(ValueError):
        parse_import("json", content, "home")


@pytest.mark.parametrize("version", [True, "1", 2])
def test_unsupported_schema_never_imported(version, inventory_data):
    data = json.loads(export_data("json", inventory_data))
    data["schema_version"] = version
    with pytest.raises(ValueError, match="schema"):
        parse_import("json", json.dumps(data), "home")


def test_csv_rejects_unescaped_cell_and_conflicting_metadata(inventory_data):
    rows = list(csv.reader(io.StringIO(export_data("csv", inventory_data), newline="")))
    rows[2][CSV_FIELDS.index("name")] = "=UNESCAPED()"
    output = io.StringIO(newline="")
    csv.writer(output).writerows(rows)
    with pytest.raises(ValueError, match="escaping"):
        parse_import("csv", output.getvalue(), "home-a")
    rows[2][CSV_FIELDS.index("name")] = "'different name"
    output = io.StringIO(newline="")
    csv.writer(output).writerows(rows)
    parsed = parse_import("csv", output.getvalue(), "home-a")
    assert preview_import([], parsed)[0]["status"] == "invalid"


def test_legacy_migration_is_deterministic_and_preserves_original():
    old = {
        "devices": [
            {
                "id": "old-1",
                "protocol": "homekit",
                "setup_code": "031-45-154",
                "name": "Küchenlampe",
                "manufacturer": None,
                "model": "Modell",
                "serial_number": "000123",
                "notes": "Original\nNotiz",
                "area_name": "Küche",
                "ha_device_id": "ha-1",
                "native_id": "native-1",
                "area_id": "area-1",
                "created_at": "2026-10-24T10:00:00+00:00",
                "updated_at": None,
            }
        ]
    }
    before = deepcopy(old)
    content = json.dumps({"version": 1, "minor_version": 1, "key": "setup_codes", "data": old})
    first = parse_import("legacy", content, "home-a")
    again = parse_import("legacy", content, "home-a")
    assert old == before
    assert first == again
    assert first[0]["source_refs"] == [
        "setup_codes:old-1",
        "setup_codes:old-1:native_id=native-1",
        "setup_codes:old-1:area_id=area-1",
    ]
    assert first[0]["codes"][0]["value"] == "03145154"
    assert first[0]["location"] == "Küche"
    assert first[0]["links"] == [{"ha_device_id": "ha-1"}]
    assert preview_import(first, again)[0]["status"] == "unchanged"


def test_removed_legacy_record_is_unlinked_not_archived_and_invalid_code_is_visible():
    data = {
        "devices": [
            {
                "id": "old",
                "name": "Removed",
                "ha_device_id": "ha-1",
                "status": "removed",
                "setup_code": None,
            },
            {
                "id": "bad",
                "name": "Invalid",
                "protocol": "matter",
                "setup_code": "SECRET-BAD-CODE",
            },
        ]
    }
    parsed = parse_import("legacy", json.dumps(data), "home")
    assert parsed[0]["links"] == []
    assert parsed[0]["archived"] is False
    assert parsed[0]["codes"] == []
    rows = preview_import([], parsed)
    assert rows[1]["status"] == "invalid"
    assert "SECRET-BAD-CODE" not in json.dumps(rows)


def test_duplicate_legacy_ids_do_not_create_two_records():
    old = {"id": "old", "name": "Duplicate", "setup_code": None}
    parsed = parse_import("legacy", json.dumps({"devices": [old, old]}), "home")
    assert all(row["status"] == "invalid" for row in preview_import([], parsed))


def test_invalid_storage_envelope_and_file_size_rejected(monkeypatch):
    from custom_components.setup_code_manager import transfer

    with pytest.raises(ValueError, match="legacy"):
        parse_import(
            "legacy",
            json.dumps({"version": 1, "key": "other", "data": {"devices": []}}),
            "home",
        )
    monkeypatch.setattr(transfer, "MAX_CONTENT_BYTES", 10)
    with pytest.raises(ValueError, match="limit"):
        parse_import("json", " " * 11, "home")
