"""Loopback-only synthetic preview with the production PDF renderer.

Run `.venv/bin/python dev/serve_preview.py --port 8137`, then open `/dev/`.
This never bootstraps Home Assistant, reads an HA configuration, or installs
dependencies. Submitted PDF records stay in memory and request logs are disabled.
"""

from __future__ import annotations

import argparse
import base64
import importlib.util
import json
import sys
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import ModuleType
from urllib.parse import urlsplit

REPO = Path(__file__).resolve().parents[1]
MAX_BODY_BYTES = 4 * 1024 * 1024
MAX_PDF_BYTES = 8 * 1024 * 1024
REQUEST_TIMEOUT_SECONDS = 10


def load_renderer() -> ModuleType:
    """Import the standalone renderer without importing the HA integration."""
    path = REPO / "custom_components" / "setup_code_manager" / "device_pdf.py"
    spec = importlib.util.spec_from_file_location("setup_code_manager_preview_pdf", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("PDF renderer unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PreviewServer(ThreadingHTTPServer):
    """Serve only the local machine, with no request or exception diagnostics."""

    def __init__(self, port: int, renderer: ModuleType) -> None:
        self.renderer = renderer
        super().__init__(("127.0.0.1", port), PreviewHandler)

    def handle_error(self, _request, _client_address) -> None:
        """Never print request contents, source lines, or private exceptions."""


class PreviewHandler(SimpleHTTPRequestHandler):
    """Static repository files plus bounded, same-origin synthetic PDF requests."""

    server: PreviewServer

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, directory=str(REPO), **kwargs)

    def setup(self) -> None:
        super().setup()
        self.connection.settimeout(REQUEST_TIMEOUT_SECONDS)

    def log_message(self, _format, *_args) -> None:
        """Suppress paths, body values, and error diagnostics in request logs."""

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def _json(self, status: HTTPStatus, value: dict) -> None:
        payload = json.dumps(value, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
        self.close_connection = True
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Connection", "close")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(payload)

    def _error(self, status: HTTPStatus, code: str) -> None:
        self._json(status, {"error": {"code": code}})

    def send_error(self, code, message=None, explain=None) -> None:
        """Replace detailed default HTML errors with fixed, non-sensitive codes."""
        self._error(
            HTTPStatus(code), "not_found" if code == HTTPStatus.NOT_FOUND else "invalid_request"
        )

    def _allowed(self) -> bool:
        port = self.server.server_port
        hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
        host_headers = self.headers.get_all("Host", [])
        origins = self.headers.get_all("Origin", [])
        if len(host_headers) != 1 or host_headers[0] not in hosts:
            self._error(HTTPStatus.FORBIDDEN, "forbidden")
            return False
        # Browser requests must be same-origin. CLI requests may omit Origin.
        if origins and (len(origins) != 1 or origins[0] != f"http://{host_headers[0]}"):
            self._error(HTTPStatus.FORBIDDEN, "forbidden")
            return False
        return True

    def do_GET(self) -> None:  # noqa: N802 -- BaseHTTPRequestHandler hook.
        if self._allowed():
            super().do_GET()

    def do_HEAD(self) -> None:  # noqa: N802 -- BaseHTTPRequestHandler hook.
        if self._allowed():
            super().do_HEAD()

    def do_OPTIONS(self) -> None:  # noqa: N802 -- BaseHTTPRequestHandler hook.
        if self._allowed():
            self._error(HTTPStatus.METHOD_NOT_ALLOWED, "invalid_request")

    def do_POST(self) -> None:  # noqa: N802 -- BaseHTTPRequestHandler hook.
        if not self._allowed():
            return
        try:
            path = urlsplit(self.path).path
        except ValueError:
            self._error(HTTPStatus.BAD_REQUEST, "validation_error")
            return
        if path != "/dev/pdf":
            self._error(HTTPStatus.NOT_FOUND, "not_found")
            return
        lengths = self.headers.get_all("Content-Length", [])
        if self.headers.get_all("Transfer-Encoding"):
            self._error(HTTPStatus.BAD_REQUEST, "validation_error")
            return
        if not lengths:
            self._error(HTTPStatus.LENGTH_REQUIRED, "validation_error")
            return
        if len(lengths) != 1 or not lengths[0].isascii() or not lengths[0].isdigit():
            self._error(HTTPStatus.BAD_REQUEST, "validation_error")
            return
        if len(lengths[0]) > 8 or int(lengths[0]) > MAX_BODY_BYTES:
            self._error(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "pdf_too_large")
            return
        if self.headers.get_content_type() != "application/json":
            self._error(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "validation_error")
            return
        length = int(lengths[0])
        try:
            body = self.rfile.read(length)
            if len(body) != length:
                raise ValueError("Incomplete JSON request")
            value = json.loads(body)
            if (
                not isinstance(value, dict)
                or set(value) != {"records", "language", "include_notes"}
                or value["language"] not in ("de", "en")
                or type(value["include_notes"]) is not bool
                or not isinstance(value["records"], list)
                or not 1 <= len(value["records"]) <= 100
            ):
                raise ValueError("Invalid PDF request")
        except (ValueError, UnicodeError, RecursionError, TimeoutError):
            self._error(HTTPStatus.BAD_REQUEST, "validation_error")
            return
        try:
            document = self.server.renderer.build_device_pdf(
                value["records"], value["language"], value["include_notes"]
            )
            if not isinstance(document, bytes) or not document:
                raise RuntimeError("Invalid PDF output")
            if len(document) > MAX_PDF_BYTES:
                self._error(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "pdf_too_large")
                return
        except self.server.renderer.DevicePDFError as err:
            code = "pdf_too_large" if err.code == "pdf_too_large" else "pdf_failed"
            status = (
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE
                if code == "pdf_too_large"
                else HTTPStatus.INTERNAL_SERVER_ERROR
            )
            self._error(status, code)
            return
        except (ValueError, TypeError):
            self._error(HTTPStatus.BAD_REQUEST, "validation_error")
            return
        except Exception:
            self._error(HTTPStatus.INTERNAL_SERVER_ERROR, "pdf_failed")
            return
        self._json(
            HTTPStatus.OK,
            {
                "filename": "setup-code-manager-preview.pdf",
                "mime": "application/pdf",
                "encoding": "base64",
                "content": base64.b64encode(document).decode("ascii"),
                "byte_length": len(document),
                "count": len(value["records"]),
            },
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8137, help="Loopback port (default: 8137)")
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error("--port must be between 0 and 65535")
    sys.dont_write_bytecode = True
    try:
        renderer = load_renderer()
    except Exception:
        print(
            "PDF preview dependencies are unavailable. Use the project virtual environment.",
            file=sys.stderr,
        )
        return 1
    try:
        with PreviewServer(args.port, renderer) as server:
            print(f"Synthetic preview: http://127.0.0.1:{server.server_port}/dev/", flush=True)
            try:
                server.serve_forever()
            except KeyboardInterrupt:
                pass
    except OSError:
        print("The loopback preview server could not start.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
