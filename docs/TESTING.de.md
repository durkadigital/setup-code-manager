# Teststand und praktische Abnahme

Test-Vorabversion 0.1.0b1, 7. November 2026. Ausschließlich synthetische Testdaten.
Die Vorbereitung und lokale Prüfung dieser Version belegen noch keine Installation
oder Abnahme in einer eigenen HA-OS-Umgebung.

## Automatisierte Prüfungen

Die Python-Tests laufen gegen Home Assistant 2026.11.0 auf Python 3.14.4. Sie
prüfen Codevalidierung, Inventar-/Austauschformate, atomare Dateispeicherung,
Geräteverwaltung, Administratorrechte und Integration-Lebenszyklus. Die Node-Tests
verwenden den tatsächlich mitgelieferten QR-Decoder und erzeugte QR-Pixelbilder.

Besonders abgedeckt:

- Matter-, HomeKit- und Z-Wave-Format-/Prüfsummenprüfung; führende Nullen.
- JSON-/CSV-Rundlauf einschließlich Unicode, Notizen, leeren Codes und Archiv.
- Ungültige, doppelte und unbekannte Daten; sichere CSV-Zellen; wiederholter Import.
- HA-Geräte entfernen, offline halten und explizit löschen; Codes bleiben erhalten.
- Gleiche HA-ID mit mehreren Protokollen; keine Zusammenführung nach Namen oder Seriennummer.
- Veraltete Bearbeitung, verschwundene Auswahl, belegte Verknüpfungen und Importkonflikte.
- Schreibfehler, beschädigte Dateien, Abbruch während Dateischreiben und Integration-Neuladen.
- Adminschutz aller API-Befehle; Fehler und Änderungsereignisse ohne Codeinhalte.
- QR-Pixeldaten einschließlich invertierter/gedrehter Bilder; Kamera-/Fotoressourcen nach Abbruch freigeben.

