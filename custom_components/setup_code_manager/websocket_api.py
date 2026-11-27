"""Administrator-only API. Submitted codes never appear in errors or events."""

from functools import wraps
from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN
from .manager import InventoryError, SetupCodesManager


def _endpoint(name: str, fields: dict | None = None):
    """Apply HA authorization, schema validation and safe error handling uniformly."""

    def decorate(handler):
        @websocket_api.websocket_command(
            {vol.Required("type"): f"{DOMAIN}/{name}", **(fields or {})}
        )
        @websocket_api.require_admin
        @websocket_api.async_response
        @wraps(handler)
        async def wrapped(hass, connection, msg):
            manager = hass.data.get(DOMAIN)
            if not isinstance(manager, SetupCodesManager):
                connection.send_error(msg["id"], "not_loaded", "Setup Code Manager is not loaded")
                return
            try:
                result = await handler(manager, connection, msg)
            except InventoryError as err:
                connection.send_error(msg["id"], err.code, err.code)
            except (ValueError, TypeError):
                connection.send_error(msg["id"], "validation_error", "Invalid inventory data")
            except Exception:
                # HA's generic exception handler may log exception messages.
                # Never send submitted codes or import contents through it.
                connection.send_error(msg["id"], "internal_error", "Request could not be completed")
            else:
                connection.send_result(msg["id"], result)

        return wrapped

    return decorate


def _revision(value: Any) -> int:
    """Do not accept booleans as revisions despite Python's bool/int relation."""
    if type(value) is not int or value < 0:
        raise vol.Invalid("expected a non-negative integer revision")
    return value


_REVISION = {vol.Required("expected_revision"): _revision}


@_endpoint("list")
async def ws_list(manager, connection, msg):
    try:
        preferences = await manager.async_get_view_preferences(connection.user.id)
    except InventoryError as err:
        # Preferences are independent from the valuable code inventory.
        result = manager.list_data()
        result["view_preferences_error"] = err.code
    else:
        # The preference read may wait for a pending manager write. Take the
        # inventory snapshot afterwards, so it includes that completed write.
        result = manager.list_data()
        result["view_preferences"] = preferences
    return result


@_endpoint(
    "read_record", {vol.Required("record_id"): str, vol.Optional("code_id"): str, **_REVISION}
)
async def ws_read_record(manager, connection, msg):
    return manager.read_record(msg["record_id"], msg["expected_revision"], msg.get("code_id"))


@_endpoint("search", {vol.Required("query"): vol.All(str, vol.Length(min=1, max=1024))})
async def ws_search(manager, connection, msg):
    return manager.search(msg["query"])


@_endpoint(
    "duplicates",
    {
        vol.Required("record_id"): str,
        vol.Required("codes"): vol.All(
            [{vol.Required("protocol"): str, vol.Required("value"): str}], vol.Length(max=3)
        ),
    },
)
async def ws_duplicates(manager, connection, msg):
    return manager.duplicate_records(msg["record_id"], msg["codes"])


@_endpoint("view_preferences")
async def ws_view_preferences(manager, connection, msg):
    return await manager.async_get_view_preferences(connection.user.id)


@_endpoint("save_view_preferences", {vol.Required("preferences"): dict, **_REVISION})
async def ws_save_view_preferences(manager, connection, msg):
    return await manager.async_save_view_preferences(
        connection.user.id, msg["preferences"], msg["expected_revision"]
    )


@_endpoint("ha_devices")
async def ws_ha_devices(manager, connection, msg):
    return manager.ha_devices()


@_endpoint("sync")
async def ws_sync(manager, connection, msg):
    await manager.async_sync()
    return manager.list_data()


@_endpoint("save", {vol.Required("record"): dict, vol.Optional("codes_loaded"): bool, **_REVISION})
async def ws_save(manager, connection, msg):
    result = await manager.async_save(
        msg["record"], msg["expected_revision"], protect_hidden=not msg.get("codes_loaded", False)
    )
    return {"id": result["id"]}


@_endpoint(
    "relink",
    {vol.Required("record_id"): str, vol.Required("ha_device_id"): str, **_REVISION},
)
async def ws_relink(manager, connection, msg):
    result = await manager.async_relink(
        msg["record_id"], msg["ha_device_id"], msg["expected_revision"]
    )
    return {key: value for key, value in result.items() if key != "codes"}


@_endpoint("delete", {vol.Required("record_id"): str, **_REVISION})
async def ws_delete(manager, connection, msg):
    await manager.async_delete(msg["record_id"], msg["expected_revision"])


@_endpoint("archive", {vol.Required("record_id"): str, vol.Required("archived"): bool, **_REVISION})
async def ws_archive(manager, connection, msg):
    await manager.async_archive(msg["record_id"], msg["archived"], msg["expected_revision"])


@_endpoint(
    "export",
    {vol.Required("format"): vol.In(("json", "csv")), vol.Optional("record_ids"): [str]},
)
async def ws_export(manager, connection, msg):
    if "record_ids" in msg:
        return manager.export(msg["format"], msg["record_ids"])
    return manager.export(msg["format"])


@_endpoint(
    "pdf",
    {
        vol.Required("record_ids"): [str],
        vol.Optional("include_notes", default=False): bool,
        vol.Optional("language", default="en"): vol.In(("de", "en")),
    },
)
async def ws_pdf(manager, connection, msg):
    return await manager.async_export_pdf(msg["record_ids"], msg["include_notes"], msg["language"])


@_endpoint(
    "preview_import",
    {
        vol.Required("format"): vol.In(("json", "csv")),
        vol.Required("content"): str,
    },
)
async def ws_preview_import(manager, connection, msg):
    return await manager.async_preview_import(msg["format"], msg["content"], connection.user.id)


@_endpoint(
    "preview_code",
    {
        vol.Required("token"): str,
        vol.Required("key"): str,
        vol.Required("side"): vol.In(("existing", "incoming")),
        vol.Required("code_id"): str,
    },
)
async def ws_preview_code(manager, connection, msg):
    return manager.read_preview_code(
        msg["token"], connection.user.id, msg["key"], msg["side"], msg["code_id"]
    )


@_endpoint(
    "import",
    {
        vol.Required("token"): str,
        vol.Required("decisions"): {str: vol.In(("add", "skip", "replace"))},
        **_REVISION,
    },
)
async def ws_import(manager, connection, msg):
    return await manager.async_import(
        msg["token"], msg["expected_revision"], msg["decisions"], connection.user.id
    )


@callback
def async_register(hass: HomeAssistant) -> None:
    for command in (
        ws_list,
        ws_read_record,
        ws_search,
        ws_duplicates,
        ws_view_preferences,
        ws_save_view_preferences,
        ws_ha_devices,
        ws_sync,
        ws_save,
        ws_relink,
        ws_delete,
        ws_archive,
        ws_export,
        ws_pdf,
        ws_preview_import,
        ws_preview_code,
        ws_import,
    ):
        websocket_api.async_register_command(hass, command)
