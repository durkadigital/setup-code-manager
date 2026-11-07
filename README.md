# Setup Code Manager

A planned Home Assistant tool to manage, scan and preserve device setup codes.

**Status: concept and repository setup. The proposed features are not implemented yet.**

This project builds on [PhantomPhoton/Setup-Codes](https://github.com/PhantomPhoton/Setup-Codes),
released under the MIT license. The upstream Git history, license and attribution
are retained. See [provenance](docs/PROVENANCE.md) and the
[original documentation](docs/UPSTREAM_README.md).

## Planned first version

- Keep device records independently of Home Assistant device registration.
- Scan Matter QR codes with a camera or read them from a photo locally.
- Preserve support for Matter, HomeKit and Z-Wave setup codes.
- Link devices to Home Assistant optionally, and archive records explicitly.
- Export and import versioned JSON backups and CSV tables with a preview.
- Migrate existing Setup Codes records and retain Home Assistant backup support.

## Concept documents

- [Project overview (German)](PROJECT.md)
- [Features and data concept (German)](docs/CONCEPT.de.md)
- [Screens and user flows (German)](docs/SCREENS.de.md)

The proposed integration domain is `setup_code_manager`. The inherited application
still uses `setup_codes`; the rename and data migration are part of future work.
This is not a release of the independent integration and should not be installed
alongside the original as if the domains were already separate.

Repository setup does not imply a Home Assistant Marketplace listing. A tested
release and a separate catalog submission are planned after implementation.

## Data and license

Real setup codes, Home Assistant configuration and personal exports do not belong
in this repository. Development examples must use synthetic data.

[MIT license](LICENSE). Original project: Copyright (c) 2026 PhantomPhoton.
Bundled third-party license notices remain applicable.
