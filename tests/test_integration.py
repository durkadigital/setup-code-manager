"""Real HA config-entry lifecycle, panel registration and configuration flows."""

import asyncio
import posixpath
import re
import shutil
from pathlib import Path
from types import MappingProxyType, SimpleNamespace
from unittest.mock import AsyncMock, patch
from urllib.parse import urljoin

import pytest
from homeassistant.components import frontend
from homeassistant.config_entries import ConfigEntries, ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er

from custom_components import setup_code_manager as integration
from custom_components.setup_code_manager import panel
from custom_components.setup_code_manager.config_flow import SetupCodesConfigFlow
from custom_components.setup_code_manager.const import (
    CONF_SCAN_HOMEKIT,
    CONF_SCAN_MATTER,
    CONF_SCAN_ZWAVE,
    DOMAIN,
    PANEL_STATIC_URL_PATH,
    PANEL_URL_PATH,
)
from custom_components.setup_code_manager.inventory import new_record
from custom_components.setup_code_manager.manager import InventoryError, SetupCodesManager
from custom_components.setup_code_manager.preferences import STORAGE_KEY as PREFERENCES_STORAGE_KEY
from custom_components.setup_code_manager.store import SetupCodesStore


@pytest.fixture
async def hass(tmp_path):
    instance = HomeAssistant(str(tmp_path))
    instance.http = SimpleNamespace(async_register_static_paths=AsyncMock())
    instance.config_entries = ConfigEntries(instance, {})
    await instance.config_entries.async_initialize()
    await ar.async_load(instance)
    dr.async_setup(instance)
    await dr.async_load(instance)
    await er.async_load(instance)
    yield instance
    for entry in instance.config_entries.async_entries(DOMAIN):
        await entry._async_process_on_unload(instance)
    await instance.async_stop(force=True)


def add_entry(hass, options=None):
    entry = ConfigEntry(
        domain=DOMAIN,
        title="Setup Code Manager",
        data={},
        options=options or {},
        source="user",
        version=1,
        minor_version=1,
        unique_id=DOMAIN,
        discovery_keys=MappingProxyType({}),
        subentries_data=None,
    )
    hass.config_entries._entries[entry.entry_id] = entry
    return entry


async def test_setup_unload_and_reload_keep_data_and_clean_up_callbacks(hass):
    entry = add_entry(hass)
    assert await integration.async_setup_entry(hass, entry)
    manager = hass.data[DOMAIN]
    assert isinstance(manager, SetupCodesManager)
    assert frontend.async_panel_exists(hass, PANEL_URL_PATH)
    await manager.async_save(new_record("Survives reload"), manager.store.data["revision"])
    preferences = await manager.async_save_view_preferences(
        "user-a",
        {
            "views": [{"id": "home", "name": "Home", "settings": {"group": "room"}}],
            "defaultViewId": "home",
        },
        0,
    )
    before = manager.store.data
    assert entry.update_listeners

    assert await integration.async_unload_entry(hass, entry)
    # Exercise the real HA callback dispatcher, which rejects truthy non-coroutine
    # callback returns. A lambda returning hass.data.pop used to break this step.
    await entry._async_process_on_unload(hass)
    assert DOMAIN not in hass.data
    assert not frontend.async_panel_exists(hass, PANEL_URL_PATH)
    assert entry.update_listeners == []
    assert manager._unsubs == []
    assert manager._debouncer is None

    assert await integration.async_setup_entry(hass, entry)
    reloaded = hass.data[DOMAIN]
    assert reloaded is not manager
    assert reloaded.store.data == before
    assert await reloaded.async_get_view_preferences("user-a") == preferences
    assert (await reloaded.async_get_view_preferences("other-user"))["views"] == []
    assert frontend.async_panel_exists(hass, PANEL_URL_PATH)


async def test_corrupt_preferences_do_not_block_inventory_and_are_never_overwritten(hass):
    path = Path(hass.config.path(".storage", PREFERENCES_STORAGE_KEY))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("{SYNTHETIC_CORRUPTION")
    entry = add_entry(hass)
    assert await integration.async_setup_entry(hass, entry)
    manager = hass.data[DOMAIN]
    await manager.async_save(new_record("Inventory remains usable"), manager.store.data["revision"])
    assert len(manager.list_data()["devices"]) == 1
    with pytest.raises(InventoryError, match="preferences_unavailable"):
        await manager.async_get_view_preferences("user-a")
    with pytest.raises(InventoryError, match="preferences_unavailable"):
        await manager.async_save_view_preferences("user-a", {"views": [], "defaultViewId": ""}, 0)
    assert path.read_text() == "{SYNTHETIC_CORRUPTION"


