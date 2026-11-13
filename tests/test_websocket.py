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
    "view_preferences": {},
    "save_view_preferences": {
        "preferences": {"views": [], "defaultViewId": ""},
        "expected_revision": 7,
    },
    "ha_devices": {},
    "sync": {},
    "save": {"record": {"name": "Test", "secret": SECRET}, "expected_revision": 7},
    "relink": {"record_id": "record-1", "ha_device_id": "device-1", "expected_revision": 7},
    "delete": {"record_id": "record-1", "expected_revision": 7},
    "archive": {"record_id": "record-1", "archived": True, "expected_revision": 7},
    "export": {"format": "json"},
    "pdf": {"record_ids": ["record-1"], "include_notes": False, "language": "en"},
    "preview_import": {"format": "json", "content": SECRET},
    "import": {"token": "preview-1", "decisions": {"record-1": "add"}, "expected_revision": 7},
}
MUTATING = ("save", "relink", "delete", "archive", "import", "save_view_preferences")


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
    manager.async_get_view_preferences.return_value = {
        "revision": 0,
        "views": [],
        "defaultViewId": "",
    }
    manager.async_save_view_preferences.return_value = {
        "revision": 8,
        "views": [],
        "defaultViewId": "",
    }
    manager.ha_devices.return_value = {"devices": []}
    manager.async_save.return_value = {"id": "record-1"}
    manager.async_relink.return_value = {"id": "record-1"}
    manager.async_sync.return_value = []
    manager.export.return_value = {"format": "json", "content": "{}"}
    manager.async_export_pdf.return_value = {
        "mime": "application/pdf",
        "content": "JVBERi0=",
        "encoding": "base64",
        "byte_length": 5,
        "count": 1,
    }
    manager.async_preview_import.return_value = {"token": "preview-1"}
    manager.async_import.return_value = {"added": 1}
    hass.data[DOMAIN] = manager
    websocket_api.async_register(hass)
    connections = []

    def connection(*, admin=True, authenticated=True, user_id="admin-1"):
        user = SimpleNamespace(id=user_id, name="Test", is_admin=admin) if authenticated else None
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


def test_all_handlers_have_distinct_registered_types():
    handlers = [
        websocket_api.ws_list,
        websocket_api.ws_view_preferences,
        websocket_api.ws_save_view_preferences,
        websocket_api.ws_ha_devices,
        websocket_api.ws_sync,
        websocket_api.ws_save,
        websocket_api.ws_relink,
        websocket_api.ws_delete,
        websocket_api.ws_archive,
        websocket_api.ws_export,
        websocket_api.ws_pdf,
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
        "view_preferences": ("async_get_view_preferences", ("admin-1",)),
        "save_view_preferences": (
            "async_save_view_preferences",
            ("admin-1", COMMANDS["save_view_preferences"]["preferences"], 7),
        ),
        "ha_devices": ("ha_devices", ()),
        "sync": ("async_sync", ()),
        "save": ("async_save", (COMMANDS["save"]["record"], 7)),
        "relink": ("async_relink", ("record-1", "device-1", 7)),
        "delete": ("async_delete", ("record-1", 7)),
        "archive": ("async_archive", ("record-1", True, 7)),
        "export": ("export", ("json",)),
        "pdf": ("async_export_pdf", (["record-1"], False, "en")),
        "preview_import": ("async_preview_import", ("json", SECRET, "admin-1")),
        "import": ("async_import", ("preview-1", 7, {"record-1": "add"}, "admin-1")),
    }
    method_name, args = expected[name]
    getattr(manager, method_name).assert_called_once_with(*args)
    if name.startswith("async_") or method_name.startswith("async_"):
        getattr(manager, method_name).assert_awaited_once()
    if name in ("archive", "delete"):
        assert conn.results[0][1] is None


@pytest.mark.parametrize("name", ["list", "view_preferences", "save_view_preferences"])
async def test_preference_account_comes_only_from_authenticated_connection(api, name):
    hass, manager, connection = api
    conn = connection(user_id="other-admin")
    await invoke(hass, conn, name)
    method = (
        manager.async_save_view_preferences
        if name == "save_view_preferences"
        else manager.async_get_view_preferences
    )
    assert method.await_args.args[0] == "other-admin"
    assert not conn.errors


@pytest.mark.parametrize("field", ["user_id", "userId", "scope", "owner"])
async def test_preference_write_schema_rejects_client_account_fields(api, field):
    hass, _, _ = api
    with pytest.raises(probatio.Invalid):
        command(hass, "save_view_preferences", **{field: "another-account"})


@pytest.mark.parametrize("name", ["list", "view_preferences"])
async def test_type_only_read_commands_ignore_payload_account_fields(api, name):
    hass, manager, connection = api
    conn = connection(user_id="authenticated-user")
    # HA deliberately skips schemas for type-only commands. The handler must
    # still use the connection account even when an untrusted field is present.
    handler, message = command(hass, name, user_id="another-account", scope="global")
    handler(hass, conn, message)
    await asyncio.wait_for(conn.completed, timeout=2)
    manager.async_get_view_preferences.assert_awaited_once_with("authenticated-user")
    assert not conn.errors


async def test_list_includes_only_own_preferences_and_keeps_inventory_on_preferences_failure(api):
    hass, manager, connection = api
    conn = connection()
    await invoke(hass, conn, "list")
    assert conn.results[0][1] == {
        "devices": [],
        "revision": 7,
        "view_preferences": {"revision": 0, "views": [], "defaultViewId": ""},
    }
    manager.list_data.return_value = {"devices": [{"id": "kept"}], "revision": 9}
    manager.async_get_view_preferences.side_effect = InventoryError("preferences_unavailable")
    failed = connection()
    await invoke(hass, failed, "list")
    assert not failed.errors
    assert failed.results[0][1] == {
        "devices": [{"id": "kept"}],
        "revision": 9,
        "view_preferences_error": "preferences_unavailable",
    }


async def test_list_takes_inventory_snapshot_after_waiting_for_preferences_lock(api):
    hass, manager, connection = api

    async def preferences_after_write(_user):
        await asyncio.sleep(0)
        manager.list_data.return_value = {"devices": [{"id": "newly-written"}], "revision": 8}
        return {"revision": 1, "views": [], "defaultViewId": ""}

    manager.async_get_view_preferences.side_effect = preferences_after_write
    conn = connection()
    await invoke(hass, conn, "list")
    assert conn.results[0][1]["devices"] == [{"id": "newly-written"}]
    assert conn.results[0][1]["revision"] == 8


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
        ("pdf", {"record_ids": "record-1"}),
        ("pdf", {"include_notes": "yes"}),
        ("pdf", {"language": "es"}),
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
        "view_preferences": "async_get_view_preferences",
        "save_view_preferences": "async_save_view_preferences",
        "ha_devices": "ha_devices",
        "sync": "async_sync",
        "save": "async_save",
        "relink": "async_relink",
        "delete": "async_delete",
        "archive": "async_archive",
        "export": "export",
        "pdf": "async_export_pdf",
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
