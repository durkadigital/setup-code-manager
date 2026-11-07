"""Opt-in HA Core runtime smoke test using only disposable synthetic data.

Install requirements-runtime-test.txt, then run `.venv/bin/python dev/smoke_ha.py`.
This starts the real HA bootstrap and HTTP/WebSocket stack on 127.0.0.1, using
an automatically allocated port and a temporary configuration directory. It
never opens a user's HA configuration or installs missing packages at runtime.
The JSON report contains outcomes, versions and a source hash, never credentials.
This is intentionally outside the normal pytest suite: a minimal HA Python
installation lacks unrelated optional bootstrap-platform dependencies.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import logging
import os
import re
import socket
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from importlib.metadata import version
from pathlib import Path

sys.dont_write_bytecode = True

import aiohttp  # noqa: E402
from homeassistant import bootstrap  # noqa: E402
from homeassistant.auth.const import GROUP_ID_ADMIN, GROUP_ID_USER  # noqa: E402
from homeassistant.config_entries import ConfigEntryState  # noqa: E402
from homeassistant.runner import RuntimeConfig  # noqa: E402
from homeassistant.setup import async_setup_component  # noqa: E402

DOMAIN = "setup_code_manager"
REPO = Path(__file__).resolve().parents[1]


class RuntimeEvidence(logging.Handler):
    """Collect only component names and counts, never raw log messages."""

    def __init__(self) -> None:
        super().__init__(logging.ERROR)
        self.failed_components: set[str] = set()
        self.integration_errors = 0

    def emit(self, record: logging.LogRecord) -> None:
        if record.name == "homeassistant.setup":
            match = re.search(r"Setup failed for '([a-z_]+)'", record.getMessage())
            if match:
                self.failed_components.add(match[1])
        if record.name.startswith(f"custom_components.{DOMAIN}"):
            self.integration_errors += 1


def source_hash() -> str:
    digest = hashlib.sha256()
    directory = REPO / "custom_components" / DOMAIN
    for asset in sorted(directory.rglob("*")):
        if not asset.is_file() or "__pycache__" in asset.parts or asset.suffix == ".pyc":
            continue
        digest.update(str(asset.relative_to(directory)).encode())
        digest.update(b"\0")
        digest.update(asset.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


async def smoke(directory: str, results: dict, evidence: RuntimeEvidence) -> None:
    path = Path(directory)
    (path / "custom_components").mkdir()
    (path / "custom_components" / DOMAIN).symlink_to(
        REPO / "custom_components" / DOMAIN, target_is_directory=True
    )
    with socket.socket() as reserve:
        reserve.bind(("127.0.0.1", 0))
        port = reserve.getsockname()[1]
    results["port"] = port
    config = {
        "homeassistant": {
            "name": "Disposable Runtime Test",
            "latitude": 0,
            "longitude": 0,
            "elevation": 0,
            "unit_system": "metric",
            "time_zone": "UTC",
        },
        "http": {"server_host": ["127.0.0.1"], "server_port": port},
        "frontend": {},
    }
    (path / "configuration.yaml").write_text(json.dumps(config), encoding="utf-8")
    hass = None
    try:
        results["stage"] = "bootstrap"
        async with asyncio.timeout(90):
            hass = await bootstrap.async_setup_hass(
                RuntimeConfig(
                    config_dir=directory,
                    skip_pip=True,
                    log_file=str(path / "runtime.log"),
                    log_no_color=True,
                )
            )
            # Bootstrap initializes logging; attach the collector again if needed.
            if evidence not in logging.getLogger().handlers:
                logging.getLogger().addHandler(evidence)
            assert hass is not None and not hass.config.recovery_mode
            assert hass.config.api.host == "127.0.0.1"
            assert await async_setup_component(hass, DOMAIN, config)
            results["checks"]["normal_component_setup"] = True
            results["checks"]["http_frontend_api_loaded"] = all(
                domain in hass.config.components for domain in ("http", "frontend", "api")
            )
            assert results["checks"]["http_frontend_api_loaded"]
            results["stage"] = "config_flow"
            flow = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
            assert flow["type"] == "form"
            result = await hass.config_entries.flow.async_configure(
                flow["flow_id"],
                {
                    "scan_matter": True,
                    "scan_homekit": True,
                    "scan_zwave": True,
                },
            )
            assert result["type"] == "create_entry"
            entry = result["result"]
            await hass.async_block_till_done()
            assert entry.state is ConfigEntryState.LOADED
            await hass.async_start()
            results["checks"]["config_flow_entry_loaded"] = True

            # These users and access tokens exist only in this temporary instance.
            users = []
            for name, group in [("Smoke Admin", GROUP_ID_ADMIN), ("Smoke Regular", GROUP_ID_USER)]:
                user = await hass.auth.async_create_user(name, group_ids=[group], local_only=True)
                refresh = await hass.auth.async_create_refresh_token(
                    user, client_id="http://127.0.0.1/runtime-smoke"
                )
                users.append(
                    (user, hass.auth.async_create_access_token(refresh, remote_ip="127.0.0.1"))
                )
            assert users[0][0].is_admin and not users[1][0].is_admin
            base = f"http://127.0.0.1:{port}"
            results["stage"] = "http"
            async with aiohttp.ClientSession() as client:
                async with client.get(base + "/api/") as response:
                    assert response.status == 401
                results["checks"]["anonymous_api_denied"] = True
                assert hass.data["frontend_panels"][DOMAIN].require_admin is True
                results["checks"]["panel_requires_admin"] = True
                assets = [
                    "panel.js",
                    "panel.css",
                    "scanner.js",
                    "i18n.js",
                    "icons.js",
                    "vendor/jsQR.js",
                    "qr.js",
                ]
                for asset in assets:
                    async with client.get(base + "/setup_code_manager_static/" + asset) as response:
                        assert response.status == 200 and await response.read()
                results["checks"]["static_assets_http_200"] = assets
                results["stage"] = "websocket"
                for user, access_token in users:
                    async with client.ws_connect(base + "/api/websocket") as ws:
                        assert (await ws.receive_json())["type"] == "auth_required"
                        await ws.send_json({"type": "auth", "access_token": access_token})
                        assert (await ws.receive_json())["type"] == "auth_ok"
                        await ws.send_json({"id": 1, "type": DOMAIN + "/list"})
                        listing = await ws.receive_json()
                        if not user.is_admin:
                            assert listing["success"] is False
                            assert listing["error"]["code"] == "unauthorized"
                            results["checks"]["regular_user_api_denied"] = True
                            continue
                        assert listing["success"] and listing["result"]["devices"] == []
                        await ws.send_json(
                            {
                                "id": 2,
                                "type": DOMAIN + "/save",
                                "expected_revision": listing["result"]["revision"],
                                "record": {
                                    "name": "Synthetic runtime record",
                                    "links": [],
                                    "codes": [
                                        {
                                            "id": "test-code",
                                            "protocol": "homekit",
                                            "value": "03145154",
                                            "label": "Synthetic",
                                        }
                                    ],
                                },
                            }
                        )
                        saved = await ws.receive_json()
                        assert saved["success"]
                        assert saved["result"]["codes"][0]["value"] == "03145154"
                        await ws.send_json({"id": 3, "type": DOMAIN + "/export", "format": "json"})
                        exported = await ws.receive_json()
                        assert exported["success"]
                        assert len(json.loads(exported["result"]["content"])["devices"]) == 1
                        results["checks"]["admin_save_and_export"] = True
            users.clear()
            results["stage"] = "reload"
            assert await hass.config_entries.async_unload(entry.entry_id)
            assert DOMAIN not in hass.data
            assert await hass.config_entries.async_setup(entry.entry_id)
            assert entry.state is ConfigEntryState.LOADED
            assert len(hass.data[DOMAIN].list_data()["devices"]) == 1
            results["checks"]["unload_reload_preserves_record"] = True
            second_flow = await hass.config_entries.flow.async_init(
                DOMAIN, context={"source": "user"}
            )
            assert second_flow["type"] == "abort"
            results["checks"]["single_instance_guard"] = True
            assert evidence.integration_errors == 0
            results["status"] = "passed"
            results["stage"] = "completed"
    finally:
        if hass is not None:
            async with asyncio.timeout(30):
                await hass.async_stop(force=True)
        results["checks"]["runtime_stopped"] = True


def finish(
    directory: tempfile.TemporaryDirectory, output: Path, results: dict, evidence: RuntimeEvidence
) -> None:
    """Clean up and write evidence outside HA's event-loop thread."""
    directory.cleanup()
    results["checks"]["temporary_config_removed"] = not Path(directory.name).exists()
    if port := results.pop("port", None):
        with socket.socket() as probe:
            probe.settimeout(0.5)
            results["checks"]["loopback_port_closed"] = probe.connect_ex(("127.0.0.1", port)) != 0
    results["unrelated_bootstrap_failures"] = sorted(evidence.failed_components - {DOMAIN})
    results["integration_error_log_count"] = evidence.integration_errors
    results["source_unchanged_during_test"] = results["source_sha256"] == source_hash()
    if (
        not results["checks"].get("runtime_stopped", False)
        or not results["checks"]["temporary_config_removed"]
        or not results["checks"].get("loopback_port_closed", True)
        or not results["source_unchanged_during_test"]
        or evidence.integration_errors
    ):
        results["status"] = "failed"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(results, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, default=REPO / "dist" / "runtime-smoke.json")
    args = parser.parse_args()
    if not __debug__:
        parser.error("Run without -O or PYTHONOPTIMIZE: this test requires assertions.")
    for key in ("SUPERVISOR_CORE_API_SOCKET", "SUPERVISOR_TOKEN", "HASSIO_TOKEN"):
        os.environ.pop(key, None)
    evidence = RuntimeEvidence()
    logging.getLogger().addHandler(evidence)
    results = {
        "status": "failed",
        "stage": "initializing",
        "checks": {},
        "tested_at_utc": datetime.now(UTC).isoformat(),
        "homeassistant": version("homeassistant"),
        "frontend": version("home-assistant-frontend"),
        "python": sys.version.split()[0],
        "platform": sys.platform,
        "source_sha256": source_hash(),
        "bind_host": "127.0.0.1",
        "scope": "Isolated local HA Core with synthetic data; no HA OS, real devices, camera, or full restore tested.",
        "runtime_package_installation": False,
    }
    directory = tempfile.TemporaryDirectory(prefix="scm-ha-smoke-")
    try:
        asyncio.run(smoke(directory.name, results, evidence))
    except Exception as error:
        # Exception text may contain request data. Persist only its class and stage.
        results["status"] = "failed"
        results["failure_type"] = type(error).__name__
    finally:
        with ThreadPoolExecutor(max_workers=1) as executor:
            executor.submit(finish, directory, args.report, results, evidence).result()
    print(
        json.dumps(
            {"status": results["status"], "stage": results["stage"], "report": str(args.report)}
        )
    )
    return 0 if results["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
