"""Exercise persistence and registry behavior with actual Home Assistant helpers."""

import json
from copy import deepcopy
from types import MappingProxyType
from unittest.mock import patch

import pytest
from homeassistant.config_entries import ConfigEntries, ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er

from custom_components.setup_code_manager.inventory import new_record
from custom_components.setup_code_manager.manager import InventoryError, SetupCodesManager
from custom_components.setup_code_manager.store import SetupCodesStore
from custom_components.setup_code_manager.transfer import export_data, parse_import


@pytest.fixture
async def manager(tmp_path):
    hass = HomeAssistant(str(tmp_path))
    hass.config_entries = ConfigEntries(hass, {})
    await hass.config_entries.async_initialize()
    await ar.async_load(hass)
    dr.async_setup(hass)
    await dr.async_load(hass)
    await er.async_load(hass)
    store = SetupCodesStore(hass)
    manager = SetupCodesManager(hass, store)
    await manager.async_setup()
    yield manager
    manager.async_unload()
    await hass.async_stop(force=True)


def add_device(manager, suffix="one", protocols=("matter",)):
    hass = manager.hass
    entry = ConfigEntry(
        domain=protocols[0],
        title="Test",
        data={},
        options={},
        source="user",
        version=1,
        minor_version=1,
        unique_id=suffix,
        discovery_keys=MappingProxyType({}),
        subentries_data=None,
    )
    hass.config_entries._entries[entry.entry_id] = entry
    return dr.async_get(hass).async_get_or_create(
        config_entry_id=entry.entry_id,
        identifiers={(p, f"deviceid_{suffix}") for p in protocols},
        name="Test device",
        manufacturer="Example",
        model="Fixture",
    )


def revision(manager):
    return manager.store.data["revision"]


async def test_removed_ha_device_preserves_codes_and_user_metadata(manager):
    device = add_device(manager)
    area = ar.async_get(manager.hass).async_create("Wohnzimmer")
    dr.async_get(manager.hass).async_update_device(
        device.id, name_by_user="Mein Gerät", area_id=area.id
    )
    await manager.async_sync()
    record = manager.store.devices[0]
    record.update(notes="Bleibt erhalten")
    record["codes"] = [{"id": "code", "protocol": "matter", "value": "34970112332", "label": ""}]
    await manager.async_save(record, revision(manager))
    dr.async_get(manager.hass).async_remove_device(device.id)
    await manager.async_sync()
    saved = manager.list_data()["devices"][0]
    assert not saved["linked"]
    assert saved["name"] == "Mein Gerät"
    assert saved["location"] == "Wohnzimmer"
    assert saved["notes"] == "Bleibt erhalten"
    assert saved["codes"][0]["value"] == "34970112332"
    assert not saved["archived"]


async def test_protocols_share_one_device_and_offline_is_linked(manager):
    device = add_device(manager, protocols=("matter", "homekit_controller"))
    await manager.async_sync()
    assert len(manager.store.devices) == 1
    result = manager.list_data()["devices"][0]
    assert result["linked"] and not result["available"]
    assert set(result["protocols"]) == {"matter", "homekit"}
    assert manager.ha_devices()["devices"][0]["record_ids"] == [result["id"]]
    assert manager.ha_devices()["devices"][0]["id"] == device.id


async def test_stale_save_rejected_without_losing_newer_edit(manager):
    record = new_record("Manual")
    await manager.async_save(record, revision(manager))
    stale = revision(manager)
    await manager.async_archive(record["id"], True, stale)
    with pytest.raises(InventoryError, match="conflict"):
        await manager.async_save(record, stale)
    assert manager.store.get(record["id"])["archived"]
    await manager.async_sync()
    assert manager.store.get(record["id"])["archived"]


async def test_removed_selection_and_duplicate_link_rejected(manager):
    device = add_device(manager)
    await manager.async_sync()
    with pytest.raises(InventoryError, match="duplicate_link"):
        await manager.async_save(
            new_record("Duplicate", links=[{"ha_device_id": device.id}]), revision(manager)
        )
    with pytest.raises(InventoryError, match="device_removed"):
        await manager.async_save(
            new_record("Missing", links=[{"ha_device_id": "gone"}]), revision(manager)
        )


