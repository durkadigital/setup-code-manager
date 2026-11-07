# Setup Code Manager

Geräte und Einrichtungscodes in Home Assistant verwalten, lokal scannen und sichern.

**Testversion [0.1.0b3](https://github.com/durkadigital/setup-code-manager/releases/tag/0.1.0b3): erreichbare Gerätedetails auf kleinen Bildschirmen.
Lokal geprüft; die praktische iPhone-Abnahme dieser Beta steht noch aus.
Noch keine stabile Version oder allgemeine Katalogaufnahme.**
Die Detailansicht erhält einen festen Kopf mit sicherem Abstand zur Statusleiste
und einen eigenen scrollbaren Inhalt. Lange Titel bleiben auf zwei Zeilen begrenzt;
weitere Geräteangaben stehen im Scrollbereich. Beim Anzeigen eines Codes und bei
Aktualisierungen bleibt die Scrollposition erhalten; Schließen führt den
Tastaturfokus zum Gerät in der Liste zurück.
[Änderungen und Grenzen von Beta 3](docs/releases/0.1.0b3.md).

Die veröffentlichte [0.1.0b2](https://github.com/durkadigital/setup-code-manager/releases/tag/0.1.0b2)
ist auf dem Zielsystem installiert. Am 7. November 2026 wurde die Fotoaufnahme in
der iPhone-Companion-App bestätigt; ein realer Gerätecode wurde anschließend
gespeichert. Die Persistenz dieses Codes nach einem HA-Neustart sowie Export und
Wiederherstellung im Zielsystem bleiben offen ([Teststand](docs/TESTING.de.md)).
Installation, Einrichtung und Neustart waren zuvor mit **0.1.0b1** geprüft worden.
Die Oberfläche ist auf Deutsch und Englisch verfügbar.

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

## Testinstallation

Vorgesehen für Home Assistant ab 2026.1; die aktuelle automatisierte Testumgebung
verwendet **Home Assistant 2026.11.0 / Python 3.14**. Ältere unterstützte HA-Stände
sind noch nicht praktisch abgenommen. Vor einer Testinstallation eine aktuelle
HA-Sicherung anlegen und die ursprüngliche Integration samt Daten erhalten.

### Über den Marketplace ab Home Assistant 2026.11

Für die Layoutkorrektur ausdrücklich **`0.1.0b3`** auswählen. Falls diese Version noch nicht
angeboten wird, die Repository-Daten aktualisieren und die Versionsauswahl erneut
öffnen oder die manuelle Installation unten verwenden.

1. **Einstellungen → Marketplace** öffnen und das Repository
   `https://github.com/durkadigital/setup-code-manager` als benutzerdefiniertes
   Repository vom Typ **Integration** hinzufügen. Falls angefordert, GitHub verbinden.
2. Die Repository-Details öffnen und **vor der Installation** die Option
   **Vorabversionen einschließen** / **Include pre-releases** aktivieren.
3. Die angebotene Version prüfen: **Setup Code Manager**, **`0.1.0b3`**, neue
   Integrationskennung **`setup_code_manager`**. Wenn noch **Setup Codes** oder eine
   frühere Version angeboten wird, nicht installieren; die
   Repository-Daten aktualisieren und die Versionsauswahl erneut prüfen.
4. Die Vorabversion installieren und einen vom Marketplace angeforderten
   Home-Assistant-Neustart ausführen.
5. Unter **Einstellungen → Geräte & Dienste → Integration hinzufügen** nach
   **Setup Code Manager** suchen und die gewünschten Geräteintegrationen wählen.
6. Den neuen Seitenleisteneintrag als Administrator öffnen und zunächst mit
   Beispieldaten testen; siehe [Abnahmeplan](docs/TESTING.de.md).

Home Assistant 2026.11 enthält den Marketplace bereits. Diese Installation über
ein benutzerdefiniertes Repository ist von einer Aufnahme in den allgemeinen
Katalog zu unterscheiden; eine Katalogaufnahme ist noch nicht beantragt.
Der Marketplace bietet Vorabversionen nur nach ausdrücklicher Aktivierung an;
Details beschreibt die [offizielle Release-Dokumentation](https://contributors.home-assistant.io/marketplace/guides/releases/).

### Alternativ manuell

Die Version **`0.1.0b3`** auf der
[Release-Seite](https://github.com/durkadigital/setup-code-manager/releases) auswählen
und deren **Source code (zip)** laden. Im heruntergeladenen `manifest.json` muss
`0.1.0b3` stehen.

Den vollständigen Ordner `custom_components/setup_code_manager` nach
`<HA-Konfiguration>/custom_components/setup_code_manager` kopieren, HA neu starten
und anschließend **Setup Code Manager** über Geräte & Dienste hinzufügen.
Der Standardbranch `main` bleibt beim geprüften Stand **`0.1.0b1`** mit der neuen
Domain `setup_code_manager`. Für die veröffentlichten Scanverbesserungen die
Release-Version **`0.1.0b3`** verwenden. Weitere Betas werden vom Featurebranch
veröffentlicht.

Die neue Domain `setup_code_manager` ist von `setup_codes` getrennt. Beide können
zur Migration parallel installiert sein. Im neuen Panel erscheint bei vorhandener
Originaldatei die Übernahmefunktion. Nach der Übernahme verändert eine Bearbeitung
in einer der beiden Apps die andere Liste nicht.

`custom_components/setup_codes` und `.storage/setup_codes` der ursprünglichen
Integration werden dabei weder ersetzt noch gelöscht. Eine Übernahme ist eine
gesonderte Aktion mit Vorschau; zuerst die neue Version prüfen.

## Scan, Import und Sicherung

Livekamera benötigt HTTPS beziehungsweise einen sicheren Browserkontext und eine
Kamerafreigabe. Bildauswahl und manuelle Eingabe bleiben als Alternativen verfügbar.
Ohne verfügbare Livekamera bietet die App seit `0.1.0b2` **Foto aufnehmen** über die Fotoaufnahme
des Betriebssystems an. **Foto auswählen** bleibt separat verfügbar. Welche
Kameraauswahl erscheint, hängt vom Browser und der App ab. Die Fotoaufnahme über
HTTP wurde mit `0.1.0b2` in der iPhone-Companion-App bestätigt.

Ein direktes Livebild über HTTP ist damit nicht verfügbar. Home Assistant bietet
für Custom Panels derzeit keinen unterstützten Ladeweg zum nativen Companion-
Scanner mit Ergebnisrückgabe. Die App verwendet keine privaten Nachrichtenhandler;
Netzwerkeinstellungen werden nicht geändert. Für die vorhandene Livekamera ist ein
gültiger HTTPS-Zugang erforderlich.
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
Ein echter vollständiger HA-Backup-/Restore-Lauf sowie die weiteren Kamera- und
Gerätetests aus dem Abnahmeplan stehen noch aus.

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
