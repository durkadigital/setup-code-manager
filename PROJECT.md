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
| Aktuelle Vorabversion | `0.1.0b7` |
| Mindestversion | Home Assistant `2026.11.0` |

Grundlage ist [PhantomPhoton/Setup-Codes](https://github.com/PhantomPhoton/Setup-Codes),
Version 1.1.11, Commit `5a9ab4a703482edbcb43276d6dae74351ca881cf`.
Originalhistorie und MIT-Lizenz bleiben erhalten. Die neue Integration besitzt
eigene API-, Panel- und Speicherkennungen. Details zu Herkunft und Drittanbieter-
Lizenzen stehen in [PROVENANCE.md](docs/PROVENANCE.md).

## Stand und Verteilung

**0.1.0b7** ergänzt die Suche nach Notizen, QR-Inhalten und manuellen Codes sowie
kombinierbare Raum-, Protokoll- und Codestatusfilter. Numerische Codes lassen sich
mit oder ohne Leerzeichen und Bindestriche suchen.
Die Integration befindet sich weiterhin in der Betaphase. Eine Aufnahme in den
allgemeinen Marketplace-Katalog ist noch nicht erfolgt; die Installation ist über
ein benutzerdefiniertes Repository oder manuell möglich.

Die vorherige Version **0.1.0b6** wurde auf HA Core **2026.11.1** installiert und
Home Assistant anschließend neu gestartet. Dabei wurden die korrigierten
Oberflächentexte, der maskierte manuelle Matter-Code, schreibgeschützte HA-Namen und
Räume, bearbeitbare Notizen und die grüne Speicherkennzeichnung geprüft.
Die HTTPS-Anmeldung und Scannerauswahl sind geprüft; eine Livekamera-Abnahme auf
dem physischen iPhone steht noch aus.

Der lokale Abschlusslauf für Beta 7 umfasst **299 Python-Tests, 104 JavaScript-Tests**
und **13 Prüfungen in einem isolierten echten HA-Core-Lauf**. Diese Ergebnisse
belegen weder Export/Import im Zielsystem noch eine vollständige HA-
Wiederherstellung. Der [Teststand](docs/TESTING.de.md) trennt Versionen, lokale
Prüfungen und praktische Abnahme. Die [Sicherungsanleitung](docs/BACKUP.de.md)
beschreibt den jeweiligen Umfang von HA-Backup und Inventarexport.

## Lokale Entwicklung

Die Testumgebung verwendet Python 3.14 und Home Assistant 2026.11.0.

```sh
python3.14 -m venv .venv
.venv/bin/python -m pip install -r requirements-test.txt
.venv/bin/python -m pytest -q
.venv/bin/ruff check custom_components tests dev/smoke_ha.py
.venv/bin/ruff format --check custom_components tests dev/smoke_ha.py
node --test tests/*.test.mjs
```

Echte Setup-Codes, HA-Konfigurationen, private Fotos und Exporte gehören nicht in
das Repository. Entwicklungsbeispiele verwenden ausschließlich synthetische Daten.

### Oberflächenvorschau

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Die Vorschau unter `http://127.0.0.1:8765/dev/` lädt dieselbe Web-Komponente mit
einer simulierten HA-Verbindung und sichtbar gekennzeichneten Beispieldaten.
Änderungen bleiben im Arbeitsspeicher und werden beim Neuladen zurückgesetzt.
Die Vorschau ersetzt keine Prüfung in einer laufenden Home-Assistant-Installation.

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