async def test_delete_does_not_rediscover_until_explicit_link(manager):
    device = add_device(manager)
    await manager.async_sync()
    record = manager.store.devices[0]
    await manager.async_delete(record["id"], revision(manager))
    await manager.async_sync()
    assert manager.store.devices == []
    assert manager.ha_devices()["devices"][0]["record_ids"] == []
    await manager.async_save(
        new_record("Re-added", links=[{"ha_device_id": device.id}]), revision(manager)
    )
    assert manager.store.data["ignored_ha_device_ids"] == []


async def test_failed_save_rolls_back_revision_and_memory(manager):
    before = manager.store.data
    with patch.object(manager.store, "_write", side_effect=OSError("disk unavailable")):
        with pytest.raises(InventoryError, match="save_failed"):
            await manager.async_save(new_record("Never committed"), revision(manager))
    assert manager.store.data == before
    reloaded = SetupCodesStore(manager.hass)
    await reloaded.async_load()
    assert reloaded.data == before


async def test_import_conflicts_preview_and_apply_atomically(manager):
    record = new_record("Existing")
    await manager.async_save(record, revision(manager))
    incoming = manager.store.data
    incoming["devices"][0]["name"] = "Replacement"
    incoming["devices"].append(new_record("New"))
    preview = await manager.async_preview_import("json", export_data("json", incoming), "admin")
    assert preview["counts"] == {"conflict": 1, "new": 1}
    choices = {
        r["key"]: ("replace" if r["status"] == "conflict" else "add") for r in preview["rows"]
    }
    result = await manager.async_import(preview["token"], preview["revision"], choices, "admin")
    assert result == {"imported": 2, "skipped": 0}
    assert {r["name"] for r in manager.store.devices} == {"Replacement", "New"}
    second = await manager.async_preview_import("json", export_data("json", incoming), "admin")
    assert second["counts"] == {"unchanged": 2}


async def test_preview_invalid_record_safe_and_token_owner_enforced(manager):
    data = json.loads(export_data("json", manager.store.data))
    data["devices"] = [{"id": "invalid", "name": "Damaged", "codes": [{"value": "PRIVATE-CODE"}]}]
    preview = await manager.async_preview_import("json", json.dumps(data), "admin")
    assert preview["counts"] == {"invalid": 1}
    assert "PRIVATE-CODE" not in json.dumps(preview)
    with pytest.raises(InventoryError, match="preview_expired"):
        await manager.async_import(preview["token"], preview["revision"], {}, "different_admin")


async def test_import_fails_on_registry_removal_after_preview(manager):
    device = add_device(manager)
    # No sync yet: importing a genuinely new linked entry.
    data = manager.store.data
    data["devices"] = [new_record("Imported", links=[{"ha_device_id": device.id}])]
    preview = await manager.async_preview_import("json", export_data("json", data), "admin")
    dr.async_get(manager.hass).async_remove_device(device.id)
    with pytest.raises(InventoryError, match="device_removed"):
        await manager.async_import(
            preview["token"], preview["revision"], {preview["rows"][0]["key"]: "add"}, "admin"
        )
    assert manager.store.devices == []


async def test_legacy_reuses_empty_record_and_is_idempotent(manager):
    device = add_device(manager)
    await manager.async_sync()
    original_id = manager.store.devices[0]["id"]
    legacy = {
        "devices": [
            {
                "id": "old",
                "name": "Old record",
                "protocol": "matter",
                "ha_device_id": device.id,
                "setup_code": "34970112332",
            }
        ]
    }
    raw = json.dumps(legacy)
    manager.legacy_path.write_text(raw)
    preview = await manager.async_preview_import("legacy", "", "admin")
    row = preview["rows"][0]
    assert row["id"] == original_id and row["status"] == "conflict"
    await manager.async_import(
        preview["token"], preview["revision"], {row["key"]: "replace"}, "admin"
    )
    again = await manager.async_preview_import("legacy", "", "admin")
    assert again["counts"] == {"unchanged": 1}
    assert len(manager.store.devices) == 1
    assert manager.legacy_path.read_text() == raw


