# Setup Code Manager

Geräte und Einrichtungscodes in Home Assistant verwalten, lokal scannen und sichern.

**Stand: Entwicklungsversion 0.1.0 auf dem Branch `feature/first-version`.
Noch kein veröffentlichtes Release und noch kein Eintrag im HACS-Katalog.**
Automatisierte Tests und ein isolierter Lauf mit echtem Home Assistant sind bestanden.
Die praktische Abnahme mit eigenen Geräten steht aus. Die Oberfläche ist auf Deutsch
und Englisch verfügbar.

## Funktionen

- Eigenständiges Geräteinventar mit Matter-, HomeKit- und Z-Wave-Codes.
- QR-Code per Kamera oder Foto erfassen; der Decoder wird lokal mitgeliefert.
- Beim Erfassen ein HA-Gerät auswählen. Standardmäßig erscheinen Geräte, denen
  der gewählte Protokollcode fehlt: Ein vorhandener HomeKit-Code schließt ein
  Gerät ohne Matter-Code nicht aus. Offline-Geräte bleiben auswählbar.
- Geräte ohne HA-Verknüpfung speichern. Wird ein HA-Gerät entfernt, bleiben
  Inventareintrag, eigene Angaben und Codes erhalten.
- Archivieren, wiederherstellen und ausdrücklich löschen. Löschen betrifft nur
  unseren Inventareintrag; das HA-Gerät bleibt bestehen und kann später erneut
  ausgewählt werden.
- JSON- und CSV-Export inklusive Archiv; Import mit Vorschau und ausdrücklicher
  Entscheidung bei Konflikten. Ein Import ersetzt niemals ungefragt die gesamte Liste.
- Übernahme aus dem ursprünglichen Setup Codes über eine Vorschau. Die Quelldatei
  wird ausschließlich gelesen.
- Administratorzugriff, maskierte Codeanzeige und atomare Dateispeicherung unter
  `.storage/setup_code_manager` im HA-Konfigurationsordner.

Die App koppelt keine Geräte. „Ohne Code“ bezieht sich auf den Bestand dieser App;
Matter- und HomeKit-Codes werden nicht aus Home Assistant ausgelesen. Unterstützte
Z-Wave-Geräte können ihre DSK über die vorhandene Integration bereitstellen.

## Lokale Testinstallation

Vorgesehen für Home Assistant ab 2026.1; die aktuelle automatisierte Testumgebung
verwendet **Home Assistant 2026.11.0 / Python 3.14**. Ältere unterstützte HA-Stände
sind noch nicht praktisch abgenommen.

