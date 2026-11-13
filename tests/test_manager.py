"""Exercise persistence and registry behavior with actual Home Assistant helpers."""

import asyncio
import base64
import io
import json
from copy import deepcopy
from threading import Event
from types import MappingProxyType
from unittest.mock import patch

import pytest
from homeassistant.config_entries import ConfigEntries, ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import floor_registry as fr
from homeassistant.helpers import label_registry as lr
from pypdf import PdfReader

from custom_components.setup_code_manager.device_pdf import MAX_PDF_BYTES, DevicePDFError
from custom_components.setup_code_manager.inventory import new_record
from custom_components.setup_code_manager.manager import InventoryError, SetupCodesManager
from custom_components.setup_code_manager.preferences import validate_preferences
from custom_components.setup_code_manager.store import SetupCodesStore
from custom_components.setup_code_manager.transfer import export_data, parse_import


def saved_preferences(name="Zuhause", room="room:Kinderzimmer"):
    return {
        "views": [{"id": "home", "name": name, "settings": {"room": room}}],
        "defaultViewId": "home",
    }


@pytest.fixture
async def manager(tmp_path):
    hass = HomeAssistant(str(tmp_path))
    hass.config_entries = ConfigEntries(hass, {})
    await hass.config_entries.async_initialize()
    await fr.async_load(hass)
    await lr.async_load(hass)
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


async def test_pdf_snapshot_uses_live_ha_identity_matter_manual_value_and_does_not_mutate_inventory(
    manager, monkeypatch
):
    device = add_device(manager)
    area = ar.async_get(manager.hass).async_create("Aktuelle Küche")
    dr.async_get(manager.hass).async_update_device(
        device.id, name_by_user="Aktueller Name", area_id=area.id
    )
    saved = await manager.async_save(
        new_record(
            "Stored name",
            links=[{"ha_device_id": device.id}],
            notes="Synthetic private note",
            codes=[{"protocol": "matter", "value": "MT:Y.K9042C00KA0648G00"}],
        ),
        revision(manager),
    )
    before = manager.store.data
    exports = {format: manager.export(format)["content"] for format in ("json", "csv")}
    notifications = []
    monkeypatch.setattr(manager, "_notify", lambda: notifications.append(True))
    result = await manager.async_export_pdf([saved["id"]])
    document = base64.b64decode(result["content"], validate=True)
    assert result["mime"] == "application/pdf" and result["encoding"] == "base64"
    assert result["byte_length"] == len(document) and result["count"] == 1
    assert result["filename"].startswith("setup-code-manager-device-cards-") and result[
        "filename"
    ].endswith(".pdf")
    text = "\n".join(page.extract_text() for page in PdfReader(io.BytesIO(document)).pages)
    assert "Aktueller Name" in text and "Aktuelle Küche" in text
    assert "3497-011-2332" in text and "MT:Y.K9042C00KA0648G00" in text
    assert "Synthetic private note" not in text
    assert manager.store.data == before and notifications == []
    assert all(manager.export(format)["content"] == content for format, content in exports.items())


async def test_pdf_selection_can_include_archive_and_preserves_requested_order(manager):
    first = await manager.async_save(new_record("First"), revision(manager))
    second = await manager.async_save(new_record("Second"), revision(manager))
    await manager.async_archive(second["id"], True, revision(manager))
    result = await manager.async_export_pdf([second["id"], first["id"]], language="en")
    reader = PdfReader(io.BytesIO(base64.b64decode(result["content"])))
    assert result["count"] == 2 and len(reader.pages) == 2
    assert "Second" in reader.pages[0].extract_text() and "First" in reader.pages[1].extract_text()


@pytest.mark.parametrize(
    "selection", [None, [], "a", [False], [1], ["bad\nid"], ["a", "a"], ["a"] * 101]
)
async def test_invalid_pdf_selection_is_rejected_before_executor(manager, selection, monkeypatch):
    def must_not_render(*_args):
        pytest.fail("Invalid selection reached renderer")

    monkeypatch.setattr(
        "custom_components.setup_code_manager.manager.build_device_pdf", must_not_render
    )
    with pytest.raises(ValueError):
        await manager.async_export_pdf(selection)


