# Upstream provenance

Setup Code Manager is a derivative of
[PhantomPhoton/Setup-Codes](https://github.com/PhantomPhoton/Setup-Codes).

| Item | Value |
| --- | --- |
| Upstream branch | `main` |
| Imported commit | `5a9ab4a703482edbcb43276d6dae74351ca881cf` |
| Upstream release | `v1.1.11` |
| Upstream release date | 2026-10-24 |
| Local import date | 2026-11-07 |
| Public fork | [durkadigital/setup-code-manager](https://github.com/durkadigital/setup-code-manager) |
| Fork creation date | 2026-11-07 |
| License | MIT, Copyright (c) 2026 PhantomPhoton |
| Upstream integration domain | `setup_codes` |
| Independent domain | `setup_code_manager` |

The full Git history and original LICENSE are retained. The original README is
preserved in [UPSTREAM_README.md](UPSTREAM_README.md). The bundled QR encoder
credits Project Nayuki and Anthony Fu; its license notices must remain.

The first local development version uses `custom_components/setup_code_manager`,
its own domain, sidebar panel, WebSocket command prefix and storage key. The
original `.storage/setup_codes` file is read only when the user requests a
migration preview. The original integration can remain installed during that
comparison; the two inventories are independent after import.

There is no published release or Marketplace catalog submission yet. Actual
installation, camera and full backup/restore acceptance remain documented in
[TESTING.de.md](TESTING.de.md).

The local scanner additionally bundles jsqr@1.4.0 under Apache-2.0, with the
complete license, npm origin and SHA-256 checksums in
[www/vendor](../custom_components/setup_code_manager/www/vendor/README.md).
The original MIT license and QR encoder notices remain unchanged.

## Technical naming check, 2026-11-07

- GitHub repository search `setup-code-manager in:name`: no exact matching repository name returned.
- `durkadigital/setup-code-manager`: repository API returned 404 before creation;
  GitHub subsequently confirmed availability and created the public fork.
- Home Assistant Core path `homeassistant/components/setup_code_manager`: not found.
- Current `hacs/default` integration catalog: no matching project name;
  checked blob `c51b0151ec4de09f2572e97ad64801a4a4805174`.

This is a technical collision check of those sources, not trademark clearance
or a claim that every unlisted custom integration has been searched.
