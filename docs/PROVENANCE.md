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

The integration uses `custom_components/setup_code_manager`,
its own domain, sidebar panel, WebSocket command prefix and storage key.
The two integrations keep separate inventories. The import accepts files
exported by Setup Code Manager in JSON or CSV. The development version also opens encrypted SCMB inventory files locally. Records migrated by earlier
versions retain their IDs and source references in the Manager inventory.

Releases are available from the [release page](https://github.com/durkadigital/setup-code-manager/releases).
The project is installable as a custom repository. HACS closed the
[default catalog submission](https://github.com/hacs/default/pull/13839#issuecomment-7142781275).
Installation, camera and backup/restore checks are documented in [TESTING.de.md](TESTING.de.md).

The local scanner additionally bundles jsqr@1.4.0 under Apache-2.0, with the
complete license, npm origin and SHA-256 checksums in
[www/vendor](../custom_components/setup_code_manager/www/vendor/README.md).
The original MIT license and QR encoder notices remain unchanged.

## PDF generation and fonts

PDF device cards use ReportLab **5.1.0**, pinned in the integration manifest and
installed as a Home Assistant dependency. Its three-clause BSD notice is copied
byte-for-byte from the installed PyPI distribution's
`reportlab-5.1.0.dist-info/licenses/LICENSE` into
[REPORTLAB.txt](../custom_components/setup_code_manager/licenses/REPORTLAB.txt).
The original copyright, conditions and disclaimer are retained.

The renderer uses the dependency's `Vera.ttf` and `VeraBd.ttf` font files and
embeds the required glyphs in PDFs. Their complete original Bitstream Vera
copyright and permission text, including the supplied FAQ, is copied byte-for-byte
from `reportlab/fonts/bitstream-vera-license.txt` into
[BITSTREAM_VERA.txt](../custom_components/setup_code_manager/licenses/BITSTREAM_VERA.txt).
No font or PDF service is contacted at runtime. The PDF renderer and the direct
download helper do not replace the MIT and Apache-2.0 notices above.

## Technical naming check, 2026-11-07

- GitHub repository search `setup-code-manager in:name`: no exact matching repository name returned.
- `durkadigital/setup-code-manager`: repository API returned 404 before creation;
  GitHub subsequently confirmed availability and created the public fork.
- Home Assistant Core path `homeassistant/components/setup_code_manager`: not found.
- Current `hacs/default` integration catalog: no matching project name;
  checked blob `c51b0151ec4de09f2572e97ad64801a4a4805174`.

This is a technical collision check of those sources, not trademark clearance
or a claim that every unlisted custom integration has been searched.


## Local OCR and backup libraries

The development version bundles the Tesseract.js recognition worker, a
WebAssembly core and an English trained model for printed Matter codes. It uses
Noble cryptography modules for backup processing where the browser does not
expose Web Crypto. Versions and licenses are tracked with the local assets.
[Bundled sources and notices](../custom_components/setup_code_manager/www/vendor/README.md)