async def test_missing_pdf_id_rejects_whole_selection_without_silent_partial_export(
    manager, monkeypatch
):
    saved = await manager.async_save(new_record("Existing"), revision(manager))

    def must_not_render(*_args):
        pytest.fail("Partial selection reached renderer")

    monkeypatch.setattr(
        "custom_components.setup_code_manager.manager.build_device_pdf", must_not_render
    )
    with pytest.raises(InventoryError, match="not_found"):
        await manager.async_export_pdf([saved["id"], "missing"])


async def test_pdf_executor_does_not_hold_inventory_lock_and_keeps_its_original_snapshot(
    manager, monkeypatch
):
    saved = await manager.async_save(new_record("Snapshot name"), revision(manager))
    entered, release = Event(), Event()
    snapshots = []

    def blocked(records, _language, _notes):
        assert not manager._lock.locked()
        snapshots.append(deepcopy(records))
        entered.set()
        if not release.wait(timeout=5):
            raise RuntimeError("Synthetic render not released")
        return b"%PDF-1.4\nSYNTHETIC"

    monkeypatch.setattr("custom_components.setup_code_manager.manager.build_device_pdf", blocked)
    task = asyncio.create_task(manager.async_export_pdf([saved["id"]]))
    try:
        assert await asyncio.to_thread(entered.wait, 3)
        saved["name"] = "Changed during rendering"
        await manager.async_save(saved, revision(manager))
        assert manager.store.get(saved["id"])["name"] == "Changed during rendering"
    finally:
        release.set()
    await task
    assert snapshots[0][0]["name"] == "Snapshot name"


async def test_cancelled_pdf_thread_is_drained_before_shutdown_and_new_requests_are_blocked(
    manager, monkeypatch
):
    saved = await manager.async_save(new_record("Cancellation"), revision(manager))
    before = manager.store.data
    entered, release = Event(), Event()

    def blocked(*_args):
        entered.set()
        if not release.wait(timeout=5):
            raise RuntimeError("Synthetic render not released")
        return b"%PDF-1.4\nSYNTHETIC"

    monkeypatch.setattr("custom_components.setup_code_manager.manager.build_device_pdf", blocked)
    task = asyncio.create_task(manager.async_export_pdf([saved["id"]]))
    shutdown = None
    try:
        assert await asyncio.to_thread(entered.wait, 3)
        for _ in range(2):
            task.cancel()
            await asyncio.sleep(0)
        shutdown = asyncio.create_task(manager.async_shutdown())
        await asyncio.sleep(0)
        assert not task.done() and not shutdown.done()
        assert manager._pdf_lock.locked()
    finally:
        release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    await shutdown
    assert manager.store.data == before and not manager._pdf_lock.locked()
    with pytest.raises(InventoryError, match="not_loaded"):
        await manager.async_export_pdf([saved["id"]])


@pytest.mark.parametrize(
    "error,expected",
    [
        (DevicePDFError("pdf_too_large"), "pdf_too_large"),
        (RuntimeError("SYNTHETIC_SECRET"), "pdf_failed"),
    ],
)
async def test_pdf_renderer_errors_are_sanitized(manager, monkeypatch, error, expected):
    saved = await manager.async_save(new_record("Failure"), revision(manager))

    def failed(*_args):
        raise error

    monkeypatch.setattr("custom_components.setup_code_manager.manager.build_device_pdf", failed)
    with pytest.raises(InventoryError, match=expected) as raised:
        await manager.async_export_pdf([saved["id"]])
    assert "SYNTHETIC_SECRET" not in str(raised.value)


