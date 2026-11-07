"""Live HA status, separate from durable inventory data."""

from copy import deepcopy
from typing import Any

from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er

from .const import ENABLED_PROTOCOLS
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


def serialize_record(hass: HomeAssistant, record: dict[str, Any]) -> dict[str, Any]:
    result = deepcopy(record)
    protocols = {code["protocol"] for code in record["codes"]}
    for link in result["links"]:
        device = dr.async_get(hass).async_get(link["ha_device_id"])
        active = device is not None and device.entry_type != dr.DeviceEntryType.SERVICE
        link.update(
            active=active,
            available=active and device_is_available(hass, device.id),
            name=(device.name_by_user or device.name or "") if active else "",
        )
        if active:
            protocols.update(device_protocols(device))
    result["linked"] = any(link["active"] for link in result["links"])
    result["available"] = any(link["available"] for link in result["links"])
    result["protocols"] = sorted(protocols)
    return result
