"""Atomic, fail-closed storage in Home Assistant's backed-up config directory."""

from __future__ import annotations

import asyncio
import json
from copy import deepcopy
from pathlib import Path
from typing import Any
from uuid import uuid4

from homeassistant.core import HomeAssistant
from homeassistant.util.file import write_utf8_file_atomic

from .const import STORAGE_KEY, STORAGE_VERSION
from .inventory import MAX_LINKS, MAX_RECORDS, _identifier, validate_record


def validate_data(data: Any) -> dict[str, Any]:
    """Reject damaged stores instead of replacing valuable codes with an empty list."""
    if (
        not isinstance(data, dict)
        or set(data) - {"instance_id", "revision", "devices", "ignored_ha_device_ids"}
        or not {"instance_id", "revision", "devices"}.issubset(data)
    ):
        raise ValueError("Invalid inventory envelope")
    _identifier(data["instance_id"], "inventory instance ID")
    if type(data["revision"]) is not int or not 0 <= data["revision"] <= 2**63 - 1:
        raise ValueError("Invalid inventory revision")
    if not isinstance(data["devices"], list) or len(data["devices"]) > MAX_RECORDS:
        raise ValueError("Invalid inventory size")
    devices = [validate_record(record) for record in data["devices"]]
    if len({record["id"] for record in devices}) != len(devices):
        raise ValueError("Duplicate inventory ID")
    links = [link["ha_device_id"] for record in devices for link in record["links"]]
    if len(links) != len(set(links)):
        raise ValueError("A Home Assistant device is linked to multiple records")
    ignored = data.get("ignored_ha_device_ids", [])
    if not isinstance(ignored, list) or len(ignored) > MAX_RECORDS * MAX_LINKS:
        raise ValueError("Invalid ignored HA devices")
    for ha_id in ignored:
        _identifier(ha_id, "ignored Home Assistant device ID")
    return {
        "instance_id": data["instance_id"],
        "revision": data["revision"],
        "devices": devices,
        "ignored_ha_device_ids": sorted(set(ignored)),
    }


class SetupCodesStore:
    """Versioned .storage file; commit memory only after an atomic write succeeds.

    HA Store.async_save logs and swallows write errors. Call the public HA
    atomic-file helper directly so failed saves reach the client. The envelope
    follows HA storage conventions; no private Store methods are used.
    """

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.path = Path(hass.config.path(".storage", STORAGE_KEY))
        self._data = {
            "instance_id": uuid4().hex,
            "revision": 0,
            "devices": [],
            "ignored_ha_device_ids": [],
        }
        self._write_lock = asyncio.Lock()

    def _read(self) -> dict[str, Any] | None:
        try:
            raw = self.path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return None
        try:
            envelope = json.loads(raw)
            if (
                not isinstance(envelope, dict)
                or type(envelope.get("version")) is not int
                or envelope.get("version") != STORAGE_VERSION
                or envelope.get("key") != STORAGE_KEY
                or type(envelope.get("minor_version", 1)) is not int
                or envelope.get("minor_version", 1) != 1
            ):
                raise ValueError("Unsupported inventory storage version")
            return validate_data(envelope.get("data"))
        except (ValueError, TypeError) as err:
            raise ValueError(
                "Inventory storage is invalid; restore a backup before continuing"
            ) from err

    async def async_load(self) -> None:
        loaded = await self.hass.async_add_executor_job(self._read)
        if loaded is not None:
            self._data = loaded
        else:
            await self.async_commit(self._data)

    def _write(self, data: dict[str, Any]) -> None:
        envelope = {
            "version": STORAGE_VERSION,
            "minor_version": 1,
            "key": STORAGE_KEY,
            "data": data,
        }
        self.path.parent.mkdir(parents=True, exist_ok=True)
        write_utf8_file_atomic(
            str(self.path), json.dumps(envelope, ensure_ascii=False), private=True
        )

    async def async_commit(self, candidate: dict[str, Any]) -> None:
        validated = validate_data(candidate)
        async with self._write_lock:
            write_job = self.hass.async_add_executor_job(self._write, validated)
            cancelled = False
            while True:
                try:
                    # Executor threads cannot be cancelled once writing. Keep
                    # both locks held until disk and memory agree, even if the
                    # requesting task is cancelled repeatedly during the write.
                    await asyncio.shield(write_job)
                    break
                except asyncio.CancelledError:
                    if write_job.cancelled():
                        raise
                    cancelled = True
            self._data = validated
            if cancelled:
                raise asyncio.CancelledError

    @property
    def data(self) -> dict[str, Any]:
        return deepcopy(self._data)

    @property
    def devices(self) -> list[dict[str, Any]]:
        return deepcopy(self._data["devices"])

    def get(self, record_id: str) -> dict[str, Any] | None:
        return next((r for r in self.devices if r["id"] == record_id), None)