async def test_multi_protocol_legacy_keeps_records_without_ambiguous_links(manager):
    device = add_device(manager)
    await manager.async_sync()
    legacy = {
        "devices": [
            {
                "id": "old-one",
                "name": "Matter",
                "protocol": "matter",
                "ha_device_id": device.id,
                "setup_code": "34970112332",
            },
            {
                "id": "old-two",
                "name": "HomeKit",
                "protocol": "homekit",
                "ha_device_id": device.id,
                "setup_code": "03145154",
            },
        ]
    }
    manager.legacy_path.write_text(json.dumps(legacy))
    preview = await manager.async_preview_import("legacy", "", "admin")
    assert preview["counts"] == {"new": 2}
    assert all(
        r["incoming"]["links"] == [] and r["reason"] == "link_not_restored" for r in preview["rows"]
    )
    await manager.async_import(
        preview["token"], preview["revision"], {r["key"]: "add" for r in preview["rows"]}, "admin"
    )
    again = await manager.async_preview_import("legacy", "", "admin")
    assert again["counts"] == {"unchanged": 2}
    assert sum(len(r["codes"]) for r in manager.store.devices) == 2


async def test_active_selection_removed_before_save_requires_explicit_unlink(manager):
    device = add_device(manager)
    await manager.async_sync()
    draft = manager.list_data()["devices"][0]
    dr.async_get(manager.hass).async_remove_device(device.id)
    with pytest.raises(InventoryError, match="device_removed"):
        await manager.async_save(draft, revision(manager))
    # A fresh editor on the now historical link can still update metadata.
    historical = manager.list_data()["devices"][0]
    assert historical["links"][0]["active"] is False
    historical["notes"] = "Historical link kept"
    await manager.async_save(historical, revision(manager))
    assert manager.store.devices[0]["notes"] == "Historical link kept"


async def test_shutdown_prevents_followup_saves_and_sync(manager):
    await manager.async_shutdown()
    with pytest.raises(InventoryError, match="not_loaded"):
        await manager.async_save(new_record("Late save"), revision(manager))
    add_device(manager)
    await manager.async_sync()
    assert manager.store.devices == []


async def test_long_ha_name_is_bounded_without_blocking_discovery(manager):
    device = add_device(manager)
    dr.async_get(manager.hass).async_update_device(device.id, name_by_user="a" * 300)
    await manager.async_sync()
    assert manager.store.devices[0]["name"] == "a" * 256


# Public CHIP test vectors; no real device credentials.
MATTER_QR = "MT:Y.K9042C00KA0648G00"
MATTER_QR_CHANGED_PIN = "MT:Y.K9042C000O0648G00"


def matter_record():
    return new_record(
        "Synthetic Matter device",
        codes=[{"id": "matter-code", "protocol": "matter", "value": MATTER_QR, "label": ""}],
    )


@pytest.mark.parametrize(
    ("qr", "manual"),
    [
        ("MT:00000CQM00KA0648G00", "34970112332"),
        ("MT:A3L90ARR15G6N57Y900", "745492075300001000013"),
        ("MT:MZWA6G6026O2XP0II00", "619156140465523329207"),
    ],
)
async def test_matter_qr_manual_value_is_only_runtime_data(manager, qr, manual):
    raw = matter_record()
    raw["codes"][0]["value"] = qr
    original = deepcopy(raw)
    saved = await manager.async_save(raw, revision(manager))
    assert saved["codes"][0]["manual_value"] == manual
    assert saved["codes"][0]["value"] == qr
    assert manager.list_data()["devices"][0]["codes"][0] == saved["codes"][0]
    assert raw == original
    assert manager.store.devices[0]["codes"] == original["codes"]
    persisted = json.loads(manager.store.path.read_text())
    assert persisted["data"]["devices"][0]["codes"] == original["codes"]
    # Serialization must never decorate the durable record in place.
    before = manager.store.data
    manager.list_data()
    manager.list_data()
    assert manager.store.data == before