1. Den [Entwicklungsbranch](https://github.com/durkadigital/setup-code-manager/tree/feature/first-version)
   öffnen und über **Code → Download ZIP** herunterladen, oder die aktuelle lokale
   Arbeitskopie verwenden. Den vollständigen Ordner `custom_components/setup_code_manager`
   nach `<HA-Konfiguration>/custom_components/setup_code_manager` kopieren.
2. Home Assistant neu starten.
3. Unter **Einstellungen → Geräte & Dienste → Integration hinzufügen** nach
   **Setup Code Manager** suchen und die gewünschten Geräteintegrationen wählen.
4. Den neuen Seitenleisteneintrag als Administrator öffnen.
5. Zunächst mit Beispieldaten testen; siehe [Abnahmeplan](docs/TESTING.de.md).

Die neue Domain `setup_code_manager` ist von `setup_codes` getrennt. Beide können
zur Migration parallel installiert sein. Im neuen Panel erscheint bei vorhandener
Originaldatei die Übernahmefunktion. Nach der Übernahme verändert eine Bearbeitung
in einer der beiden Apps die andere Liste nicht.

**Diese Testversion bitte noch manuell installieren.** Der Standardbranch `main`
enthält derzeit den früheren Konzeptstand samt ursprünglicher Integration. Die
normale HACS-Auswahl bietet Releases bzw. den Standardbranch und ist daher noch
nicht der Installationsweg für `feature/first-version`.

Nach Übernahme der geprüften Version in den Standardbranch bzw. Veröffentlichung
kann dieses Repository als **benutzerdefiniertes HACS-Repository vom Typ Integration**
eingebunden werden. Das ist von einer Aufnahme in den allgemeinen HACS-Katalog zu
unterscheiden; diese ist noch nicht beantragt.

## Scan, Import und Sicherung

Livekamera benötigt HTTPS beziehungsweise einen sicheren Browserkontext und eine
Kamerafreigabe. Bildauswahl und manuelle Eingabe bleiben als Alternativen verfügbar.
Unterstützt werden Matter-QRs `MT:`, HomeKit-QRs `X-HM://`, Z-Wave-SmartStart-QRs und
die jeweiligen manuellen Codes. Gedruckte Ziffern werden nicht per OCR erkannt.
Zusammengesetzte Matter-QRs mit mehreren Payloads sowie nicht unterstützte optionale
TLV-Typen werden ausdrücklich abgelehnt.

Pro Gerät wird derzeit **ein Code pro Protokoll** gespeichert. Ein Original-QR
bleibt vollständig erhalten und kann erneut angezeigt werden. Unterschiedliche
Original- und temporäre Freigabecodes brauchen eine bewusste Auswahl.

JSON ist das vollständige Inventarformat. CSV hat ein festes versioniertes Schema
mit einer Zeile pro Code, einschließlich codefreier Geräte. Ein reversibles
Apostroph-Präfix schützt Tabellenzellen vor Formelinterpretation und erhält führende
Nullen; beim externen Bearbeiten muss das Schema erhalten bleiben. Es gibt noch
keine freie Spaltenzuordnung für beliebige CSV-Dateien. Import und Export sind auf
16 MiB und 10.000 Inventareinträge begrenzt.

Exporte enthalten Codes im Klartext. Bilder werden ausschließlich lokal verarbeitet
und nicht gespeichert. Es gibt weder Analyseübertragung noch einen Cloud-Decoder.
Die Integration fügt dem HA-Konfigurationsordner keine eigene Verschlüsselung hinzu.

[Sicherung, Wiederherstellung und HA-Backups](docs/BACKUP.de.md) beschreibt den Umfang.
Ein echter vollständiger HA-Backup-/Restore-Lauf sowie Kamera-/Companion-App-Tests
auf den Zielgeräten stehen noch aus.

## Entwicklung

```sh
python3.14 -m venv .venv
.venv/bin/python -m pip install -r requirements-test.txt
.venv/bin/python -m pytest -q
.venv/bin/ruff check custom_components tests dev/smoke_ha.py
.venv/bin/ruff format --check custom_components tests dev/smoke_ha.py
node --test tests/*.test.mjs
python3 -m http.server 8765 --bind 127.0.0.1
```

Die lokale Oberflächenvorschau liegt unter `http://127.0.0.1:8765/dev/`.
Sie nutzt dieselbe Web-Komponente mit ausdrücklich gekennzeichneten Beispieldaten
und einer simulierten HA-Verbindung. Ihr Zustand bleibt nur im Arbeitsspeicher.
Sie belegt keinen Test in einer laufenden HA-Installation.

Zusätzlich lässt sich der echte HTTP-/WebSocket-Lauf lokal wiederholen:

```sh
.venv/bin/python -m pip install -r requirements-runtime-test.txt
.venv/bin/python dev/smoke_ha.py
```

Dieser optionale Test startet HA Core ausschließlich auf `127.0.0.1` mit einer
temporären Konfiguration und synthetischen Benutzern. Er prüft Einrichtung,
Adminschutz, Web-Dateien, Speichern, Export und Datenerhalt beim Neuladen, beendet
anschließend HA und entfernt die Testdaten. Das Ergebnis liegt unter
`dist/runtime-smoke.json`. Details und Grenzen stehen im [Teststand](docs/TESTING.de.md).

## Projekt und Herkunft

- [Projektstand](PROJECT.md)
- [Funktionskonzept](docs/CONCEPT.de.md) und [Bildschirmkonzept](docs/SCREENS.de.md)
- [Visuelle Entwürfe](docs/design/README.md)
- [Technische Herkunft](docs/PROVENANCE.md) und [Originaldokumentation](docs/UPSTREAM_README.md)

Dieses Projekt baut auf [PhantomPhoton/Setup-Codes](https://github.com/PhantomPhoton/Setup-Codes)
auf. Originalhistorie, Urheberhinweise und [MIT-Lizenz](LICENSE) bleiben erhalten.
Der mitgelieferte QR-Decoder [jsQR](custom_components/setup_code_manager/www/vendor/README.md)
steht unter Apache-2.0; die zugehörige Lizenz liegt im selben Verzeichnis.

Echte Setup-Codes, HA-Konfigurationen und private Exporte gehören nicht in dieses
Repository. Entwicklungsbeispiele verwenden ausschließlich synthetische Daten.