async def test_pdf_manager_enforces_response_byte_limit(manager, monkeypatch):
    saved = await manager.async_save(new_record("Bounded response"), revision(manager))
    monkeypatch.setattr(
        "custom_components.setup_code_manager.manager.build_device_pdf",
        lambda *_args: b"%PDF-" + b"x" * MAX_PDF_BYTES,
    )
    with pytest.raises(InventoryError, match="pdf_too_large"):
        await manager.async_export_pdf([saved["id"]])


async def test_saved_preferences_follow_account_across_manager_reload_without_inventory_change(
    manager,
):
    before = manager.store.data
    initial = await manager.async_get_view_preferences("user-a")
    assert initial == {"revision": 0, "views": [], "defaultViewId": ""}
    result = await manager.async_save_view_preferences("user-a", saved_preferences(), 0)
    assert result == {"revision": 1, **validate_preferences(saved_preferences())}
    assert await manager.async_get_view_preferences("user-b") == initial
    assert manager.store.data == before
    reloaded = SetupCodesManager(manager.hass, SetupCodesStore(manager.hass))
    await reloaded.async_setup()
    try:
        assert await reloaded.async_get_view_preferences("user-a") == result
        assert await reloaded.async_get_view_preferences("user-b") == initial
        assert reloaded.store.data == before
    finally:
        await reloaded.async_shutdown()


async def test_concurrent_preferences_cas_rejects_stale_browser_but_not_other_accounts(manager):
    results = await asyncio.gather(
        manager.async_save_view_preferences("user-a", saved_preferences("First"), 0),
        manager.async_save_view_preferences("user-a", saved_preferences("Second"), 0),
        return_exceptions=True,
    )
    assert sum(isinstance(result, dict) for result in results) == 1
    errors = [result for result in results if isinstance(result, InventoryError)]
    assert len(errors) == 1 and errors[0].code == "preferences_conflict"
    assert (await manager.async_get_view_preferences("user-a"))["revision"] == 1
    other = await manager.async_save_view_preferences("user-b", saved_preferences("Other"), 0)
    assert other["revision"] == 1
    assert (await manager.async_get_view_preferences("user-a"))["views"][0]["name"] in (
        "First",
        "Second",
    )


async def test_concurrent_different_account_writes_merge_without_losing_either_account(manager):
    first, second = await asyncio.gather(
        manager.async_save_view_preferences("user-a", saved_preferences("First"), 0),
        manager.async_save_view_preferences("user-b", saved_preferences("Second"), 0),
    )
    assert await manager.async_get_view_preferences("user-a") == first
    assert await manager.async_get_view_preferences("user-b") == second
    assert set(json.loads(manager.preferences_store.path.read_text())["data"]["users"]) == {
        "user-a",
        "user-b",
    }


@pytest.mark.parametrize("expected", [True, False, -1, 2**53, 2**63, 0.0, "0", None])
async def test_preference_revisions_reject_invalid_types_without_writing(manager, expected):
    with pytest.raises(ValueError):
        await manager.async_save_view_preferences("user-a", saved_preferences(), expected)
    assert not manager.preferences_store.path.exists()


async def test_inventory_edits_and_preference_edits_have_independent_revisions_and_exports(manager):
    await manager.async_save(new_record("Inventory only"), revision(manager))
    before = {format: manager.export(format)["content"] for format in ("json", "csv")}
    inventory_revision = revision(manager)
    await manager.async_save_view_preferences("user-a", saved_preferences(), 0)
    assert revision(manager) == inventory_revision
    for format in ("json", "csv"):
        assert manager.export(format)["content"] == before[format]
        assert "defaultViewId" not in manager.export(format)["content"]
    await manager.async_save(new_record("Second record"), inventory_revision)
    assert (await manager.async_save_view_preferences("user-a", saved_preferences("Changed"), 1))[
        "revision"
    ] == 2