async def test_panel_failure_releases_manager_listeners(hass):
    entry = add_entry(hass)
    manager = SetupCodesManager(hass, SetupCodesStore(hass))
    with (
        patch.object(integration, "SetupCodesManager", return_value=manager),
        patch.object(
            integration,
            "async_register_panel",
            AsyncMock(side_effect=RuntimeError("panel failure")),
        ),
    ):
        with pytest.raises(RuntimeError, match="panel failure"):
            await integration.async_setup_entry(hass, entry)
    assert DOMAIN not in hass.data
    assert manager._unsubs == []
    assert manager._debouncer is None


async def test_static_route_registered_once_and_can_retry_after_failure(hass):
    register = AsyncMock(side_effect=[RuntimeError("temporary failure"), None])
    hass.http = SimpleNamespace(async_register_static_paths=register)
    with pytest.raises(RuntimeError):
        await panel.async_register_static(hass)
    await panel.async_register_static(hass)
    await panel.async_register_static(hass)
    assert register.await_count == 2
    config = register.call_args.args[0][0]
    assert config.url_path == f"{PANEL_STATIC_URL_PATH}/{panel.static_asset_version()}"
    assert config.cache_headers is False
    assert await panel.async_register_static(hass) == config.url_path


async def test_panel_is_admin_only_and_uses_versioned_es_module(hass):
    await panel.async_register_panel(hass)
    registered = hass.data[frontend.DATA_PANELS][PANEL_URL_PATH]
    assert registered.require_admin is True
    custom = registered.config["_panel_custom"]
    assert custom["name"] == "setup-code-manager-panel"
    assert custom["module_url"] == f"{hass.data[panel._STATIC_MARKER]}/panel.js"
    assert not custom["embed_iframe"]
    assert not custom["trust_external"]
    # Re-registering a panel is safe when an integration is reloaded.
    await panel.async_register_panel(hass)
    panel.async_unregister_panel(hass)
    assert not frontend.async_panel_exists(hass, PANEL_URL_PATH)


def frontend_dependency_urls(entry_url, www):
    """Resolve the actual module imports and CSS URL like a browser would."""
    resolved = {}
    pending = [("panel.js", entry_url)]
    while pending:
        path, url = pending.pop()
        if path in resolved:
            continue
        resolved[path] = url
        if not path.endswith(".js"):
            continue
        source = (www / path).read_text()
        imports = re.findall(r"(?:from\s+|import\s+)[\"'](\.[^\"']+)[\"']", source)
        resources = re.findall(r"new URL\(\s*[\"'](\.[^\"']+)[\"']\s*,\s*import\.meta\.url", source)
        for relative in imports + resources:
            target = posixpath.normpath(posixpath.join(posixpath.dirname(path), relative))
            pending.append((target, urljoin(url, relative)))
    return resolved


async def test_nested_module_and_css_urls_change_when_only_a_translation_changes(hass, tmp_path):
    www = tmp_path / "assets"
    shutil.copytree(panel.WWW_DIR, www)
    register = AsyncMock()
    hass.http = SimpleNamespace(async_register_static_paths=register)
    with patch.object(panel, "WWW_DIR", www):
        await panel.async_register_static(hass)
        await panel.async_register_panel(hass)
        entry_url = hass.data[frontend.DATA_PANELS][PANEL_URL_PATH].config["_panel_custom"][
            "module_url"
        ]
        before = frontend_dependency_urls(entry_url, www)
        assert set(before) == {
            "panel.js",
            "panel.css",
            "filters.js",
            "preferences.js",
            "print.js",
            "i18n.js",
            "icons.js",
            "scanner.js",
            "qr.js",
            "vendor/jsQR.js",
        }
        # Simulate a second HA startup after an update which changes only i18n.
        translation = www / "i18n.js"
        translation.write_text(translation.read_text() + "\n// New translation fixture\n")
        hass.data.pop(panel._STATIC_MARKER)
        await panel.async_register_static(hass)
        await panel.async_register_panel(hass)
        next_url = hass.data[frontend.DATA_PANELS][PANEL_URL_PATH].config["_panel_custom"][
            "module_url"
        ]
        after = frontend_dependency_urls(next_url, www)
    assert before["panel.js"] != after["panel.js"]
    stale = [asset for asset in before if before[asset] == after[asset]]
    assert stale == [], f"Browser module cache still reuses these asset URLs: {stale}"
    first_route, second_route = [call.args[0][0].url_path for call in register.call_args_list]
    assert first_route != second_route
    assert all(url.startswith(first_route + "/") for url in before.values())
    assert all(url.startswith(second_route + "/") for url in after.values())


