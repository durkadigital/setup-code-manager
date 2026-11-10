"""Sidebar panel registration."""

from __future__ import annotations

import hashlib
from pathlib import Path

from homeassistant.components import frontend
from homeassistant.core import HomeAssistant

from .const import (
    PANEL_ICON,
    PANEL_STATIC_URL_PATH,
    PANEL_TITLE,
    PANEL_URL_PATH,
    VERSION,
)

WWW_DIR = Path(__file__).parent / "www"
_STATIC_MARKER = "setup_code_manager_static_registered"


def static_asset_version() -> str:
    """Return VERSION plus a content hash of the complete frontend bundle."""
    digest = hashlib.sha256()
    for asset in sorted(WWW_DIR.rglob("*")):
        if not asset.is_file():
            continue
        digest.update(str(asset.relative_to(WWW_DIR)).encode())
        digest.update(asset.read_bytes())
        digest.update(b"\0")
    return f"{VERSION}-{digest.hexdigest()[:8]}"


async def async_register_static(hass: HomeAssistant) -> str:
    """Serve www/ under one versioned base URL for the HA lifetime."""
    if registered_url := hass.data.get(_STATIC_MARKER):
        return registered_url
    from homeassistant.components.http import StaticPathConfig

    version = await hass.async_add_executor_job(static_asset_version)
    static_url = f"{PANEL_STATIC_URL_PATH}/{version}"
    await hass.http.async_register_static_paths(
        [StaticPathConfig(static_url, str(WWW_DIR), cache_headers=False)]
    )
    hass.data[_STATIC_MARKER] = static_url
    return static_url


async def async_register_panel(hass: HomeAssistant) -> None:
    """Add the sidebar item."""
    # Relative JS imports and CSS URLs inherit this versioned directory. A query
    # on panel.js alone does not invalidate the browser's nested module cache.
    static_url = await async_register_static(hass)
    if PANEL_URL_PATH in hass.data.get("frontend_panels", {}):
        frontend.async_remove_panel(hass, PANEL_URL_PATH)
    frontend.async_register_built_in_panel(
        hass,
        component_name="custom",
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        frontend_url_path=PANEL_URL_PATH,
        config={
            "_panel_custom": {
                "name": "setup-code-manager-panel",
                "embed_iframe": False,
                "trust_external": False,
                "handle_safe_area": True,
                "module_url": f"{static_url}/panel.js",
            }
        },
        require_admin=True,
    )


def async_unregister_panel(hass: HomeAssistant) -> None:
    frontend.async_remove_panel(hass, PANEL_URL_PATH)
