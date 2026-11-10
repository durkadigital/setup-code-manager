"""Live HA status, separate from durable inventory data."""

from copy import deepcopy
from typing import Any

from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er

from .const import ENABLED_PROTOCOLS
from .matter_code import manual_pairing_code_from_mt
from .protocols import identifiers_for_protocol


def device_is_available(hass: HomeAssistant, device_id: str) -> bool:
    entries = er.async_entries_for_device(
        er.async_get(hass), device_id, include_disabled_entities=False
    )
    return any(
        (state := hass.states.get(entry.entity_id)) is not None
        and state.state not in (STATE_UNAVAILABLE, STATE_UNKNOWN)
        for entry in entries
    )


def device_protocols(device: dr.DeviceEntry) -> list[str]:
    return [p for p in ENABLED_PROTOCOLS if identifiers_for_protocol(p, device.identifiers)]


def device_identity(hass: HomeAssistant, device: dr.DeviceEntry) -> dict[str, str]:
    """Return bounded display identity from HA, including an explicitly empty room."""
    area = ar.async_get(hass).async_get_area(device.area_id) if device.area_id else None
    return {
        "name": ((device.name_by_user or device.name or "Gerät").strip() or "Gerät")[:256],
        "location": area.name.strip()[:256] if area else "",
    }


def linked_identity(hass: HomeAssistant, links: Any) -> dict[str, str] | None:
    """Combine active HA identities without assigning an implicit primary link.

    Save calls this before strict input validation; malformed links are ignored
    here and still rejected by the inventory validator, never repaired.
    """
    if not isinstance(links, list):
        return None
    registry = dr.async_get(hass)
    identities = []
    for link in links:
        if not isinstance(link, dict) or not isinstance(link.get("ha_device_id"), str):
            continue
        device = registry.async_get(link["ha_device_id"])
        if device is not None and device.entry_type != dr.DeviceEntryType.SERVICE:
            identities.append(device_identity(hass, device))
    if not identities:
        return None
    return {
        field: " / ".join(
            sorted(
                {item[field] for item in identities if item[field]},
                key=lambda name: (name.casefold(), name),
            )
        )[:256]
        for field in ("name", "location")
    }


def serialize_record(hass: HomeAssistant, record: dict[str, Any]) -> dict[str, Any]:
    result = deepcopy(record)
    result.update(linked_identity(hass, result["links"]) or {})
    for code in result["codes"]:
        if code["protocol"] == "matter" and code["value"].startswith("MT:"):
            if manual_value := manual_pairing_code_from_mt(code["value"]):
                code["manual_value"] = manual_value
    protocols = {code["protocol"] for code in record["codes"]}
    for link in result["links"]:
        device = dr.async_get(hass).async_get(link["ha_device_id"])
        active = device is not None and device.entry_type != dr.DeviceEntryType.SERVICE
        link.update(
            active=active,
            available=active and device_is_available(hass, device.id),
            **(device_identity(hass, device) if active else {"name": "", "location": ""}),
        )
        if active:
            protocols.update(device_protocols(device))
    result["linked"] = any(link["active"] for link in result["links"])
    result["available"] = any(link["available"] for link in result["links"])
    result["protocols"] = sorted(protocols)
    return result