async def test_panel_reload_reuses_the_registered_bundle_url_without_rehashing(hass):
    registered_url = await panel.async_register_static(hass)
    with patch.object(
        panel, "static_asset_version", side_effect=AssertionError("unexpected rehash")
    ):
        await panel.async_register_panel(hass)
        first = hass.data[frontend.DATA_PANELS][PANEL_URL_PATH].config["_panel_custom"][
            "module_url"
        ]
        panel.async_unregister_panel(hass)
        await panel.async_register_panel(hass)
        second = hass.data[frontend.DATA_PANELS][PANEL_URL_PATH].config["_panel_custom"][
            "module_url"
        ]
    assert first == second == f"{registered_url}/panel.js"
    hass.http.async_register_static_paths.assert_awaited_once()


async def test_config_flow_defaults_and_single_instance(hass):
    flow = SetupCodesConfigFlow()
    flow.hass = hass
    flow.handler = DOMAIN
    flow.context = {"source": "user"}
    form = await flow.async_step_user()
    assert form["type"] == "form"
    assert form["data_schema"]({}) == {
        CONF_SCAN_MATTER: True,
        CONF_SCAN_HOMEKIT: True,
        CONF_SCAN_ZWAVE: True,
    }
    options = {CONF_SCAN_MATTER: True, CONF_SCAN_HOMEKIT: False, CONF_SCAN_ZWAVE: False}
    result = await flow.async_step_user(options)
    assert result["type"] == "create_entry"
    assert result["options"] == options
    assert result["data"] == {}
    add_entry(hass, options)
    duplicate = SetupCodesConfigFlow()
    duplicate.hass = hass
    duplicate.handler = DOMAIN
    duplicate.context = {"source": "user"}
    assert (await duplicate.async_step_user())["reason"] == "single_instance_allowed"


async def test_options_flow_uses_current_entry_and_returns_new_flags(hass):
    current = {CONF_SCAN_MATTER: True, CONF_SCAN_HOMEKIT: False, CONF_SCAN_ZWAVE: False}
    entry = add_entry(hass, current)
    flow = SetupCodesConfigFlow.async_get_options_flow(entry)
    flow.hass = hass
    flow.handler = entry.entry_id
    form = await flow.async_step_init()
    assert form["data_schema"]({}) == current
    changed = {CONF_SCAN_MATTER: False, CONF_SCAN_HOMEKIT: True, CONF_SCAN_ZWAVE: True}
    result = await flow.async_step_init(changed)
    assert result["type"] == "create_entry"
    assert result["data"] == changed


async def test_update_listener_rescans_without_replacing_manager(hass):
    entry = add_entry(hass)
    assert await integration.async_setup_entry(hass, entry)
    manager = hass.data[DOMAIN]
    with patch.object(manager, "async_sync", new_callable=AsyncMock) as sync:
        await integration._async_update_listener(hass, entry)
    sync.assert_awaited_once_with()
    assert hass.data[DOMAIN] is manager


async def test_unload_stops_new_requests_and_waits_for_manager_write_lock(hass):
    entry = add_entry(hass)
    assert await integration.async_setup_entry(hass, entry)
    manager = hass.data[DOMAIN]
    await manager._lock.acquire()
    task = asyncio.create_task(integration.async_unload_entry(hass, entry))
    try:
        await asyncio.sleep(0)
        assert DOMAIN not in hass.data
        assert not task.done()
        assert manager._unsubs == []
    finally:
        manager._lock.release()
    assert await task
    await entry._async_process_on_unload(hass)
    assert not frontend.async_panel_exists(hass, PANEL_URL_PATH)


async def test_cancelled_panel_setup_releases_manager_listeners(hass):
    entry = add_entry(hass)
    manager = SetupCodesManager(hass, SetupCodesStore(hass))
    with (
        patch.object(integration, "SetupCodesManager", return_value=manager),
        patch.object(
            integration,
            "async_register_panel",
            AsyncMock(side_effect=asyncio.CancelledError),
        ),
    ):
        with pytest.raises(asyncio.CancelledError):
            await integration.async_setup_entry(hass, entry)
    assert DOMAIN not in hass.data
    assert manager._unsubs == []
    assert manager._debouncer is None
