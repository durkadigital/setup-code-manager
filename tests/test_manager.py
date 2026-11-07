"""Exercise persistence and registry behavior with actual Home Assistant helpers."""

import json
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
from custom_components.setup_code_manager.transfer import export_data


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
    await manager.async_sync()
    record = manager.store.devices[0]
    record.update(name="Mein Gerät", location="Wohnzimmer", notes="Bleibt erhalten")
    record["codes"] = [{"id": "code", "protocol": "matter", "value": "34970112332", "label": ""}]
    await manager.async_save(record, revision(manager))
    dr.async_get(manager.hass).async_remove_device(device.id)
    await manager.async_sync()
    saved = manager.list_data()["devices"][0]
    assert not saved["linked"]
    assert saved["name"] == "Mein Gerät"
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