Die lokalen Befehle stehen in der [README](../README.md). Auf GitHub sind auch die
[Tests](https://github.com/durkadigital/setup-code-manager/actions/runs/42364597060)
und [Hassfest](https://github.com/durkadigital/setup-code-manager/actions/runs/42364597053)
für den veröffentlichten Entwicklungsstand `d9a70e6` bestanden. Die HACS-Validierung
prüft Repository-Voraussetzungen; sie bedeutet keine Aufnahme in den HACS-Katalog.
Diese CI-Nachweise beziehen sich auf den genannten Entwicklungscommit; ein neuer
GitHub-Actions-Lauf für die Beta ist gesondert zu prüfen.

## Isolierter Lauf mit echtem Home Assistant

`dev/smoke_ha.py` startet Home Assistant Core 2026.11.0 mit dem dazugehörigen
Frontend 20261028.4 und temporärer Konfiguration auf `127.0.0.1`. Der Test verwendet
synthetische Administrator-/Standardbenutzer und einen automatisch gewählten Port.
Er nutzt weder eine vorhandene HA-Konfiguration noch echte Zugangsdaten. Zusätzliche
Pakete werden während dieses Laufs nicht automatisch nachinstalliert.

Der für **0.1.0b1** erneuerte Lauf am 7. November 2026 bestand **13 Prüfungen**: Integration und Frontend
normal einrichten, Config-Flow abschließen, sieben Web-Dateien per HTTP abrufen,
anonymen sowie unberechtigten API-Zugriff abweisen, als Administrator speichern und
exportieren, Daten beim Entladen/Neuladen behalten und eine zweite Einrichtung
verhindern. Anschließend wurden HA beendet, die temporären Dateien entfernt und
der geschlossene Port geprüft. Es gab keine Fehlerprotokolle unserer Integration.

Der [Ergebnisbericht](testing/runtime-smoke-2026-11-07.json) enthält Versionen,
Prüfergebnisse und einen Hash der getesteten Integrationsdateien. In der minimalen
Python-Testumgebung fehlen Abhängigkeiten einiger fremder optionaler HA-Komponenten,
etwa Kamera, Sprachassistent und Analytics; deren Startfehler stehen ausdrücklich
im Bericht. Unsere Integration sowie HTTP, Frontend und API wurden erfolgreich geladen.
Dieser Test ist keine HA-OS-, Smartphone-, Geräte- oder vollständige Restore-Abnahme.

Installation und Aufruf stehen in der README unter Entwicklung. Der zusätzliche
Frontend-Download gehört nur zur optionalen `requirements-runtime-test.txt`, nicht
zur normalen Unit-Testumgebung.

## Oberfläche

`dev/index.html` lädt dieselbe produktive Web-Komponente mit einer simulierten
HA-Verbindung. Ein sichtbarer Hinweis kennzeichnet Beispieldaten. Diese Vorschau
testet Darstellung und Interaktion; sie ersetzt keine Installation in Home Assistant.
Die Beispieldaten werden beim Neuladen zurückgesetzt.

## Noch erforderliche Abnahme im Zielsystem

1. Nach Veröffentlichung `0.1.0b1` über das benutzerdefinierte Repository im
   Marketplace installieren: **Vorabversionen vor der Installation einschließen**,
   anschließend **Setup Code Manager**, Version **0.1.0b1** und Domain
   **setup_code_manager** prüfen. Alternativ die exakt geprüfte Version manuell
   kopieren. Anleitung: [Testinstallation](../README.md#testinstallation).
   Einen angeforderten HA-Neustart ausführen und die Integration über Geräte &
   Dienste hinzufügen. Die ursprüngliche Integration und ihre Daten erhalten.
   Als Administrator öffnen; als normaler Benutzer darf kein Zugriff auf die Codes bestehen.
2. Geräte mit Matter und HomeKit sowie ein offline geschaltetes Gerät vorbereiten.
   Bei Matter-Erfassung muss ein Gerät mit gespeichertem HomeKit-Code und fehlendem
   Matter-Code auswählbar bleiben; Speichern ergänzt denselben Inventareintrag.
3. Den Original-QR eines eigenen Geräts per Smartphone-Kamera und Bildauswahl
   erfassen. Safari/iOS, Android und gegebenenfalls die HA-Companion-App getrennt
   prüfen. Kameraverweigerung, Abbruch, HTTPS und manuelle Alternative prüfen.
4. Gerät ausschließlich aus HA entfernen. Inventar, Standort, Notizen und Codes
   müssen erhalten bleiben; Status wechselt zu Nicht verknüpft. Ein Offline-Gerät
   muss hingegen verknüpft bleiben.
5. Archivieren, neuladen, wiederherstellen und nach ausdrücklicher Bestätigung
   löschen. Ein gelöschter Inventareintrag darf nicht beim nächsten Scan automatisch
   wieder auftauchen; das vorhandene HA-Gerät bleibt im Auswahlfenster verfügbar.
6. JSON und CSV exportieren, unverändert importieren und erneut importieren.
   Anschließend bewusst einen Konflikt erzeugen, vorhandene Daten behalten bzw.
   ausdrücklich ersetzen. Einen Import in einer frischen Installation getrennt prüfen.
7. Die alte Integration parallel installieren und die lokale Übernahme prüfen.
   Unklare Mehrfachzuordnungen bleiben getrennt, Codes müssen vollständig erhalten bleiben.
8. Vollständigen HA-Backup-/Restore-Test gemäß [Sicherungsanleitung](BACKUP.de.md)
   durchführen. Die Ergebnisse der Vorabversion entscheiden über weitere Betas
   und eine spätere stabile Veröffentlichung.

Nicht durchgeführt sind bislang eine produktive Installation, ein vollständiger
HA-Restore und reale Smartphone-Kamera-/Companion-App-Abnahmen. Ein automatisierter
Decoder-Test belegt die Erkennung der Testbilder, nicht die Qualität aller realen
Kameras, Ausdrucke und Lichtverhältnisse.

## Ergebnis der lokalen Prüfung am 7. November 2026

- **270 Python-Tests bestanden**, einschließlich realer HA-Registry-, API- und
  Lifecycle-Helfer; fünf Warnungen stammen aus HA-Abhängigkeiten.
- **12 Node-Tests bestanden**, darunter echte Pixeldecodierung über den mitgelieferten Decoder.
- Ruff-Codeprüfung, Ruff-Formatprüfung, JavaScript-Syntaxprüfung und Git-Whitespace-Prüfung bestanden.
- Browserprüfung im IAB: Desktop, mobile Breite 390 px, Deutsch/Englisch, Hell/Dunkel;
  keine erfassten Konsolenfehler. Ein Fehler der mobilen Tabellenbreite wurde
  dabei korrigiert und die Korrektur erneut gemessen/visuell geprüft.
- Safari-Vorschau: Foto mit erzeugtem Matter-QR erkannt; Gerät mit bestehendem
  HomeKit-Code bleibt für fehlenden Matter-Code auswählbar; Ergänzung nutzt denselben
  Eintrag und erhält den anderen Code. Archivwahl und Wiederherstellung sowie
  explizite Importkonfliktentscheidung und wiederholter Import geprüft.

[Screenshots der implementierten Oberfläche](design/README.md) zeigen ausschließlich
Beispieldaten. Diese Ergebnisse beziehen sich auf lokale Tests und Vorschau.
- Frische JSON- und CSV-Dateien wurden über die Safari-Oberfläche exportiert und
  anschließend mit dem echten Python-Importer geprüft: jeweils 8 gültige Einträge,
  kein ungültiger Datensatz und 8 semantisch identische Einträge im Formatvergleich.
  Ein dabei entdeckter Fehler ausschließlich in der simulierten Speicherfunktion
  (mitgespeicherte Laufzeitfelder einer HA-Verknüpfung) wurde korrigiert; die
  produktive Speicherung entfernte diese Felder bereits.

Der CSV-Import über die Safari-Dateiauswahl bestätigte anschließend ebenfalls: 8 bereits vorhandene Einträge, keine neuen und keine ungültigen Einträge.
