"""Durability, failure preservation and executor-cancellation boundaries."""

import asyncio
import json
from copy import deepcopy
from pathlib import Path
from threading import Event
from types import SimpleNamespace

import pytest

from custom_components.setup_code_manager.const import STORAGE_KEY
from custom_components.setup_code_manager.inventory import new_record
from custom_components.setup_code_manager.store import SetupCodesStore, validate_data


class ExecutorHass:
    """Real executor behavior with a temporary HA configuration path."""

    def __init__(self, path: Path):
        self.config = SimpleNamespace(path=lambda *parts: str(path.joinpath(*parts)))

    def async_add_executor_job(self, function, *args):
        return asyncio.get_running_loop().run_in_executor(None, function, *args)


@pytest.fixture
def store(tmp_path):
    return SetupCodesStore(ExecutorHass(tmp_path))


@pytest.mark.asyncio
async def test_atomic_roundtrip_reload_and_private_file(store):
    await store.async_load()
    original_instance = store.data["instance_id"]
    candidate = store.data
    candidate["revision"] = 1
    candidate["devices"] = [
        new_record("Küche", archived=True, codes=[{"protocol": "homekit", "value": "03145154"}])
    ]
    candidate["ignored_ha_device_ids"] = ["deleted-device"]
    await store.async_commit(candidate)
    assert store.path.parent.name == ".storage"
    assert store.path.name == STORAGE_KEY
    assert store.path.stat().st_mode & 0o777 == 0o600
    reloaded = SetupCodesStore(store.hass)
    await reloaded.async_load()
    assert reloaded.data == candidate
    assert reloaded.data["instance_id"] == original_instance
    detached = reloaded.data
    detached["devices"][0]["name"] = "Mutated copy"
    assert reloaded.devices[0]["name"] == "Küche"


@pytest.mark.asyncio
async def test_failed_write_preserves_previous_memory_and_file(store, monkeypatch):
    await store.async_load()
    before = store.data
    disk_before = store.path.read_bytes()
    candidate = store.data
    candidate["devices"].append(new_record("Should not be saved"))
    candidate["revision"] += 1

    def fail_write(_data):
        raise OSError("disk unavailable")

    monkeypatch.setattr(store, "_write", fail_write)
    with pytest.raises(OSError):
        await store.async_commit(candidate)
    assert store.data == before
    assert store.path.read_bytes() == disk_before


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "corruption", ["{broken", "null", '{"version":2,"key":"setup_code_manager","data":{}}']
)
async def test_corrupt_existing_store_is_never_replaced(store, corruption):
    store.path.parent.mkdir(parents=True)
    store.path.write_text(corruption, encoding="utf-8")
    before = store.data
    with pytest.raises(ValueError, match="restore a backup"):
        await store.async_load()
    assert store.path.read_text(encoding="utf-8") == corruption
    assert store.data == before


@pytest.mark.asyncio
@pytest.mark.parametrize("field", ["version", "minor_version"])
async def test_boolean_storage_version_rejected_without_overwrite(store, field):
    await store.async_load()
    envelope = json.loads(store.path.read_text())
    envelope[field] = True
    corrupted = json.dumps(envelope)
    store.path.write_text(corrupted)
    with pytest.raises(ValueError):
        await store.async_load()
    assert store.path.read_text() == corrupted


@pytest.mark.parametrize(
    "patch",
    [
        {"instance_id": "=bad()"},
        {"instance_id": ""},
        {"revision": True},
        {"revision": -1},
        {"revision": 2**63},
        {"ignored_ha_device_ids": ["bad\nid"]},
        {"ignored_ha_device_ids": "bad"},
        {"devices": {}},
        {"unknown": 1},
    ],
)
def test_envelope_validation_is_strict(store, patch):
    candidate = store.data
    candidate.update(patch)
    with pytest.raises(ValueError):
        validate_data(candidate)


def test_duplicate_inventory_ids_and_shared_device_links_rejected(store):
    candidate = store.data
    first = new_record("Device", links=[{"ha_device_id": "ha-one"}])
    candidate["devices"] = [first, deepcopy(first)]
    with pytest.raises(ValueError, match="Duplicate"):
        validate_data(candidate)
    candidate["devices"][1]["id"] = "different-record"
    with pytest.raises(ValueError, match="multiple records"):
        validate_data(candidate)


@pytest.mark.asyncio
async def test_cancelled_executor_write_finishes_before_lock_release_and_updates_memory(
    store, monkeypatch
):
    await store.async_load()
    entered = Event()
    release = Event()
    original_write = store._write

    def blocked_write(data):
        entered.set()
        if not release.wait(timeout=5):
            raise RuntimeError("test write was not released")
        original_write(data)

    monkeypatch.setattr(store, "_write", blocked_write)
    candidate = store.data
    candidate["revision"] = 1
    candidate["devices"] = [new_record("Committed despite disconnect")]
    task = asyncio.create_task(store.async_commit(candidate))
    try:
        assert await asyncio.to_thread(entered.wait, 3)
        task.cancel()
        await asyncio.sleep(0)
        task.cancel()  # Repeated cancellation must not release the write lock.
        await asyncio.sleep(0)
        assert not task.done()
        assert store._write_lock.locked()
    finally:
        release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert not store._write_lock.locked()
    assert store.data == candidate
    assert json.loads(store.path.read_text())["data"] == candidate
    next_data = store.data
    next_data["revision"] = 2
    next_data["devices"][0]["name"] = "Next edit"
    await store.async_commit(next_data)
    assert store.data == next_data


@pytest.mark.asyncio
async def test_cancel_before_lock_acquisition_never_writes(store):
    await store.async_load()
    before = store.path.read_bytes()
    async with store._write_lock:
        task = asyncio.create_task(store.async_commit(store.data))
        await asyncio.sleep(0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    assert store.path.read_bytes() == before