async def test_matter_manual_value_survives_archive_and_ha_device_removal(manager):
    device = add_device(manager)
    await manager.async_sync()
    record = manager.store.devices[0]
    record["codes"] = matter_record()["codes"]
    saved = await manager.async_save(record, revision(manager))
    assert saved["codes"][0]["manual_value"] == "34970112332"
    await manager.async_archive(saved["id"], True, revision(manager))
    archived = manager.list_data()["devices"][0]
    assert archived["archived"] and archived["linked"]
    assert archived["codes"][0]["manual_value"] == "34970112332"
    dr.async_get(manager.hass).async_remove_device(device.id)
    await manager.async_sync()
    disconnected = manager.list_data()["devices"][0]
    assert disconnected["archived"] and not disconnected["linked"]
    assert disconnected["links"][0]["active"] is False
    assert disconnected["codes"][0]["manual_value"] == "34970112332"
    assert manager.store.devices[0]["codes"] == record["codes"]


async def test_editing_matter_qr_recomputes_stale_or_forged_manual_value(manager):
    draft = await manager.async_save(matter_record(), revision(manager))
    draft["codes"][0]["value"] = MATTER_QR_CHANGED_PIN
    # An old client or forged payload may submit anything here: it is display-only.
    draft["codes"][0]["manual_value"] = {"untrusted": "not a pairing code"}
    original = deepcopy(draft)
    changed = await manager.async_save(draft, revision(manager))
    assert changed["codes"][0]["manual_value"] == "34970212338"
    assert changed["codes"][0]["value"] == MATTER_QR_CHANGED_PIN
    assert draft == original
    assert "manual_value" not in manager.store.devices[0]["codes"][0]
    changed["name"] = "Edited without touching code"
    resaved = await manager.async_save(changed, revision(manager))
    assert resaved["codes"][0] == changed["codes"][0]


@pytest.mark.parametrize(
    ("protocol", "value"),
    [
        ("matter", "34970112332"),
        ("homekit", "03145154"),
        ("zwave", "00001-00002-00003-00004-00005-00006-00007-65535"),
    ],
)
async def test_non_qr_codes_never_receive_a_derived_matter_manual_value(manager, protocol, value):
    raw = new_record(
        "Synthetic code", codes=[{"id": "code", "protocol": protocol, "value": value, "label": ""}]
    )
    raw["codes"][0]["manual_value"] = "ignored runtime value"
    saved = await manager.async_save(raw, revision(manager))
    assert "manual_value" not in saved["codes"][0]
    assert "manual_value" not in manager.list_data()["devices"][0]["codes"][0]
    assert "manual_value" not in manager.store.devices[0]["codes"][0]


@pytest.mark.parametrize("format", ["json", "csv"])
async def test_exports_exclude_derived_matter_manual_value(manager, format):
    saved = await manager.async_save(matter_record(), revision(manager))
    assert saved["codes"][0]["manual_value"] == "34970112332"
    content = manager.export(format)["content"]
    assert "manual_value" not in content
    assert "34970112332" not in content
    assert parse_import(format, content, manager.store.data["instance_id"]) == manager.store.devices


async def test_ignoring_manual_value_does_not_relax_code_field_validation(manager):
    saved = await manager.async_save(matter_record(), revision(manager))
    saved["codes"][0]["unknown_code_field"] = True
    before = manager.store.data
    with pytest.raises(InventoryError, match="invalid_code"):
        await manager.async_save(saved, revision(manager))
    assert manager.store.data == before


async def test_forged_manual_value_cannot_make_an_invalid_qr_valid(manager):
    raw = matter_record()
    raw["codes"][0].update(value="MT:INVALID", manual_value="34970112332")
    before = manager.store.data
    with pytest.raises(InventoryError, match="invalid_code"):
        await manager.async_save(raw, revision(manager))
    assert manager.store.data == before


async def test_linked_identity_is_live_and_save_cannot_override_ha(manager):
    device = add_device(manager)
    await manager.async_sync()
    before = manager.store.data
    area = ar.async_get(manager.hass).async_create("HA room")
    dr.async_get(manager.hass).async_update_device(
        device.id, name="Manufacturer name", name_by_user="HA chosen name", area_id=area.id
    )
    live = manager.list_data()["devices"][0]
    assert (live["name"], live["location"]) == ("HA chosen name", "HA room")
    assert live["links"][0]["location"] == "HA room"
    assert live["links"][0]["name"] == "HA chosen name"
    assert manager.store.data == before
    live.update(name="Forbidden manual name", location="Forbidden room", notes="Editable note")
    live["links"][0].update(name="Forged HA name", location="Forged HA room")
    original = deepcopy(live)
    saved = await manager.async_save(live, revision(manager))
    assert (saved["name"], saved["location"]) == ("HA chosen name", "HA room")
    assert saved["notes"] == "Editable note"
    assert live == original
    assert manager.store.devices[0]["links"] == [{"ha_device_id": device.id}]
    assert manager.store.devices[0]["name"] == "HA chosen name"
    assert manager.store.devices[0]["location"] == "HA room"


