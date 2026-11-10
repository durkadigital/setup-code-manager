"""Verify the real HA decorators, scheduling, schemas and event authorization."""

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import create_autospec

import probatio
import pytest
from homeassistant.components import websocket_api as ha_websocket
from homeassistant.components.websocket_api.commands import handle_subscribe_events
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import Unauthorized

from custom_components.setup_code_manager import websocket_api
from custom_components.setup_code_manager.const import DOMAIN, EVENT_UPDATED
from custom_components.setup_code_manager.manager import InventoryError, SetupCodesManager

SECRET = "SYNTHETIC_PRIVATE_SETUP_CODE_DO_NOT_LOG"
COMMANDS = {
    "list": {},
    "ha_devices": {},
    "sync": {},
    "save": {"record": {"name": "Test", "secret": SECRET}, "expected_revision": 7},
    "delete": {"record_id": "record-1", "expected_revision": 7},
    "archive": {"record_id": "record-1", "archived": True, "expected_revision": 7},
    "export": {"format": "json"},
    "preview_import": {"format": "json", "content": SECRET},
    "import": {"token": "preview-1", "decisions": {"record-1": "add"}, "expected_revision": 7},
}
MUTATING = ("save", "delete", "archive", "import")


class Connection:
    def __init__(self, user):
        self.user = user
        self.results = []
        self.errors = []
        self.messages = []
        self.unhandled = []
        self.subscriptions = {}
        self.completed = asyncio.get_running_loop().create_future()

    def _complete(self):
        if not self.completed.done():
            self.completed.set_result(None)

    def send_result(self, message_id, result=None):
        self.results.append((message_id, result))
        self._complete()

    def send_error(self, message_id, code, message):
        self.errors.append((message_id, code, message))
        self._complete()

    def send_message(self, message):
        self.messages.append(message)

    def async_handle_exception(self, msg, error):
        self.unhandled.append(error)
        self._complete()


@pytest.fixture
async def api(tmp_path):
    hass = HomeAssistant(str(tmp_path))
    manager = create_autospec(SetupCodesManager, instance=True)
    manager.list_data.return_value = {"devices": [], "revision": 7}
    manager.ha_devices.return_value = {"devices": []}
    manager.async_save.return_value = {"id": "record-1"}
    manager.async_sync.return_value = []
    manager.export.return_value = {"format": "json", "content": "{}"}
    manager.async_preview_import.return_value = {"token": "preview-1"}
    manager.async_import.return_value = {"added": 1}
    hass.data[DOMAIN] = manager
    websocket_api.async_register(hass)
    connections = []

    def connection(*, admin=True, authenticated=True):
        user = SimpleNamespace(id="admin-1", name="Test", is_admin=admin) if authenticated else None
        result = Connection(user)
        connections.append(result)
        return result

    yield hass, manager, connection
    for conn in connections:
        for unsubscribe in conn.subscriptions.values():
            unsubscribe()
    await hass.async_stop(force=True)


def command(hass, name, **overrides):
    handler, schema = hass.data[ha_websocket.DOMAIN][f"{DOMAIN}/{name}"]
    message = {"id": 42, "type": f"{DOMAIN}/{name}", **COMMANDS[name], **overrides}
    return handler, schema(message) if schema else message


async def invoke(hass, connection, name):
    handler, message = command(hass, name)
    # HA handlers are callbacks which schedule the wrapped async implementation.
    assert handler(hass, connection, message) is None
    await asyncio.wait_for(connection.completed, timeout=2)
    assert not connection.unhandled


def test_all_nine_handlers_have_distinct_registered_types():
    handlers = [
        websocket_api.ws_list,
        websocket_api.ws_ha_devices,
        websocket_api.ws_sync,
        websocket_api.ws_save,
        websocket_api.ws_delete,
        websocket_api.ws_archive,
        websocket_api.ws_export,
        websocket_api.ws_preview_import,
        websocket_api.ws_import,
    ]
    assert {handler._ws_command for handler in handlers} == {
        f"{DOMAIN}/{name}" for name in COMMANDS
    }


@pytest.mark.parametrize("name", COMMANDS)
async def test_admin_commands_schedule_and_respond_through_real_ha_decorators(api, name):
    hass, manager, connection = api
    conn = connection()
    await invoke(hass, conn, name)
    assert not conn.errors
    assert len(conn.results) == 1
    assert conn.results[0][0] == 42
    expected = {
        "list": ("list_data", ()),
        "ha_devices": ("ha_devices", ()),
        "sync": ("async_sync", ()),
        "save": ("async_save", (COMMANDS["save"]["record"], 7)),
        "delete": ("async_delete", ("record-1", 7)),
        "archive": ("async_archive", ("record-1", True, 7)),
        "export": ("export", ("json",)),
        "preview_import": ("async_preview_import", ("json", SECRET, "admin-1")),
        "import": ("async_import", ("preview-1", 7, {"record-1": "add"}, "admin-1")),
    }
    method_name, args = expected[name]
    getattr(manager, method_name).assert_called_once_with(*args)
    if name.startswith("async_") or method_name.startswith("async_"):
        getattr(manager, method_name).assert_awaited_once()
    if name in ("archive", "delete"):
        assert conn.results[0][1] is None


