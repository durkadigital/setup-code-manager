"""Durable inventory, optional HA links, and transactional previewed imports."""

from __future__ import annotations

import asyncio
import base64
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
from homeassistant.helpers import floor_registry as fr
from homeassistant.helpers import label_registry as lr
from homeassistant.helpers.debounce import Debouncer

from .const import EVENT_UPDATED, REFRESH_COOLDOWN
from .device_pdf import MAX_PDF_BYTES, MAX_PDF_RECORDS, DevicePDFError, build_device_pdf
from .inventory import MAX_RECORDS, RECORD_FIELDS, _identifier, new_record, validate_record
from .preferences import (
    MAX_REVISION,
    ViewPreferencesStore,
    validate_preferences,
    validate_revision,
)
from .protocols import registry_devices, scan_all
from .status import (
    device_identity,
    device_is_available,
    device_organization,
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


def _hardware_fields(device: dr.DeviceEntry) -> dict[str, str]:
    return {
        "manufacturer": (device.manufacturer or "")[:256],
        "model": (device.model or device.model_id or "")[:256],
        "serial_number": (device.serial_number or "")[:256],
    }


def _can_reuse_link(device: dr.DeviceEntry, owners: list[dict[str, Any]]) -> bool:
    """Allow consolidation only when the linked row holds no separate inventory data."""
    if not owners:
        return True
    if len(owners) != 1:
        return False
    owner = owners[0]
    return (
        owner["links"] == [{"ha_device_id": device.id}]
        and not (owner["archived"] or owner["codes"] or owner["notes"] or owner["source_refs"])
        and all(
            not owner[field] or owner[field] == value
            for field, value in _hardware_fields(device).items()
        )
    )


class SetupCodesManager:
    def __init__(
        self,
        hass: HomeAssistant,
        store: SetupCodesStore,
        preferences_store: ViewPreferencesStore | None = None,
    ) -> None:
        self.hass = hass
        self.store = store
        self.preferences_store = (
            preferences_store if preferences_store is not None else ViewPreferencesStore(hass)
        )
        self._view_preferences_error = False
        self._lock = asyncio.Lock()
        self._pdf_lock = asyncio.Lock()
        self._closing = False
        self._unsubs: list[Any] = []
        self._debouncer: Debouncer | None = None
        self._previews: dict[str, dict[str, Any]] = {}
        self.legacy_path = Path(hass.config.path(".storage", "setup_codes"))
        self.legacy_available = False

    async def async_setup(self) -> None:
        await self.store.async_load()
        try:
            await self.preferences_store.async_load()
        except Exception:
            # A damaged preferences file must neither block access to codes nor
            # be overwritten with an empty set of views. Keep the error local.
            self._view_preferences_error = True
            _LOGGER.warning("Saved view preferences are unavailable; inventory remains accessible")
        self.legacy_available = await self.hass.async_add_executor_job(self.legacy_path.is_file)
        await self.async_sync()
        self._debouncer = Debouncer(
            self.hass, _LOGGER, cooldown=REFRESH_COOLDOWN, immediate=False, function=self.async_sync
        )
        for event in (
            dr.EVENT_DEVICE_REGISTRY_UPDATED,
            ar.EVENT_AREA_REGISTRY_UPDATED,
            fr.EVENT_FLOOR_REGISTRY_UPDATED,
            lr.EVENT_LABEL_REGISTRY_UPDATED,
        ):
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
        # An executor thread cannot be cancelled. PDF requests retain this lock
        # until rendering finishes, including after client cancellation.
        async with self._pdf_lock:
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

    def _check_preferences_available(self) -> None:
        if self._closing:
            raise InventoryError("not_loaded")
        if self._view_preferences_error:
            raise InventoryError("preferences_unavailable")

    async def async_get_view_preferences(self, user_id: str) -> dict[str, Any]:
        """Return only the authenticated account's saved views, never other users."""
        async with self._lock:
            self._check_preferences_available()
            return self.preferences_store.get(user_id)

    async def async_save_view_preferences(
        self, user_id: str, preferences: dict[str, Any], expected_revision: int
    ) -> dict[str, Any]:
        """CAS account preferences without changing the inventory revision."""
        validated = validate_preferences(preferences)
        expected_revision = validate_revision(expected_revision)
        async with self._lock:
            self._check_preferences_available()
            current = self.preferences_store.get(user_id)
            if expected_revision != current["revision"]:
                raise InventoryError("preferences_conflict")
            if current["revision"] == MAX_REVISION:
                raise InventoryError("preferences_save_failed")
            result = {"revision": current["revision"] + 1, **validated}
            data = self.preferences_store.data
            data["users"][user_id] = result
            try:
                await self.preferences_store.async_commit(data)
            except asyncio.CancelledError:
                if self.preferences_store.get(user_id)["revision"] == result["revision"]:
                    self._notify()
                raise
            except Exception as err:
                raise InventoryError("preferences_save_failed") from err
            self._notify()
            return self.preferences_store.get(user_id)

    def _area_name(self, area_id: str | None) -> str:
        area = ar.async_get(self.hass).async_get_area(area_id) if area_id else None
        return area.name if area else ""

    def ha_devices(self) -> dict[str, Any]:
        owners: dict[str, list[dict[str, Any]]] = {}
        for record in self.store.devices:
            for link in record["links"]:
                owners.setdefault(link["ha_device_id"], []).append(record)
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
            linked_records = owners.get(device.id, [])
            devices.append(
                {
                    "id": device.id,
                    **device_identity(self.hass, device),
                    **device_organization(self.hass, device),
                    **_hardware_fields(device),
                    "protocols": device_protocols(device),
                    "integration_names": sorted(domains),
                    "record_ids": [record["id"] for record in linked_records],
                    "relink_available": _can_reuse_link(device, linked_records),
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
            registry = dr.async_get(self.hass)
            for record in data["devices"]:
                identity = linked_identity(self.hass, record["links"])
                if identity and len(record["links"]) == 1 and not record["serial_number"]:
                    device = registry.async_get(record["links"][0]["ha_device_id"])
                    if device is not None and device.serial_number:
                        identity["serial_number"] = device.serial_number[:256]
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
                        if k not in {"active", "name", "location", "available", "areas", "labels"}
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

    async def async_relink(
        self, record_id: str, ha_device_id: str, expected_revision: int
    ) -> dict[str, Any]:
        """Reattach a disconnected record and consolidate an empty discovery row atomically."""
        _identifier(record_id, "record ID")
        _identifier(ha_device_id, "Home Assistant device ID")
        async with self._lock:
            self._check_revision(expected_revision)
            data = self.store.data
            records = data["devices"]
            record = next((item for item in records if item["id"] == record_id), None)
            if record is None:
                raise InventoryError("not_found")
            registry = dr.async_get(self.hass)
            device = registry.async_get(ha_device_id)
            if device is None or device.entry_type == dr.DeviceEntryType.SERVICE:
                raise InventoryError("device_removed")
            if (
                record["archived"]
                or not record["links"]
                or linked_identity(self.hass, record["links"])
            ):
                raise InventoryError("relink_blocked")

            link = {"ha_device_id": ha_device_id}
            owners = [item for item in records if link in item["links"]]
            if not _can_reuse_link(device, owners):
                raise InventoryError("relink_blocked")

            record.update(device_identity(self.hass, device), links=[link], updated_at=_now())
            for field, value in _hardware_fields(device).items():
                if not record[field]:
                    record[field] = value
            if owners:
                records.remove(owners[0])
            if ha_device_id in data["ignored_ha_device_ids"]:
                data["ignored_ha_device_ids"].remove(ha_device_id)
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

    def export(self, format: str, record_ids: list[str] | None = None) -> dict[str, Any]:
        """Export all records, or an exact nonempty selection without changing data."""
        data = self.store.data
        selected = record_ids is not None
        if selected:
            if not isinstance(record_ids, list) or not 1 <= len(record_ids) <= MAX_RECORDS:
                raise ValueError("Invalid export selection.")
            requested = {_identifier(record_id, "record ID") for record_id in record_ids}
            if len(requested) != len(record_ids):
                raise ValueError("Duplicate record IDs in export selection.")
            if requested - {record["id"] for record in data["devices"]}:
                raise InventoryError("not_found")
            data["devices"] = [record for record in data["devices"] if record["id"] in requested]
        return {
            "content": export_data(format, data),
            "filename": (
                f"setup-code-manager-{'selected-' if selected else ''}"
                f"{datetime.now(UTC):%Y-%m-%d}.{format}"
            ),
            "mime": "application/json" if format == "json" else "text/csv;charset=utf-8",
            "count": len(data["devices"]),
            "scope": "selected" if selected else "all",
        }

    async def async_export_pdf(
        self, record_ids: list[str], include_notes: bool = False, language: str = "de"
    ) -> dict[str, Any]:
        """Render exact selected current records without changing stored data."""
        if (
            not isinstance(record_ids, list)
            or not 1 <= len(record_ids) <= MAX_PDF_RECORDS
            or type(include_notes) is not bool
            or language not in ("de", "en")
        ):
            raise ValueError("Invalid PDF selection or options")
        requested = [_identifier(record_id, "record ID") for record_id in record_ids]
        if len(set(requested)) != len(requested):
            raise ValueError("Duplicate PDF record IDs")
        async with self._pdf_lock:
            async with self._lock:
                if self._closing:
                    raise InventoryError("not_loaded")
                records = {record["id"]: record for record in self.store.devices}
                if any(record_id not in records for record_id in requested):
                    raise InventoryError("not_found")
                # Preserve the requested visible order and authoritative live HA
                # identity/manual Matter values. The executor never touches HA.
                snapshot = []
                for record_id in requested:
                    serialized = serialize_record(self.hass, records[record_id])
                    snapshot.append(
                        {
                            key: serialized[key]
                            for key in (
                                "name",
                                "location",
                                "manufacturer",
                                "model",
                                "serial_number",
                                "notes",
                                "codes",
                            )
                        }
                    )
            job = self.hass.async_add_executor_job(
                build_device_pdf, snapshot, language, include_notes
            )
            cancelled = False
            try:
                while True:
                    try:
                        document = await asyncio.shield(job)
                        break
                    except asyncio.CancelledError:
                        if job.cancelled():
                            raise
                        cancelled = True
            except DevicePDFError as err:
                raise InventoryError(err.code) from err
            except Exception as err:
                raise InventoryError("pdf_failed") from err
            if cancelled:
                raise asyncio.CancelledError
            if self._closing:
                raise InventoryError("not_loaded")
            if not isinstance(document, bytes) or not document.startswith(b"%PDF-"):
                raise InventoryError("pdf_failed")
            if len(document) > MAX_PDF_BYTES:
                raise InventoryError("pdf_too_large")
            return {
                "filename": f"setup-code-manager-device-cards-{datetime.now(UTC):%Y-%m-%d}.pdf",
                "mime": "application/pdf",
                "content": base64.b64encode(document).decode("ascii"),
                "encoding": "base64",
                "byte_length": len(document),
                "count": len(snapshot),
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
