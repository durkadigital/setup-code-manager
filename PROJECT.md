# Setup Code Manager

Der Projektname wurde am 7. November 2026 festgelegt.

## Bezeichnungen

- Anzeigename: **Setup Code Manager** (bestätigt)
- GitHub-Repository-Name: `setup-code-manager`
- Home-Assistant-Integrationskennung: `setup_code_manager`
- Kurzbeschreibung: Geräte und Einrichtungscodes verwalten, scannen und sichern.

Die technische Namensprüfung vom 7. November 2026 fand keinen gleichnamigen
Eintrag im HACS-Katalog und keine Core-Integration mit dieser Kennung.
Die Repository-Suche ergab keinen exakten Namenstreffer. Das ist eine technische
Vorprüfung, keine Markenprüfung. Der öffentliche Fork wurde unter
[durkadigital/setup-code-manager](https://github.com/durkadigital/setup-code-manager)
angelegt.

## Projektstand

Erste lokale Entwicklungsversion **0.1.0** auf Branch `feature/first-version`.
Die neue Integration liegt unter `custom_components/setup_code_manager` und hat
von der ursprünglichen Integration getrennte API-, Panel- und Speicherkennungen.
Grundlage bleibt [PhantomPhoton/Setup-Codes](https://github.com/PhantomPhoton/Setup-Codes),
Version 1.1.11, Commit `5a9ab4a703482edbcb43276d6dae74351ca881cf`.
Originalhistorie und Lizenz bleiben erhalten.

Umgesetzt sind lokale QR-Erkennung, ein unabhängiges Inventar, HA-Geräteauswahl
nach fehlendem Protokollcode, Archiv, versionierter CSV-/JSON-Austausch und eine
Vorschau zur Übernahme alter Daten. Die Integration schreibt atomar unter
`.storage/setup_code_manager`. Die lokale Oberflächenvorschau verwendet Beispieldaten.

[Prüfungen und offene praktische Abnahme](docs/TESTING.de.md) sowie
[Sicherung und Wiederherstellung](docs/BACKUP.de.md) trennen den lokalen Teststand
von einer tatsächlichen HA-Installation. Noch kein veröffentlichtes Release,
keine produktive Installation und keine HACS-Katalogaufnahme.

## Konzeptunterlagen

- [Funktions- und Datenkonzept](docs/CONCEPT.de.md)
- [Ansichten und Bedienabläufe](docs/SCREENS.de.md)
- [Herkunft und technischer Ausgangsstand](docs/PROVENANCE.md)
- [Visuelle Entwürfe](docs/design/README.md)

Die visuelle Gestaltungsrichtung und die ergänzte HA-Geräteauswahl wurden am
7. November 2026 bestätigt. Der ursprüngliche Konzeptstand bleibt als
Planungsgrundlage erhalten; den tatsächlichen Implementierungsumfang und bekannte
Grenzen beschreibt die [README](README.md).
