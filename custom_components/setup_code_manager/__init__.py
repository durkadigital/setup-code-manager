"""The Setup Code Manager integration."""

from __future__ import annotations

import asyncio
import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType

from .const import DOMAIN
from .manager import SetupCodesManager
from .panel import async_register_panel, async_register_static, async_unregister_panel
from .store import SetupCodesStore
from .websocket_api import async_register as async_register_websocket

_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

type SetupCodesConfigEntry = ConfigEntry


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    await async_register_static(hass)
    async_register_websocket(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: SetupCodesConfigEntry) -> bool:
    store = SetupCodesStore(hass)
    manager = SetupCodesManager(hass, store)
    await manager.async_setup()
    try:
        await async_register_panel(hass)
    except (Exception, asyncio.CancelledError):
        manager.async_unload()
        raise
    hass.data[DOMAIN] = manager

    entry.async_on_unload(entry.add_update_listener(_async_update_listener))
    entry.async_on_unload(manager.async_unload)

    @callback
    def clear_manager() -> None:
        # Unload callbacks must return None (or a coroutine). Returning pop's
        # manager value makes Home Assistant try to schedule it as a coroutine.
        hass.data.pop(DOMAIN, None)

    entry.async_on_unload(clear_manager)
    entry.async_on_unload(lambda: async_unregister_panel(hass))
    _LOGGER.debug("Setup Code Manager is set up")
    return True


async def _async_update_listener(hass: HomeAssistant, entry: SetupCodesConfigEntry) -> None:
    """Re-scan when protocol options change."""
    manager = hass.data.get(DOMAIN)
    if manager is not None:
        await manager.async_sync()


async def async_unload_entry(hass: HomeAssistant, entry: SetupCodesConfigEntry) -> bool:
    # Stop new API calls before draining already-started writes. A replacement
    # manager must not load the file until the old manager has finished with it.
    manager = hass.data.pop(DOMAIN, None)
    if manager is not None:
        await manager.async_shutdown()
    return True