@pytest.mark.parametrize("protocol", ["matter", "fixture_other_integration"])
async def test_sync_persists_last_ha_identity_including_archived_and_other_integrations(
    manager, protocol
):
    device = add_device(manager, protocols=(protocol,))
    area = ar.async_get(manager.hass).async_create("Old room")
    dr.async_get(manager.hass).async_update_device(device.id, area_id=area.id)
    saved = await manager.async_save(
        new_record("Initial", links=[{"ha_device_id": device.id}], notes="Keep my note"),
        revision(manager),
    )
    await manager.async_archive(saved["id"], True, revision(manager))
    dr.async_get(manager.hass).async_update_device(device.id, name_by_user="Latest HA name")
    ar.async_get(manager.hass).async_update(area.id, name="Renamed room")
    await manager.async_sync()
    stored = manager.store.get(saved["id"])
    assert (stored["name"], stored["location"]) == ("Latest HA name", "Renamed room")
    assert stored["archived"] and stored["notes"] == "Keep my note"
    stable_revision = revision(manager)
    await manager.async_sync()
    assert revision(manager) == stable_revision
    dr.async_get(manager.hass).async_remove_device(device.id)
    await manager.async_sync()
    disconnected = next(r for r in manager.list_data()["devices"] if r["id"] == saved["id"])
    assert not disconnected["linked"]
    assert (disconnected["name"], disconnected["location"]) == ("Latest HA name", "Renamed room")
    disconnected.update(name="Editable historical name", location="Storage cupboard")
    await manager.async_save(disconnected, revision(manager))
    assert manager.store.get(saved["id"])["name"] == "Editable historical name"
    assert manager.store.get(saved["id"])["location"] == "Storage cupboard"


async def test_removed_area_clears_linked_location_and_name_uses_ha_fallback(manager):
    device = add_device(manager)
    area = ar.async_get(manager.hass).async_create("Former room")
    dr.async_get(manager.hass).async_update_device(device.id, area_id=area.id)
    await manager.async_sync()
    dr.async_get(manager.hass).async_update_device(
        device.id, area_id=None, name_by_user=None, name=None
    )
    live = manager.list_data()["devices"][0]
    assert live["name"] == "Gerät"
    assert live["location"] == ""
    assert live["links"][0]["location"] == ""
    await manager.async_sync()
    assert manager.store.devices[0]["name"] == "Gerät"
    assert manager.store.devices[0]["location"] == ""


async def test_multiple_links_aggregate_unique_identity_independent_of_link_order(manager):
    first = add_device(manager, "one", protocols=("fixture_other_integration",))
    second = add_device(manager, "two", protocols=("fixture_other_integration",))
    room_z = ar.async_get(manager.hass).async_create("Office")
    room_a = ar.async_get(manager.hass).async_create("Kitchen")
    registry = dr.async_get(manager.hass)
    registry.async_update_device(first.id, name_by_user="Zeta", area_id=room_z.id)
    registry.async_update_device(second.id, name_by_user="Alpha", area_id=room_a.id)
    saved = await manager.async_save(
        new_record("Manual", links=[{"ha_device_id": first.id}, {"ha_device_id": second.id}]),
        revision(manager),
    )
    assert (saved["name"], saved["location"]) == ("Alpha / Zeta", "Kitchen / Office")
    saved["links"].reverse()
    saved = await manager.async_save(saved, revision(manager))
    assert (saved["name"], saved["location"]) == ("Alpha / Zeta", "Kitchen / Office")
    registry.async_update_device(second.id, name_by_user="Zeta", area_id=room_z.id)
    live = manager.list_data()["devices"][0]
    assert (live["name"], live["location"]) == ("Zeta", "Office")
    registry.async_update_device(second.id, entry_type=dr.DeviceEntryType.SERVICE)
    registry.async_update_device(first.id, name_by_user="Only real device", area_id=None)
    live = manager.list_data()["devices"][0]
    assert (live["name"], live["location"]) == ("Only real device", "")


