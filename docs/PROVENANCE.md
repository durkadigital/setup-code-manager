# Upstream provenance

Setup Code Manager is a planned derivative of
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
| Planned independent domain | `setup_code_manager` |

The full Git history and original LICENSE are retained. The original README is
preserved in [UPSTREAM_README.md](UPSTREAM_README.md). The bundled QR encoder
credits Project Nayuki and Anthony Fu; its license notices must remain.

At the concept stage, application files under `custom_components/setup_codes`,
the manifest and `hacs.json` still describe the original integration. The new
domain and features are proposals, not a released or installable new product.
Do not install this checkout alongside the original as if it already had a
separate domain. No new release or Marketplace catalog entry has been submitted.

## Technical naming check, 2026-11-07

- GitHub repository search `setup-code-manager in:name`: no exact matching repository name returned.
- `durkadigital/setup-code-manager`: repository API returned 404 before creation;
  GitHub subsequently confirmed availability and created the public fork.
- Home Assistant Core path `homeassistant/components/setup_code_manager`: not found.
- Current `hacs/default` integration catalog: no matching project name;
  checked blob `c51b0151ec4de09f2572e97ad64801a4a4805174`.

This is a technical collision check of those sources, not trademark clearance
or a claim that every unlisted custom integration has been searched.