async def test_preference_write_failure_preserves_previous_default_and_file(manager, monkeypatch):
    before = await manager.async_save_view_preferences("user-a", saved_preferences(), 0)
    disk_before = manager.preferences_store.path.read_bytes()

    def fail(_data):
        raise OSError("SYNTHETIC_PRIVATE_ERROR")

    monkeypatch.setattr(manager.preferences_store, "_write", fail)
    with pytest.raises(InventoryError, match="preferences_save_failed"):
        await manager.async_save_view_preferences("user-a", {"views": [], "defaultViewId": ""}, 1)
    assert await manager.async_get_view_preferences("user-a") == before
    assert manager.preferences_store.path.read_bytes() == disk_before


async def test_cancelled_preference_write_is_drained_before_shutdown_and_committed_once(
    manager, monkeypatch
):
    entered, release = Event(), Event()
    original = manager.preferences_store._write
    events = []
    unsub = manager.hass.bus.async_listen(
        "setup_code_manager_updated", lambda event: events.append(event.data)
    )

    def blocked(data):
        entered.set()
        if not release.wait(timeout=5):
            raise RuntimeError("Synthetic write not released")
        original(data)

    monkeypatch.setattr(manager.preferences_store, "_write", blocked)
    task = asyncio.create_task(
        manager.async_save_view_preferences("user-a", saved_preferences(), 0)
    )
    shutdown = None
    try:
        assert await asyncio.to_thread(entered.wait, 3)
        task.cancel()
        await asyncio.sleep(0)
        task.cancel()
        await asyncio.sleep(0)
        shutdown = asyncio.create_task(manager.async_shutdown())
        await asyncio.sleep(0)
        assert not task.done()
        assert not shutdown.done()
        assert manager._lock.locked()
    finally:
        release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    await shutdown
    await manager.hass.async_block_till_done()
    unsub()
    assert manager.preferences_store.get("user-a")["revision"] == 1
    assert (
        json.loads(manager.preferences_store.path.read_text())["data"]
        == manager.preferences_store.data
    )
    assert events == [{}]
    with pytest.raises(InventoryError, match="not_loaded"):
        await manager.async_save_view_preferences("user-a", saved_preferences(), 1)
    with pytest.raises(InventoryError, match="not_loaded"):
        await manager.async_get_view_preferences("user-a")


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


async def test_relink_replaces_empty_discovery_record_and_keeps_saved_codes(manager):
    registry = dr.async_get(manager.hass)
    old = add_device(manager, "before-pairing")
    await manager.async_sync()
    original = manager.store.devices[0]
    original["codes"] = [{"id": "code", "protocol": "matter", "value": "34970112332"}]
    original["notes"] = "Keep this note"
    original = await manager.async_save(original, revision(manager))
    registry.async_remove_device(old.id)
    new = add_device(manager, "after-pairing")
    area = ar.async_get(manager.hass).async_create("Bedroom")
    registry.async_update_device(
        new.id, name_by_user="New name", area_id=area.id, serial_number="TEST-001"
    )
    await manager.async_sync()
    before = manager.list_data()["devices"]
    assert len(before) == 2
    assert any(item["linked"] and not item["codes"] for item in before)
    assert any(not item["linked"] and item["codes"] for item in before)
    assert manager.ha_devices()["devices"][0]["relink_available"] is True

    result = await manager.async_relink(original["id"], new.id, revision(manager))
    await manager.async_sync()
    assert manager.list_data()["devices"] == [result]
    assert result["id"] == original["id"]
    assert result["created_at"] == original["created_at"]
    assert result["codes"] == original["codes"]
    assert result["notes"] == original["notes"]
    assert result["linked"] and [link["ha_device_id"] for link in result["links"]] == [new.id]
    assert (result["name"], result["location"], result["serial_number"]) == (
        "New name",
        "Bedroom",
        "TEST-001",
    )


