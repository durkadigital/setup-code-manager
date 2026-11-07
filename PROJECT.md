# Setup Code Manager

Der Projektname wurde am 7. November 2026 festgelegt.

## Bezeichnungen

- Anzeigename: **Setup Code Manager** (bestätigt)
- GitHub-Repository-Name: `setup-code-manager`
- Geplante Home-Assistant-Integrationskennung: `setup_code_manager`
- Kurzbeschreibung: Geräte und Einrichtungscodes verwalten, scannen und sichern.

Die technische Namensprüfung vom 7. November 2026 fand keinen gleichnamigen
Eintrag im HACS-Katalog und keine Core-Integration mit dieser Kennung.
Die Repository-Suche ergab keinen exakten Namenstreffer. Das ist eine technische
Vorprüfung, keine Markenprüfung. Der öffentliche Fork wurde unter
[durkadigital/setup-code-manager](https://github.com/durkadigital/setup-code-manager)
angelegt.

## Projektstand

Konzeptphase vor der Implementierung. Die lokale Arbeitskopie basiert auf
[PhantomPhoton/Setup-Codes](https://github.com/PhantomPhoton/Setup-Codes),
Version 1.1.11, Commit `5a9ab4a703482edbcb43276d6dae74351ca881cf`.
Originalhistorie, Lizenz und Quellcode sind erhalten. Die Konzeptunterlagen liegen
im eigenen Repository auf `main`. Der lokale Branch `planning/setup-code-manager`
bewahrt den ursprünglichen Arbeitsstand. Die neue Integrationskennung ist noch
nicht im Anwendungscode umgesetzt.

Geplant sind QR-Scans, unabhängige Geräteeinträge, eine optionale Verknüpfung mit
Home Assistant, ein Archiv sowie CSV- und JSON-Import/Export. Die Unterstützung
regulärer Home-Assistant-Backups soll erhalten bleiben.

## Konzeptunterlagen

- [Funktions- und Datenkonzept](docs/CONCEPT.de.md)
- [Ansichten und Bedienabläufe](docs/SCREENS.de.md)
- [Herkunft und technischer Ausgangsstand](docs/PROVENANCE.md)

Die Unterlagen sind Vorschläge zur Durchsicht. Die Umsetzung beginnt nach
Abstimmung des Konzepts. Ein GitHub-Fork ist noch kein Release oder Store-Eintrag.
