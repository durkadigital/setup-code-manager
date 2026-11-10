"""Strict preference schemas and atomic, private HA configuration storage."""

import asyncio
import io
import json
import tarfile
from copy import deepcopy
from threading import Event
from types import SimpleNamespace

import pytest
from homeassistant.components.backup.manager import CoreBackupReaderWriter

from custom_components.setup_code_manager.preferences import (
    MAX_VIEWS,
    STORAGE_KEY,
    ViewPreferencesStore,
    validate_preferences,
    validate_settings,
)


def preferences(**settings):
    return {
        "views": [{"id": "home", "name": "  Zuhause   Küche  ", "settings": settings}],
        "defaultViewId": "home",
    }


class ExecutorHass:
    def __init__(self, path):
        self.config = SimpleNamespace(path=lambda *parts: str(path.joinpath(*parts)))

    def async_add_executor_job(self, function, *args):
        return asyncio.get_running_loop().run_in_executor(None, function, *args)


@pytest.fixture
def store(tmp_path):
    return ViewPreferencesStore(ExecutorHass(tmp_path))


def test_all_supported_settings_preserve_exact_unicode_selectors():
    settings = {
        "tab": "archive",
        "protocol": "matter",
        "codeStatus": "missing",
        "room": "room: Küche ",
        "floor": "floor:" + "f" * 1024,
        "label": "label:" + "l" * 1024,
        "sort": "missing-first",
        "group": "room",
    }
    result = validate_preferences(preferences(**settings))
    assert result["views"][0]["settings"] == settings
    assert result["views"][0]["name"] == "Zuhause Küche"
    assert validate_settings({}) == {
        "tab": "all",
        "protocol": "",
        "codeStatus": "all",
        "room": "",
        "floor": "",
        "label": "",
        "sort": "name-asc",
        "group": "none",
    }


@pytest.mark.parametrize(
    "settings",
    [
        {"query": "PRIVATE"},
        {"notes": "PRIVATE"},
        {"codes": ["PRIVATE"]},
        {"tab": True},
        {"tab": "invalid"},
        {"protocol": "zigbee"},
        {"codeStatus": ""},
        {"sort": "asc"},
        {"group": "floor"},
        {"room": None},
        {"room": "room:"},
        {"room": "room:   "},
        {"room": "floor:x"},
        {"room": "room:a\nb"},
        {"room": "room:" + "x" * 257},
        {"floor": "floor:" + "x" * 1025},
        {"label": "label:" + "x" * 1025},
    ],
)
def test_invalid_settings_reject_instead_of_silently_persisting(settings):
    with pytest.raises(ValueError):
        validate_preferences(preferences(**settings))


@pytest.mark.parametrize(
    "patch",
    [
        {"query": "PRIVATE"},
        {"codes": ["PRIVATE"]},
        {"revision": 0},
        {"views": {}},
        {"views": [None]},
        {"defaultViewId": None},
        {"defaultViewId": "missing"},
    ],
)
def test_unknown_or_malformed_preferences_are_rejected(patch):
    value = preferences()
    value.update(patch)
    with pytest.raises(ValueError):
        validate_preferences(value)


@pytest.mark.parametrize(
    "patch",
    [
        {"id": ""},
        {"id": "bad id"},
        {"id": "a" * 81},
        {"id": 1},
        {"name": ""},
        {"name": "   "},
        {"name": "a" * 81},
        {"name": "a\nb"},
        {"name": "a\x7fb"},
        {"name": None},
        {"notes": "PRIVATE"},
        {"query": "PRIVATE"},
        {"settings": []},
    ],
)
def test_view_ids_names_and_fields_are_strict(patch):
    value = preferences()
    value["views"][0].update(patch)
    with pytest.raises(ValueError):
        validate_preferences(value)


def test_twenty_views_are_allowed_but_duplicate_ids_and_overflow_are_rejected():
    views = [{"id": f"view-{i}", "name": f"View {i}", "settings": {}} for i in range(MAX_VIEWS)]
    assert len(validate_preferences({"views": views, "defaultViewId": "view-19"})["views"]) == 20
    for invalid in ([*views, deepcopy(views[0])], [views[0], deepcopy(views[0])]):
        with pytest.raises(ValueError):
            validate_preferences({"views": invalid, "defaultViewId": ""})


def test_selector_limits_match_javascript_utf16_units_and_reject_lone_surrogates():
    assert validate_settings({"room": "room:" + "😀" * 128})["room"] == "room:" + "😀" * 128
    for settings in ({"room": "room:" + "😀" * 129}, {"room": "room:\ud800"}):
        with pytest.raises(ValueError):
            validate_settings(settings)
    invalid = preferences()
    invalid["views"][0]["name"] = "Invalid\ud800"
    with pytest.raises(ValueError):
        validate_preferences(invalid)


@pytest.mark.asyncio
async def test_missing_store_is_empty_and_does_not_create_or_share_accounts(store):
    await store.async_load()
    assert store.get("user-a") == {"revision": 0, "views": [], "defaultViewId": ""}
    assert store.get("user-b") == store.get("user-a")
    assert not store.path.exists()
    result = store.get("user-a")
    result["views"].append("mutated")
    assert store.get("user-a")["views"] == []