@pytest.mark.parametrize(
    "protected_fields",
    [
        {"notes": "Other record's note"},
        {"codes": [{"id": "other-code", "protocol": "matter", "value": "34970112332"}]},
        {"archived": True},
        {"source_refs": ["legacy:previous"]},
        {"serial_number": "Manual serial"},
    ],
)
async def test_relink_blocks_consolidation_when_other_record_has_its_own_data(
    manager, protected_fields
):
    old = add_device(manager, "old")
    original = await manager.async_save(
        new_record("Original", links=[{"ha_device_id": old.id}]), revision(manager)
    )
    dr.async_get(manager.hass).async_remove_device(old.id)
    device = add_device(manager, "new")
    await manager.async_save(
        new_record("Second", links=[{"ha_device_id": device.id}], **protected_fields),
        revision(manager),
    )
    assert manager.ha_devices()["devices"][0]["relink_available"] is False
    before = manager.store.data
    with pytest.raises(InventoryError, match="relink_blocked"):
        await manager.async_relink(original["id"], device.id, revision(manager))
    assert manager.store.data == before


async def test_relink_rechecks_revision_and_registry_before_writing(manager):
    registry = dr.async_get(manager.hass)
    old = add_device(manager, "old")
    original = await manager.async_save(
        new_record("Original", links=[{"ha_device_id": old.id}]), revision(manager)
    )
    device = add_device(manager, "target")
    with pytest.raises(InventoryError, match="relink_blocked"):
        await manager.async_relink(original["id"], device.id, revision(manager))
    registry.async_remove_device(old.id)
    await manager.async_sync()
    before = manager.store.data
    with pytest.raises(InventoryError, match="conflict"):
        await manager.async_relink(original["id"], device.id, revision(manager) - 1)
    registry.async_remove_device(device.id)
    with pytest.raises(InventoryError, match="device_removed"):
        await manager.async_relink(original["id"], device.id, revision(manager))
    assert manager.store.data == before


async def test_sync_caches_serial_number_when_ha_reports_it_later(manager):
    device = add_device(manager)
    registry = dr.async_get(manager.hass)
    await manager.async_sync()
    assert manager.store.devices[0]["serial_number"] == ""
    registry.async_update_device(device.id, serial_number="LATE-001")
    await manager.async_sync()
    registry.async_remove_device(device.id)
    await manager.async_sync()
    assert manager.list_data()["devices"][0]["serial_number"] == "LATE-001"


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


@pytest.mark.parametrize("format", ["json", "csv"])
async def test_selected_export_is_exact_including_archive_and_preserves_roundtrip(manager, format):
    device = add_device(manager)
    await manager.async_sync()
    linked = manager.store.devices[0]
    archived = await manager.async_save(
        new_record("Archived card", codes=[{"protocol": "homekit", "value": "03145154"}]),
        revision(manager),
    )
    await manager.async_archive(archived["id"], True, revision(manager))
    await manager.async_save(new_record("Not selected"), revision(manager))
    before = manager.store.data
    exported = manager.export(format, [archived["id"], linked["id"]])
    expected = [r for r in before["devices"] if r["id"] != before["devices"][-1]["id"]]
    assert parse_import(format, exported["content"], before["instance_id"]) == expected
    assert exported["count"] == 2
    assert exported["scope"] == "selected"
    assert "-selected-" in exported["filename"]
    assert expected[0]["links"] == [{"ha_device_id": device.id}]
    assert expected[1]["archived"]
    assert manager.store.data == before
    if format == "json":
        envelope = json.loads(exported["content"])
        assert envelope["instance_id"] == before["instance_id"]
        assert envelope["revision"] == before["revision"]
    assert manager.export(format)["scope"] == "all"
    assert manager.export(format)["count"] == 3


@pytest.mark.parametrize("selection", [[], "record", [True], [123], [None], [""], ["a", "a"]])
async def test_invalid_export_selection_is_rejected_without_mutation(manager, selection):
    await manager.async_save(new_record("Existing", id="a"), revision(manager))
    before = manager.store.data
    with pytest.raises(ValueError):
        manager.export("json", selection)
    assert manager.store.data == before


