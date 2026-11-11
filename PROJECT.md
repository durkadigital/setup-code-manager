# Setup Code Manager: Projekt und Entwicklung

Setup Code Manager ist eine benutzerdefinierte Home-Assistant-Integration für ein
lokales Inventar von Geräten und Einrichtungscodes. Funktionen, Installation und
praktische Grenzen stehen in der [README](README.md).

## Projektidentität

| Bezeichnung | Wert |
| --- | --- |
| Anzeigename | Setup Code Manager |
| Repository | [durkadigital/setup-code-manager](https://github.com/durkadigital/setup-code-manager) |
| Integrationskennung | `setup_code_manager` |
| Integrationsordner | `custom_components/setup_code_manager` |
| Speicherdatei | `.storage/setup_code_manager` im HA-Konfigurationsordner |
| Kontoeinstellungen | `.storage/setup_code_manager_preferences` im HA-Konfigurationsordner |
| Aktuelle Vorabversion | `0.1.0b12` |
| Mindestversion | Home Assistant `2026.11.0` |

Grundlage ist [PhantomPhoton/Setup-Codes](https://github.com/PhantomPhoton/Setup-Codes),
Version 1.1.11, Commit `5a9ab4a703482edbcb43276d6dae74351ca881cf`.
Originalhistorie und MIT-Lizenz bleiben erhalten. Die neue Integration besitzt
eigene API-, Panel- und Speicherkennungen. Details zu Herkunft und Drittanbieter-
Lizenzen stehen in [PROVENANCE.md](docs/PROVENANCE.md).

## Stand und Verteilung

**0.1.0b12** öffnet beim Hinzufügen eines Codes direkt die Codekarte. In der
Geräteübersicht stehen „Code gespeichert“ und „Code fehlt“ rechts in der
Mobilansicht und in der Spalte Codes am Desktop.

**0.1.0b11** ersetzt die Druckansicht durch direkt herunterladbare PDF-Gerätekarten.
Einzelne, gefilterte oder markierte Einträge werden lokal in Home Assistant
gerendert; pro PDF sind 1 bis 100 Geräte möglich. Notizen sind optional,
Original-QR und manueller Matter-Code bleiben getrennt. Die Erzeugung legt keine
Datei auf dem HA-Server ab und ändert das Inventar nicht. Ausgabe-, Text- und
Seitenlimits begrenzen den Vorgang; bei Überschreitung bleibt die Auswahl erhalten.
Ansichten und Standard bleiben zentral pro HA-Konto gespeichert. Das Inventar-
und JSON-/CSV-Austauschformat bleibt unverändert.
Bedienung und Ausbauplan stehen in [USAGE](docs/USAGE.de.md) und
[ROADMAP](docs/ROADMAP.de.md).
Die Integration befindet sich weiterhin in der Betaphase. Eine Aufnahme in den
allgemeinen Marketplace-Katalog ist noch nicht erfolgt; die Installation ist über
ein benutzerdefiniertes Repository oder manuell möglich.

**0.1.0b10** wurde auf HA Core **2026.11.1** installiert und Home Assistant
anschließend neu gestartet. Alle 13 Einträge mit gespeichertem Code blieben
erhalten; die Ansicht Home wurde zentral übernommen. Zwei getrennte
Browser-Sitzungen prüften denselben Kontokatalog. Der physische iPhone-Test
bleibt eine eigene Abnahme.

Der lokale Stand für Beta 11 umfasst **473 Python-Tests und 250 JavaScript-Tests**.
Der isolierte HA-Core-Lauf bestand **19 Prüfungen**. Browserprüfungen am Desktop
und bei 390 × 844 Pixeln bestätigten vier echte PDF-Downloads einschließlich
Notiz-Opt-in, gefilterter und markierter Auswahl. Die PDFs wurden separat gelesen
und inhaltlich geprüft. Physische iPhone- und Android-Downloads bleiben offen.
Diese Ergebnisse belegen weder Export/Import im Zielsystem noch eine vollständige
HA-Wiederherstellung. Der [Teststand](docs/TESTING.de.md) trennt Versionen, lokale
Prüfungen und praktische Abnahme. Die [Sicherungsanleitung](docs/BACKUP.de.md)
beschreibt den jeweiligen Umfang von HA-Backup und Inventarexport.

## Lokale Entwicklung

Die Testumgebung verwendet Python 3.14 und Home Assistant 2026.11.0.

```sh
python3.14 -m venv .venv
.venv/bin/python -m pip install -r requirements-test.txt
.venv/bin/python -m pytest -q
.venv/bin/ruff check custom_components tests dev
.venv/bin/ruff format --check custom_components tests dev
node --test tests/*.test.mjs
```

Echte Setup-Codes, HA-Konfigurationen, private Fotos und Exporte gehören nicht in
das Repository. Entwicklungsbeispiele verwenden ausschließlich synthetische Daten.

### Oberflächenvorschau

```sh
.venv/bin/python dev/serve_preview.py --port 8137
```

Die Vorschau unter `http://127.0.0.1:8137/dev/` lädt dieselbe Web-Komponente mit
einer simulierten HA-Verbindung und sichtbar gekennzeichneten Beispieldaten.
Inventaränderungen bleiben im Arbeitsspeicher und werden beim Neuladen
zurückgesetzt. Für Ansichten simuliert die Vorschau den zentralen Kontospeicher
mit gesondertem Browser-Speicher; Beispielansichten bleiben dort beim Neuladen erhalten.
Die Vorschau ersetzt keine Prüfung in einer laufenden Home-Assistant-Installation.
Der lokale Vorschau-Server verwendet für PDF-Anfragen denselben Renderer wie die
Integration. Er bindet nur an 127.0.0.1, begrenzt JSON-Anfragen auf 4 MiB und
akzeptiert nur den eigenen Loopback-Host und gegebenenfalls passenden Origin.

Ein reproduzierbares Beispiel mit öffentlichen Protokoll-Testvektoren entsteht mit:

```sh
.venv/bin/python dev/pdf_preview.py
```

Der QA-Lauf benötigt die vorhandenen Testabhängigkeiten, Node und Poppler. Liegt
Poppler nicht im Suchpfad, kann `--poppler-dir /pfad/zu/poppler/bin` angegeben werden.
Mit `--skip-render` werden PDFs und Textprüfungen ohne Rasterprüfung ausgeführt.
Die Beispiel-PDF liegt unter `output/pdf/setup-code-manager-example.pdf`;
gerasterte Prüfseiten und Zwischendateien bleiben unter `/tmp/scm-pdf-validation`.

### Isolierter HA-Lauf

```sh
.venv/bin/python -m pip install -r requirements-runtime-test.txt
.venv/bin/python dev/smoke_ha.py
```

Der optionale Test startet HA Core auf `127.0.0.1` mit temporärer Konfiguration und
synthetischen Benutzern. Er prüft Einrichtung, Adminschutz, versionsbezogene
Web-Dateien, Speichern, Export und Datenerhalt beim Neuladen. Anschließend beendet
er HA und entfernt die Testdaten. Der Bericht liegt unter `dist/runtime-smoke.json`;
Einzelheiten und Grenzen stehen im [Teststand](docs/TESTING.de.md).

## Weitere Unterlagen

- [Installation, Updates und optionale Datenübernahme](docs/INSTALLATION.de.md)
- [Sicherung und Wiederherstellung](docs/BACKUP.de.md)
- [Prüfungen und offene praktische Abnahme](docs/TESTING.de.md)
- [Funktions- und Datenkonzept](docs/CONCEPT.de.md)
- [Ansichten und Bedienabläufe](docs/SCREENS.de.md)
- [Visuelle Entwürfe und frühere Beispielansichten](docs/design/README.md)

Die Konzept- und Designunterlagen dokumentieren die ursprüngliche Planung.
Den tatsächlich verfügbaren Funktionsumfang beschreibt die README, Änderungen
einzelner Betas stehen in den [Versionshinweisen](docs/releases/).
