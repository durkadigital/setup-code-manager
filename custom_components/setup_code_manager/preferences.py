"""Private, account-scoped list preferences, separate from the code inventory."""

from __future__ import annotations

import asyncio
import json
import re
from copy import deepcopy
from pathlib import Path
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.util.file import write_utf8_file_atomic

STORAGE_KEY = "setup_code_manager_preferences"
STORAGE_VERSION = 1
MAX_VIEWS = 20
MAX_REVISION = 2**53 - 1  # Revisions round-trip through JavaScript Number exactly.
_ID = re.compile(r"[A-Za-z0-9_-]{1,80}\Z")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
_DEFAULTS = {
    "tab": "all",
    "protocol": "",
    "codeStatus": "all",
    "room": "",
    "floor": "",
    "label": "",
    "sort": "name-asc",
    "group": "none",
}
_CHOICES = {
    "tab": {"all", "linked", "unlinked", "archive"},
    "protocol": {"", "matter", "homekit", "zwave"},
    "codeStatus": {"all", "has", "missing"},
    "sort": {"name-asc", "name-desc", "room", "updated-desc", "missing-first"},
    "group": {"none", "room"},
}


def _identifier(value: Any) -> str:
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise ValueError("Invalid preference ID")
    return value


def validate_revision(value: Any) -> int:
    if type(value) is not int or not 0 <= value <= MAX_REVISION:
        raise ValueError("Invalid preference revision")
    return value


def validate_settings(value: Any) -> dict[str, str]:
    """Whitelist the same list choices as the frontend, without coercion."""
    if not isinstance(value, dict) or set(value) - _DEFAULTS.keys():
        raise ValueError("Invalid view settings")
    settings = {**_DEFAULTS, **value}
    for field, choices in _CHOICES.items():
        if not isinstance(settings[field], str) or settings[field] not in choices:
            raise ValueError("Invalid view choice")
    for field, prefix, limit in (
        ("room", "room:", 256),
        ("floor", "floor:", 1024),
        ("label", "label:", 1024),
    ):
        selection = settings[field]
        if not isinstance(selection, str) or _CONTROL.search(selection):
            raise ValueError("Invalid view selector")
        if selection in ("", "unassigned"):
            continue
        if (
            not selection.startswith(prefix)
            or not selection[len(prefix) :].strip()
            # JavaScript counts selector limits in UTF-16 code units.
            or len(selection.encode("utf-16-le")) // 2 > len(prefix) + limit
        ):
            raise ValueError("Invalid view selector")
    return settings


def validate_preferences(value: Any) -> dict[str, Any]:
    """Reject unsupported or sensitive fields instead of persisting them."""
    if not isinstance(value, dict) or set(value) != {"views", "defaultViewId"}:
        raise ValueError("Invalid view preferences")
    raw_views = value["views"]
    if not isinstance(raw_views, list) or len(raw_views) > MAX_VIEWS:
        raise ValueError("Invalid saved view count")
    views, ids = [], set()
    for raw in raw_views:
        if not isinstance(raw, dict) or set(raw) != {"id", "name", "settings"}:
            raise ValueError("Invalid saved view")
        view_id, name = _identifier(raw["id"]), raw["name"]
        if (
            view_id in ids
            or not isinstance(name, str)
            or _CONTROL.search(name)
            or not name.strip()
            or len(name) > 80
        ):
            raise ValueError("Invalid saved view name or ID")
        name.encode("utf-8")  # Reject lone surrogates before attempting a file write.
        ids.add(view_id)
        views.append(
            {
                "id": view_id,
                "name": " ".join(name.split()),
                "settings": validate_settings(raw["settings"]),
            }
        )
    default = value["defaultViewId"]
    if not isinstance(default, str) or (default and default not in ids):
        raise ValueError("Invalid default view")
    return {"views": views, "defaultViewId": default}


def _validate_account(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != {"revision", "views", "defaultViewId"}:
        raise ValueError("Invalid account preferences")
    return {
        "revision": validate_revision(value["revision"]),
        **validate_preferences({key: value[key] for key in ("views", "defaultViewId")}),
    }


def _validate_data(value: Any) -> dict[str, Any]:
    if (
        not isinstance(value, dict)
        or set(value) != {"users"}
        or not isinstance(value["users"], dict)
    ):
        raise ValueError("Invalid preferences store")
    return {
        "users": {
            _identifier(user): _validate_account(data) for user, data in value["users"].items()
        }
    }


class ViewPreferencesStore:
    """Atomic HA .storage envelope; failed/cancelled writes cannot lose state.

    As with the inventory store, use HA's public atomic-file helper so write
    failures reach callers rather than being swallowed by Store.async_save.
    The manager owns the read/modify/CAS lock and drains it during unload.
    """

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.path = Path(hass.config.path(".storage", STORAGE_KEY))
        self._data: dict[str, Any] = {"users": {}}
        self._write_lock = asyncio.Lock()

    def _read(self) -> dict[str, Any]:
        try:
            raw = self.path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return {"users": {}}
        envelope = json.loads(raw)
        if (
            not isinstance(envelope, dict)
            or set(envelope) != {"version", "minor_version", "key", "data"}
            or type(envelope["version"]) is not int
            or envelope["version"] != STORAGE_VERSION
            or type(envelope["minor_version"]) is not int
            or envelope["minor_version"] != 1
            or envelope["key"] != STORAGE_KEY
        ):
            raise ValueError("Unsupported preferences store")
        return _validate_data(envelope["data"])

    async def async_load(self) -> None:
        self._data = await self.hass.async_add_executor_job(self._read)

    def get(self, user_id: str) -> dict[str, Any]:
        user = _identifier(user_id)
        return deepcopy(
            self._data["users"].get(user, {"revision": 0, "views": [], "defaultViewId": ""})
        )

    @property
    def data(self) -> dict[str, Any]:
        return deepcopy(self._data)

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
        validated = _validate_data(candidate)
        async with self._write_lock:
            write_job = self.hass.async_add_executor_job(self._write, validated)
            cancelled = False
            while True:
                try:
                    await asyncio.shield(write_job)
                    break
                except asyncio.CancelledError:
                    if write_job.cancelled():
                        raise
                    cancelled = True
            self._data = validated
            if cancelled:
                raise asyncio.CancelledError