@pytest.mark.parametrize("format", ["json", "csv"])
async def test_removed_export_selection_rejects_entire_export_not_silent_subset(manager, format):
    await manager.async_save(new_record("Existing", id="a"), revision(manager))
    before = manager.store.data
    with pytest.raises(InventoryError, match="not_found"):
        manager.export(format, ["a", "removed"])
    assert manager.store.data == before


async def test_live_area_floor_and_direct_device_labels_are_derived_not_persisted(manager):
    floor = fr.async_get(manager.hass).async_create("Upstairs")
    label = lr.async_get(manager.hass).async_create("Child device")
    area_label = lr.async_get(manager.hass).async_create("Area label only")
    area = ar.async_get(manager.hass).async_create(
        "Child room", floor_id=floor.floor_id, labels={area_label.label_id}
    )
    device = add_device(manager)
    dr.async_get(manager.hass).async_update_device(
        device.id, area_id=area.id, labels={label.label_id}
    )
    await manager.async_sync()
    before = manager.store.data
    result = manager.list_data()["devices"][0]
    metadata = {
        "areas": [
            {
                "id": area.id,
                "name": "Child room",
                "floor_id": floor.floor_id,
                "floor_name": "Upstairs",
            }
        ],
        "labels": [{"id": label.label_id, "name": "Child device"}],
    }
    for key, value in metadata.items():
        assert result["links"][0][key] == value
        assert manager.ha_devices()["devices"][0][key] == value
    assert manager.store.data == before
    for format in ("json", "csv"):
        assert "floor_name" not in manager.export(format)["content"]
        assert "Child device" not in manager.export(format)["content"]
    result["links"][0]["areas"][0]["floor_name"] = "Forged floor"
    result["links"][0]["labels"] = [{"id": "forged", "name": "Forged label"}]
    saved = await manager.async_save(result, revision(manager))
    assert saved["links"][0]["areas"] == metadata["areas"]
    assert saved["links"][0]["labels"] == metadata["labels"]
    assert manager.store.devices[0]["links"] == [{"ha_device_id": device.id}]


async def test_floor_label_renames_and_removal_update_live_metadata(manager):
    floor = fr.async_get(manager.hass).async_create("Old floor")
    label = lr.async_get(manager.hass).async_create("Old label")
    area = ar.async_get(manager.hass).async_create("Room", floor_id=floor.floor_id)
    device = add_device(manager)
    registry = dr.async_get(manager.hass)
    registry.async_update_device(device.id, area_id=area.id, labels={label.label_id})
    await manager.async_sync()
    before = manager.store.data
    fr.async_get(manager.hass).async_update(floor.floor_id, name="New floor")
    lr.async_get(manager.hass).async_update(label.label_id, name="New label")
    link = manager.list_data()["devices"][0]["links"][0]
    assert link["areas"][0]["floor_name"] == "New floor"
    assert link["labels"][0]["name"] == "New label"
    # Organization-only changes must not rewrite the durable record.
    assert manager.store.data == before
    registry.async_update_device(device.id, area_id=None, labels=set())
    link = manager.list_data()["devices"][0]["links"][0]
    assert link["areas"] == [] and link["labels"] == []
    registry.async_remove_device(device.id)
    link = manager.list_data()["devices"][0]["links"][0]
    assert link["active"] is False and link["areas"] == [] and link["labels"] == []


async def test_organization_registry_events_refresh_clients_without_persisting_metadata(manager):
    before = manager.store.data
    with patch.object(manager._debouncer, "async_schedule_call") as schedule:
        for event in (
            ar.EVENT_AREA_REGISTRY_UPDATED,
            fr.EVENT_FLOOR_REGISTRY_UPDATED,
            lr.EVENT_LABEL_REGISTRY_UPDATED,
        ):
            manager.hass.bus.async_fire(
                event,
                {"action": "update", "area_id": "test", "floor_id": "test", "label_id": "test"},
            )
        await manager.hass.async_block_till_done()
    assert schedule.call_count == 3
    assert manager.store.data == before
