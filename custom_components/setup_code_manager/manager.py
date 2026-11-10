"""Durable inventory, optional HA links, and transactional previewed imports."""

from __future__ import annotations

import asyncio
import logging
from collections import Counter
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from time import monotonic
from typing import Any
from uuid import uuid4

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.debounce import Debouncer

from .const import EVENT_UPDATED, REFRESH_COOLDOWN
from .inventory import RECORD_FIELDS, new_record, validate_record
from .protocols import registry_devices, scan_all
from .status import (
    device_identity,
    device_is_available,
    device_protocols,
    linked_identity,
    serialize_record,
)
from .store import SetupCodesStore
from .transfer import MAX_CONTENT_BYTES, ImportIssue, export_data, parse_import, preview_import

_LOGGER = logging.getLogger(__name__)


class InventoryError(Exception):
    """A safe error code for the client; no submitted values in messages."""

    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


def _now() -> str:
    return datetime.now(UTC).isoformat()


class SetupCodesManager:
    def __init__(self, hass: HomeAssistant, store: SetupCodesStore) -> None:
        self.hass = hass
        self.store = store
        self._lock = asyncio.Lock()
        self._closing = False
        self._unsubs: list[Any] = []
        self._debouncer: Debouncer | None = None
        self._previews: dict[str, dict[str, Any]] = {}
        self.legacy_path = Path(hass.config.path(".storage", "setup_codes"))
        self.legacy_available = False

    async def async_setup(self) -> None:
        await self.store.async_load()
        self.legacy_available = await self.hass.async_add_executor_job(self.legacy_path.is_file)
        await self.async_sync()
        self._debouncer = Debouncer(
            self.hass, _LOGGER, cooldown=REFRESH_COOLDOWN, immediate=False, function=self.async_sync
        )
        for event in (dr.EVENT_DEVICE_REGISTRY_UPDATED, ar.EVENT_AREA_REGISTRY_UPDATED):
            self._unsubs.append(self.hass.bus.async_listen(event, self._on_registry))

    @callback
    def async_unload(self) -> None:
        for unsub in self._unsubs:
            unsub()
        self._unsubs.clear()
        self._previews.clear()
        if self._debouncer:
            self._debouncer.async_shutdown()
            self._debouncer = None

    async def async_shutdown(self) -> None:
        """Stop new work and finish all writes before another manager can load."""
        self._closing = True
        self.async_unload()
        async with self._lock:
            pass

    @callback
    def _on_registry(self, _event: Any) -> None:
        if self._debouncer:
            self._debouncer.async_schedule_call()

    def _notify(self) -> None:
        # No record data, especially no codes, on the event bus.
        self.hass.bus.async_fire(EVENT_UPDATED)

    def _check_revision(self, expected_revision: int) -> None:
        if self._closing:
            raise InventoryError("not_loaded")
        if type(expected_revision) is not int or expected_revision != self.store.data["revision"]:
            raise InventoryError("conflict")

    async def _commit(self, data: dict[str, Any]) -> None:
        data["revision"] = self.store.data["revision"] + 1
        try:
            await self.store.async_commit(data)
        except asyncio.CancelledError:
            if self.store.data["revision"] == data["revision"]:
                self._notify()
            raise
        except ValueError as err:
            raise InventoryError("validation_error") from err
        except Exception as err:
            # Preserve old memory and disk contents; do not log submitted data.
            raise InventoryError("save_failed") from err
        self._notify()

    def list_data(self) -> dict[str, Any]:
        data = self.store.data
        return {
            "instance_id": data["instance_id"],
            "revision": data["revision"],
            "legacy_available": self.legacy_available,
            "devices": [serialize_record(self.hass, r) for r in data["devices"]],
        }

    def _area_name(self, area_id: str | None) -> str:
        area = ar.async_get(self.hass).async_get_area(area_id) if area_id else None
        return area.name if area else ""

    def ha_devices(self) -> dict[str, Any]:
        owners: dict[str, list[str]] = {}
        for record in self.store.devices:
            for link in record["links"]:
                owners.setdefault(link["ha_device_id"], []).append(record["id"])
        devices = []
        for device in registry_devices(self.hass):
            if device.entry_type == dr.DeviceEntryType.SERVICE:
                continue
            domains = set()
            entry_ids = (
                [device.config_entry_id]
                if hasattr(device, "config_entry_id")
                else device.config_entries
            )
            for entry_id in entry_ids:
                entry = self.hass.config_entries.async_get_entry(entry_id)
                if entry:
                    domains.add(entry.domain)
            devices.append(
                {
                    "id": device.id,
                    **device_identity(self.hass, device),
                    "manufacturer": device.manufacturer or "",
                    "model": device.model or "",
                    "serial_number": device.serial_number or "",
                    "protocols": device_protocols(device),
                    "integration_names": sorted(domains),
                    "record_ids": owners.get(device.id, []),
                    "available": device_is_available(self.hass, device.id),
                    "via_device_id": device.via_device_id,
                }
            )
        return {"devices": sorted(devices, key=lambda d: d["name"].casefold())}

    async def async_sync(self) -> list[dict[str, Any]]:
        """Discover supported devices by exact registry ID; never remove saved data."""
        async with self._lock:
            if self._closing:
                return self.store.devices
            data = self.store.data
            linked = {
                link["ha_device_id"]: record
                for record in data["devices"]
                for link in record["links"]
            }
            changed = False
            for snapshot in scan_all(self.hass):
                ha_id = snapshot["ha_device_id"]
                if ha_id in data["ignored_ha_device_ids"]:
                    continue
                record = linked.get(ha_id)
                if record is None:
                    record = new_record(
                        name=(snapshot["name"] or "Gerät")[:256],
                        manufacturer=(snapshot.get("manufacturer") or "")[:256],
                        model=(snapshot.get("model") or "")[:256],
                        serial_number=(snapshot.get("serial_number") or "")[:256],
                        location=self._area_name(snapshot.get("area_id"))[:256],
                        links=[{"ha_device_id": ha_id}],
                    )
                    data["devices"].append(record)
                    linked[ha_id] = record
                    changed = True
                discovered = snapshot.get("discovered_setup_code")
                if (
                    discovered
                    and not record["archived"]
                    and not any(c["protocol"] == snapshot["protocol"] for c in record["codes"])
                ):
                    candidate = deepcopy(record)
                    candidate["codes"].append(
                        {
                            "id": uuid4().hex,
                            "protocol": snapshot["protocol"],
                            "value": discovered,
                            "label": "",
                        }
                    )
                    try:
                        validated = validate_record(candidate)
                    except ValueError:
                        continue
                    record.update(validated, updated_at=_now())
                    changed = True
            # Include archived records and links to integrations outside discovery.
            # Keep the last persisted HA identity if every linked device disappears.
            for record in data["devices"]:
                identity = linked_identity(self.hass, record["links"])
                if identity and any(record[field] != value for field, value in identity.items()):
                    record.update(identity, updated_at=_now())
                    changed = True
            if changed:
                await self._commit(data)
            else:
                # Removal/reachability can change live status without a durable edit.
                self._notify()
            return self.store.devices

    def _validate_links(
        self, record: dict[str, Any], existing: dict[str, Any] | None, devices: list[dict[str, Any]]
    ) -> None:
        old_ids = {link["ha_device_id"] for link in (existing or {}).get("links", [])}
        for link in record["links"]:
            ha_id = link["ha_device_id"]
            device = dr.async_get(self.hass).async_get(ha_id)
            if ha_id not in old_ids and (
                device is None or device.entry_type == dr.DeviceEntryType.SERVICE
            ):
                raise InventoryError("device_removed")
            if any(
                r["id"] != record["id"]
                and any(link["ha_device_id"] == ha_id for link in r["links"])
                for r in devices
            ):
                raise InventoryError("duplicate_link")

    async def async_save(self, raw: dict[str, Any], expected_revision: int) -> dict[str, Any]:
        async with self._lock:
            self._check_revision(expected_revision)
            data = self.store.data
            # Permit only documented runtime additions; reject other unknown input.
            allowed = RECORD_FIELDS | {"linked", "available", "protocols"}
            if not isinstance(raw, dict) or set(raw) - allowed:
                raise InventoryError("validation_error")
            clean = {k: deepcopy(v) for k, v in raw.items() if k in RECORD_FIELDS}
            # Display-only Matter manual codes are always derived from value.
            # Strip only this documented runtime field; all others stay strict.
            if isinstance(clean.get("codes"), list):
                for code in clean["codes"]:
                    if isinstance(code, dict):
                        code.pop("manual_value", None)
            asserted_active = (
                {
                    link.get("ha_device_id")
                    for link in raw.get("links", [])
                    if isinstance(link, dict) and link.get("active") is True
                }
                if isinstance(raw.get("links", []), list)
                else set()
            )
            if isinstance(clean.get("links"), list):
                clean["links"] = [
                    {
                        k: v
                        for k, v in link.items()
                        if k not in {"active", "name", "location", "available"}
                    }
                    if isinstance(link, dict)
                    else link
                    for link in clean["links"]
                ]
            clean.update(linked_identity(self.hass, clean.get("links")) or {})
            existing = next((r for r in data["devices"] if r["id"] == clean.get("id")), None)
            try:
                record = new_record(**clean)
            except (ValueError, TypeError) as err:
                raise InventoryError(
                    "invalid_code" if "code" in str(err).lower() else "validation_error"
                ) from err
            if existing:
                record["created_at"] = existing["created_at"]
                # Archives are changed only through the explicit archive action.
                record["archived"] = existing["archived"]
                record["source_refs"] = existing["source_refs"]
            for ha_id in asserted_active:
                device = dr.async_get(self.hass).async_get(ha_id)
                if device is None or device.entry_type == dr.DeviceEntryType.SERVICE:
                    raise InventoryError("device_removed")
            self._validate_links(record, existing, data["devices"])
            record["updated_at"] = _now()
            data["devices"] = [r for r in data["devices"] if r["id"] != record["id"]] + [record]
            link_ids = {link["ha_device_id"] for link in record["links"]}
            data["ignored_ha_device_ids"] = [
                i for i in data["ignored_ha_device_ids"] if i not in link_ids
            ]
            await self._commit(data)
            return serialize_record(self.hass, record)

    async def async_archive(self, record_id: str, archived: bool, expected_revision: int) -> None:
        async with self._lock:
            self._check_revision(expected_revision)
            data = self.store.data
            record = next((r for r in data["devices"] if r["id"] == record_id), None)
            if record is None:
                raise InventoryError("not_found")
            record.update(
                linked_identity(self.hass, record["links"]) or {},
                archived=archived,
                updated_at=_now(),
            )
            await self._commit(data)

    async def async_delete(self, record_id: str, expected_revision: int) -> None:
        async with self._lock:
            self._check_revision(expected_revision)
            data = self.store.data
            record = next((r for r in data["devices"] if r["id"] == record_id), None)
            if record is None:
                raise InventoryError("not_found")
            data["devices"].remove(record)
            data["ignored_ha_device_ids"] = sorted(
                set(data["ignored_ha_device_ids"])
                | {link["ha_device_id"] for link in record["links"]}
            )
            await self._commit(data)

    def export(self, format: str) -> dict[str, str]:
        return {
            "content": export_data(format, self.store.data),
            "filename": f"setup-code-manager-{datetime.now(UTC):%Y-%m-%d}.{format}",
            "mime": "application/json" if format == "json" else "text/csv;charset=utf-8",
        }

    def _read_legacy(self) -> str:
        if self.legacy_path.stat().st_size > MAX_CONTENT_BYTES:
            raise ValueError("Legacy file too large")
        return self.legacy_path.read_text(encoding="utf-8")

    def _prepare_links(
        self, incoming: list[dict[str, Any]], current: list[dict[str, Any]], *, legacy: bool
    ) -> dict[str, str]:
        """Keep uncertain imports separate and unlinked, never infer from names."""
        reasons = {}
        owners = {link["ha_device_id"]: r for r in current for link in r["links"]}
        counts = Counter(link["ha_device_id"] for r in incoming for link in r.get("links", []))
        for record in incoming:
            if isinstance(record, ImportIssue):
                continue
            if legacy:
                source_match = next(
                    (r for r in current if set(r["source_refs"]) & set(record["source_refs"])), None
                )
                if source_match:
                    record["id"] = source_match["id"]
                    record["created_at"] = source_match["created_at"]
                elif len(record["links"]) == 1:
                    ha_id = record["links"][0]["ha_device_id"]
                    owner = owners.get(ha_id)
                    if (
                        owner
                        and not owner["codes"]
                        and not owner["archived"]
                        and counts[ha_id] == 1
                    ):
                        record["id"] = owner["id"]
                        record["created_at"] = owner["created_at"]
            kept = []
            for link in record["links"]:
                ha_id = link["ha_device_id"]
                owner = owners.get(ha_id)
                device = dr.async_get(self.hass).async_get(ha_id)
                if (
                    device is None
                    or device.entry_type == dr.DeviceEntryType.SERVICE
                    or (owner and owner["id"] != record["id"])
                    or counts[ha_id] > 1
                ):
                    reasons[record["id"]] = "link_not_restored"
                else:
                    kept.append(link)
            record["links"] = kept
            record.update(linked_identity(self.hass, kept) or {})
        return reasons

    async def async_preview_import(self, format: str, content: str, owner: str) -> dict[str, Any]:
        if format == "legacy":
            try:
                content = await self.hass.async_add_executor_job(self._read_legacy)
            except (OSError, ValueError, UnicodeError) as err:
                raise InventoryError("invalid_import") from err
        async with self._lock:
            if self._closing:
                raise InventoryError("not_loaded")
            data = self.store.data
            try:
                incoming = parse_import(format, content, data["instance_id"])
                reasons = self._prepare_links(incoming, data["devices"], legacy=format == "legacy")
                for record in data["devices"]:
                    record.update(linked_identity(self.hass, record["links"]) or {})
                rows = preview_import(data["devices"], incoming)
            except ValueError as err:
                raise InventoryError("invalid_import") from err
            for row in rows:
                if row["id"] in reasons:
                    row["reason"] = reasons[row["id"]]
            token = uuid4().hex
            self._previews = {t: p for t, p in self._previews.items() if p["expires"] > monotonic()}
            while len(self._previews) >= 8:
                self._previews.pop(next(iter(self._previews)))
            self._previews[token] = {
                "owner": owner,
                "expires": monotonic() + 600,
                "revision": data["revision"],
                "rows": deepcopy(rows),
            }
            return {
                "token": token,
                "revision": data["revision"],
                "rows": rows,
                "counts": dict(Counter(row["status"] for row in rows)),
            }

    async def async_import(
        self, token: str, expected_revision: int, decisions: dict[str, str], owner: str
    ) -> dict[str, int]:
        async with self._lock:
            self._check_revision(expected_revision)
            preview = self._previews.get(token)
            if not preview or preview["owner"] != owner or preview["expires"] <= monotonic():
                raise InventoryError("preview_expired")
            if preview["revision"] != expected_revision:
                raise InventoryError("conflict")
            if set(decisions) - {r["key"] for r in preview["rows"]}:
                raise InventoryError("validation_error")
            data = self.store.data
            imported = skipped = 0
            for row in preview["rows"]:
                choice = decisions.get(row["key"], "skip")
                if choice == "skip":
                    skipped += 1
                    continue
                if (row["status"], choice) not in {("new", "add"), ("conflict", "replace")}:
                    raise InventoryError("validation_error")
                record = validate_record(row["incoming"])
                existing = next((r for r in data["devices"] if r["id"] == record["id"]), None)
                self._validate_links(record, existing, data["devices"])
                record.update(linked_identity(self.hass, record["links"]) or {})
                data["devices"] = [r for r in data["devices"] if r["id"] != record["id"]] + [record]
                linked = {link["ha_device_id"] for link in record["links"]}
                data["ignored_ha_device_ids"] = [
                    i for i in data["ignored_ha_device_ids"] if i not in linked
                ]
                imported += 1
            if imported:
                await self._commit(data)
            self._previews.pop(token, None)
            return {"imported": imported, "skipped": skipped}