async def test_unlinked_manual_identity_survives_sync_archive_and_unlink(manager):
    manual = await manager.async_save(
        new_record("Manual name", location="Manual room", notes="My note"), revision(manager)
    )
    await manager.async_archive(manual["id"], True, revision(manager))
    await manager.async_sync()
    assert manager.store.get(manual["id"])["name"] == "Manual name"
    assert manager.store.get(manual["id"])["location"] == "Manual room"
    device = add_device(manager, protocols=("fixture_other_integration",))
    linked = await manager.async_save(
        new_record("Initial", links=[{"ha_device_id": device.id}]), revision(manager)
    )
    linked.update(links=[], name="Unlinked custom name", location="Custom room", notes="Keep note")
    await manager.async_save(linked, revision(manager))
    await manager.async_sync()
    assert manager.store.get(linked["id"])["name"] == "Unlinked custom name"
    assert manager.store.get(linked["id"])["location"] == "Custom room"
    assert manager.store.get(linked["id"])["notes"] == "Keep note"


@pytest.mark.parametrize("format", ["json", "csv", "legacy"])
async def test_import_linked_identity_matches_ha_and_reimport_is_unchanged(manager, format):
    device = add_device(manager, protocols=("fixture_other_integration",))
    area = ar.async_get(manager.hass).async_create("HA room")
    dr.async_get(manager.hass).async_update_device(
        device.id, name_by_user="HA name", area_id=area.id
    )
    if format == "legacy":
        content = json.dumps(
            {
                "devices": [
                    {
                        "id": "legacy-identity",
                        "name": "File name",
                        "location": "File room",
                        "notes": "Imported note",
                        "ha_device_id": device.id,
                        "protocol": "matter",
                        "setup_code": "34970112332",
                    }
                ]
            }
        )
        manager.legacy_path.write_text(content)
    else:
        data = manager.store.data
        data["devices"] = [
            new_record(
                "File name",
                location="File room",
                notes="Imported note",
                links=[{"ha_device_id": device.id}],
            )
        ]
        content = export_data(format, data)
    preview = await manager.async_preview_import(format, content, "admin")
    row = preview["rows"][0]
    assert (row["incoming"]["name"], row["incoming"]["location"]) == ("HA name", "HA room")
    await manager.async_import(preview["token"], preview["revision"], {row["key"]: "add"}, "admin")
    stored = manager.store.devices[0]
    assert (stored["name"], stored["location"]) == ("HA name", "HA room")
    assert stored["notes"] == "Imported note"
    again = await manager.async_preview_import(format, content, "admin")
    assert again["counts"] == {"unchanged": 1}


async def test_import_rechecks_live_identity_at_commit(manager):
    device = add_device(manager, protocols=("fixture_other_integration",))
    data = manager.store.data
    data["devices"] = [new_record("File", links=[{"ha_device_id": device.id}])]
    preview = await manager.async_preview_import("json", export_data("json", data), "admin")
    dr.async_get(manager.hass).async_update_device(device.id, name_by_user="Renamed after preview")
    row = preview["rows"][0]
    await manager.async_import(preview["token"], preview["revision"], {row["key"]: "add"}, "admin")
    assert manager.store.devices[0]["name"] == "Renamed after preview"


async def test_ha_identity_is_bounded_and_unknown_link_fields_remain_rejected(manager):
    device = add_device(manager, protocols=("fixture_other_integration",))
    area = ar.async_get(manager.hass).async_create("R" * 300)
    dr.async_get(manager.hass).async_update_device(
        device.id, name_by_user="N" * 300, area_id=area.id
    )
    saved = await manager.async_save(
        new_record("Initial", links=[{"ha_device_id": device.id}]), revision(manager)
    )
    assert saved["name"] == "N" * 256
    assert saved["location"] == "R" * 256
    assert saved["links"][0]["location"] == "R" * 256
    saved["links"][0]["unknown_link_field"] = "not silently stripped"
    before = manager.store.data
    with pytest.raises(InventoryError, match="validation_error"):
        await manager.async_save(saved, revision(manager))
    assert manager.store.data == before