@pytest.mark.asyncio
async def test_roundtrip_preserves_users_in_private_backed_up_configuration_file(store):
    await store.async_load()
    candidate = {
        "users": {"user-a": {"revision": 2, **validate_preferences(preferences(room="room:Küche"))}}
    }
    await store.async_commit(candidate)
    assert store.path.parent.name == ".storage"
    assert store.path.name == STORAGE_KEY
    assert store.path.stat().st_mode & 0o777 == 0o600
    reloaded = ViewPreferencesStore(store.hass)
    await reloaded.async_load()
    assert reloaded.data == candidate
    assert reloaded.get("user-a")["revision"] == 2
    assert reloaded.get("user-b")["views"] == []
    detached = reloaded.data
    detached["users"]["user-a"]["views"].clear()
    assert reloaded.get("user-a")["views"]


@pytest.mark.asyncio
async def test_real_ha_config_backup_archive_includes_preferences_with_exact_contents(store):
    candidate = {"users": {"user-a": {"revision": 1, **validate_preferences(preferences())}}}
    await store.async_commit(candidate)
    writer = CoreBackupReaderWriter(store.hass)
    archive, _size = await store.hass.async_add_executor_job(
        writer._mkdir_and_generate_backup_contents,
        {"slug": "synthetic-preferences-backup"},
        False,
        None,
        None,
    )
    with tarfile.open(archive) as outer:
        member = next(
            item for item in outer.getmembers() if item.name.lstrip("./") == "homeassistant.tar.gz"
        )
        inner_bytes = outer.extractfile(member).read()
    with tarfile.open(fileobj=io.BytesIO(inner_bytes), mode="r:gz") as inner:
        member = next(
            item for item in inner.getmembers() if item.name == f"data/.storage/{STORAGE_KEY}"
        )
        assert inner.extractfile(member).read() == store.path.read_bytes()


@pytest.mark.asyncio
@pytest.mark.parametrize("raw", ["{broken", "null", "[]", '{"version":true}', '{"version":2}'])
async def test_corrupt_existing_preferences_file_is_not_replaced(store, raw):
    store.path.parent.mkdir(parents=True, exist_ok=True)
    store.path.write_text(raw)
    with pytest.raises((ValueError, TypeError)):
        await store.async_load()
    assert store.path.read_text() == raw
    assert store.data == {"users": {}}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "patch",
    [
        {"version": True},
        {"minor_version": False},
        {"key": "setup_code_manager"},
        {"extra": "PRIVATE"},
        {"data": {"users": [], "codes": ["PRIVATE"]}},
        {"data": {"users": {"user-a": {"revision": True, "views": [], "defaultViewId": ""}}}},
        {"data": {"users": {"user-a": {"revision": 1, "views": [], "defaultViewId": "gone"}}}},
    ],
)
async def test_damaged_envelope_and_account_schema_do_not_replace_valid_memory_or_disk(
    store, patch
):
    before = {"users": {"user-a": {"revision": 1, **validate_preferences(preferences())}}}
    await store.async_commit(before)
    envelope = json.loads(store.path.read_text())
    envelope.update(patch)
    raw = json.dumps(envelope)
    store.path.write_text(raw)
    with pytest.raises(ValueError):
        await store.async_load()
    assert store.path.read_text() == raw
    assert store.data == before


@pytest.mark.asyncio
async def test_failed_atomic_write_preserves_disk_and_memory(store, monkeypatch):
    before = {"users": {"user-a": {"revision": 1, **validate_preferences(preferences())}}}
    await store.async_commit(before)
    disk_before = store.path.read_bytes()

    def fail(_data):
        raise OSError("SYNTHETIC_SECRET_DISK_ERROR")

    monkeypatch.setattr(store, "_write", fail)
    candidate = deepcopy(before)
    candidate["users"]["user-a"]["revision"] = 2
    with pytest.raises(OSError):
        await store.async_commit(candidate)
    assert store.data == before
    assert store.path.read_bytes() == disk_before


@pytest.mark.asyncio
async def test_repeated_cancellation_keeps_atomic_write_lock_until_disk_and_memory_agree(
    store, monkeypatch
):
    entered, release = Event(), Event()
    original = store._write

    def blocked(data):
        entered.set()
        if not release.wait(timeout=5):
            raise RuntimeError("Synthetic write not released")
        original(data)

    monkeypatch.setattr(store, "_write", blocked)
    candidate = {"users": {"user-a": {"revision": 1, **validate_preferences(preferences())}}}
    task = asyncio.create_task(store.async_commit(candidate))
    try:
        assert await asyncio.to_thread(entered.wait, 3)
        for _ in range(2):
            task.cancel()
            await asyncio.sleep(0)
        assert not task.done()
        assert store._write_lock.locked()
    finally:
        release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert store.data == candidate
    assert json.loads(store.path.read_text())["data"] == candidate
    assert not store._write_lock.locked()
