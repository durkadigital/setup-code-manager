# Teststand und praktische Abnahme

Entwicklungsversion 0.1.0, 7. November 2026. Ausschließlich synthetische Testdaten.

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

Die lokalen Befehle stehen in der [README](../README.md). Die GitHub-Workflows sind
vorbereitet; ein lokales Testergebnis ist kein Nachweis eines erfolgreichen
GitHub-Actions-Laufs oder einer HACS-Katalogprüfung.

## Oberfläche

`dev/index.html` lädt dieselbe produktive Web-Komponente mit einer simulierten
HA-Verbindung. Ein sichtbarer Hinweis kennzeichnet Beispieldaten. Diese Vorschau
testet Darstellung und Interaktion; sie ersetzt keine Installation in Home Assistant.
Die Beispieldaten werden beim Neuladen zurückgesetzt.

## Noch erforderliche Abnahme im Zielsystem

1. Integration aus der aktuellen Arbeitskopie in eine getrennte HA-Testinstallation
   kopieren, HA neu starten und über Geräte & Dienste hinzufügen. Als Administrator
   öffnen; als normaler Benutzer darf kein Zugriff auf die Codes bestehen.
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
   durchführen. Erst nach dieser Abnahme eine erste öffentliche Testversion erstellen.

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
