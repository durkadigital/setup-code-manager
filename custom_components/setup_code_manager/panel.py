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
    """Return VERSION plus a short hash of the served JS so browsers refetch it."""
    digest = hashlib.sha256()
    for asset in sorted(WWW_DIR.rglob("*")):
        if not asset.is_file():
            continue
        digest.update(str(asset.relative_to(WWW_DIR)).encode())
        digest.update(asset.read_bytes())
        digest.update(b"\0")
    return f"{VERSION}-{digest.hexdigest()[:8]}"


async def async_register_static(hass: HomeAssistant) -> None:
    """Serve www/ once for the HA lifetime."""
    if hass.data.get(_STATIC_MARKER):
        return
    from homeassistant.components.http import StaticPathConfig

    await hass.http.async_register_static_paths(
        [StaticPathConfig(PANEL_STATIC_URL_PATH, str(WWW_DIR), cache_headers=False)]
    )
    hass.data[_STATIC_MARKER] = True


async def async_register_panel(hass: HomeAssistant) -> None:
    """Add the sidebar item."""
    version = await hass.async_add_executor_job(static_asset_version)
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
                "module_url": f"{PANEL_STATIC_URL_PATH}/panel.js?v={version}",
            }
        },
        require_admin=True,
    )


def async_unregister_panel(hass: HomeAssistant) -> None:
    frontend.async_remove_panel(hass, PANEL_URL_PATH)