async def test_selected_export_ids_are_passed_through_admin_api(api):
    hass, manager, connection = api
    conn = connection()
    handler, message = command(hass, "export", record_ids=["one", "archived-two"])
    handler(hass, conn, message)
    await asyncio.wait_for(conn.completed, timeout=2)
    manager.export.assert_called_once_with("json", ["one", "archived-two"])
    assert not conn.errors and not conn.unhandled


@pytest.mark.parametrize("selection", [None, "one", [False], [1]])
async def test_export_selection_schema_rejects_wrong_shapes(api, selection):
    hass, _, _ = api
    with pytest.raises(probatio.Invalid):
        command(hass, "export", record_ids=selection)


async def test_selected_export_is_denied_to_non_admin_before_manager_access(api):
    hass, manager, connection = api
    conn = connection(admin=False)
    handler, message = command(hass, "export", record_ids=["one"])
    with pytest.raises(Unauthorized):
        handler(hass, conn, message)
    assert manager.mock_calls == []


@pytest.mark.parametrize("name", COMMANDS)
@pytest.mark.parametrize("authenticated", [True, False])
async def test_all_commands_reject_non_admin_before_loading_or_scheduling(api, name, authenticated):
    hass, manager, connection = api
    conn = connection(admin=False, authenticated=authenticated)
    handler, message = command(hass, name)
    with pytest.raises(Unauthorized):
        handler(hass, conn, message)
    assert manager.mock_calls == []
    assert not conn.completed.done()


@pytest.mark.parametrize("name", COMMANDS)
async def test_all_commands_report_not_loaded_without_manager(api, name):
    hass, manager, connection = api
    del hass.data[DOMAIN]
    conn = connection()
    await invoke(hass, conn, name)
    assert conn.errors == [(42, "not_loaded", "Setup Code Manager is not loaded")]
    assert not conn.results
    assert manager.mock_calls == []


@pytest.mark.parametrize("name", MUTATING)
async def test_mutations_require_an_explicit_revision(api, name):
    hass, _, _ = api
    _, schema = hass.data[ha_websocket.DOMAIN][f"{DOMAIN}/{name}"]
    message = {"id": 42, "type": f"{DOMAIN}/{name}", **COMMANDS[name]}
    del message["expected_revision"]
    with pytest.raises(probatio.Invalid):
        schema(message)


@pytest.mark.parametrize("name", MUTATING)
@pytest.mark.parametrize("revision", [True, False, -1, "7", 7.0, None])
async def test_revision_schema_rejects_coercion_and_boolean_aliases(api, name, revision):
    hass, _, _ = api
    with pytest.raises(probatio.Invalid):
        command(hass, name, expected_revision=revision)


@pytest.mark.parametrize(
    "name,overrides",
    [
        ("export", {"format": "xml"}),
        ("preview_import", {"content": 123}),
        ("save", {"record": []}),
        ("delete", {"record_id": 123}),
        ("archive", {"archived": "yes"}),
        ("import", {"decisions": {"record-1": "delete"}}),
    ],
)
async def test_command_schemas_reject_wrong_shapes(api, name, overrides):
    hass, _, _ = api
    with pytest.raises(probatio.Invalid):
        command(hass, name, **overrides)


@pytest.mark.parametrize(
    "error,expected",
    [
        (InventoryError("conflict"), "conflict"),
        (ValueError(SECRET), "validation_error"),
        (TypeError(SECRET), "validation_error"),
        (RuntimeError(SECRET), "internal_error"),
    ],
)
@pytest.mark.parametrize("name", COMMANDS)
async def test_errors_are_sanitized_before_ha_exception_handler(api, caplog, name, error, expected):
    hass, manager, connection = api
    method = {
        "list": "list_data",
        "ha_devices": "ha_devices",
        "sync": "async_sync",
        "save": "async_save",
        "delete": "async_delete",
        "archive": "async_archive",
        "export": "export",
        "preview_import": "async_preview_import",
        "import": "async_import",
    }[name]
    getattr(manager, method).side_effect = error
    conn = connection()
    await invoke(hass, conn, name)
    assert conn.errors[0][:2] == (42, expected)
    assert not conn.results
    assert SECRET not in repr(conn.errors)
    assert SECRET not in caplog.text


async def test_regular_users_cannot_subscribe_to_inventory_changes(api):
    hass, _, connection = api
    conn = connection(admin=False)
    with pytest.raises(Unauthorized):
        handle_subscribe_events(
            hass, conn, {"id": 10, "type": "subscribe_events", "event_type": EVENT_UPDATED}
        )
    assert not conn.subscriptions


async def test_inventory_event_has_no_codes_names_ids_or_other_record_data(api):
    hass, _, connection = api
    conn = connection()
    handle_subscribe_events(
        hass, conn, {"id": 10, "type": "subscribe_events", "event_type": EVENT_UPDATED}
    )
    manager = SetupCodesManager(
        hass, SimpleNamespace(data={"devices": [{"name": SECRET, "codes": [SECRET]}]})
    )
    manager._notify()
    await hass.async_block_till_done()
    assert len(conn.messages) == 1
    raw = conn.messages[0]
    event = json.loads(raw) if isinstance(raw, (str, bytes)) else raw
    assert event["event"]["data"] == {}
    assert event["event"]["event_type"] == EVENT_UPDATED
    assert SECRET not in repr(event)
