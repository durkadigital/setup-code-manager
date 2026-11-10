# Teststand und praktische Abnahme

Dieser Teststand beschreibt die lokale Cachekorrektur **0.1.0b5**, die zuletzt
installierte [0.1.0b4](https://github.com/durkadigital/setup-code-manager/releases/tag/0.1.0b4)
und die getrennt dokumentierten früheren Betas. Installation
und praktische Abnahme von `0.1.0b5` stehen noch aus; der Standardbranch `main`
bleibt bei `0.1.0b1`. Automatisierte Prüfungen verwenden synthetische Daten. Zusätzlich
wurden ein reales QR-Foto lokal und die Fotoaufnahme auf dem Ziel-iPhone geprüft.
Private Fotos und Codeinhalte werden nicht im Repository dokumentiert.
Die vollständige praktische Abnahme steht aus.

## Lokaler Entwicklungsstand 0.1.0b5

Nach der Installation von Beta 4 konnte Safari ein neues Panel mit einer älteren,
unversioniert importierten Übersetzungsdatei kombinieren. Dadurch erschien etwa
`codeStored` statt **Gespeichert**. Ein frischer Abruf der Übersetzungsdatei
enthielt den korrekten Text; die gespeicherten Codes waren weiterhin vorhanden.

Beta 5 verwendet einen gemeinsamen versionsbezogenen Pfad für das Panel und
alle nachgeladenen JavaScript-, CSS- und Decoderdateien, einschließlich
verschachtelter Importe. Die Korrektur betrifft das Laden der Oberfläche;
Speicherformat, Inventar und Codes bleiben unverändert.

**Abschlussprüfung am 10. November 2026:** 299 Python- und 82 JavaScript-Tests
bestanden. Ein Regressionstest ändert nur eine Übersetzungsdatei und prüft, dass
alle sieben tatsächlich referenzierten JS-/CSS-/Decoderadressen wechseln; vor
der Korrektur blieb dieser Test rot. Ein weiterer Test prüft die stabile Basis
bei erneutem Einrichten. Ruff, Format- und Whitespace-Prüfung bestanden.

Der isolierte Lauf mit echtem HA Core bestand 13 Prüfungen. Alle sieben Assets
antworteten unter der tatsächlich registrierten Versionsbasis mit HTTP 200;
Adminschutz, Speichern, Export und Neuladen bestanden, ohne Integrationsfehler.
Im Zielsystem ist nach dem Update besonders zu prüfen, dass die neuen Texte auch
in einer zuvor verwendeten Safari-/Companion-Sitzung korrekt erscheinen.
[Versionshinweise](releases/0.1.0b5.md).

## Lokale Prüfung von 0.1.0b4 am 10. November 2026

Die Beta ergänzt drei zusammengehörige Funktionen:

- Zu gültigen gespeicherten `MT:`-QRs automatisch den manuellen Matter-Code mit
  11 oder 21 Ziffern ableiten. Original und Zifferncode bleiben unabhängig maskiert,
  anzeigbar und kopierbar; auch ältere Einträge benötigen keinen erneuten Scan.
- Vorhandene Codes grün als **Gespeichert** kennzeichnen. Der separate
  Online-/Offline-Status beschreibt weiterhin die Erreichbarkeit des HA-Geräts.
- Namen und Räume vorhandener verknüpfter HA-Geräte automatisch übernehmen,
  einschließlich späterer Umbenennungen und Raumänderungen. Diese Felder sind im
  Panel schreibgeschützt. Mehrere Verknüpfungen ergeben eindeutige, sortierte Namen
  und Räume. Ohne vorhandene HA-Verknüpfung sind manuelle Angaben möglich;
  Notizen bleiben immer bearbeitbar.

Die Matter-Ableitung erfolgt nur zur Laufzeit. Es entsteht kein zweiter
gespeicherter Code; JSON, CSV und HA-Backups behalten den Original-QR. Nach Import
oder Wiederherstellung wird der manuelle Code erneut berechnet. Beim Entfernen
des letzten verknüpften HA-Geräts bleiben die zuletzt bekannten Namen und Räume
sowie die Codes erhalten. Eine Migration des Speicherformats ist nicht erforderlich.

Die Referenz für die Umrechnung sind die
[offiziellen Matter-Testvektoren](https://github.com/project-chip/connectedhomeip/blob/master/src/setup_payload/tests/run_python_setup_payload_test.py)
und der [offizielle Generator](https://github.com/project-chip/connectedhomeip/blob/master/src/setup_payload/ManualSetupPayloadGenerator.cpp).
Standard-Flow ergibt 11 Ziffern, User-Intent- und Custom-Flow jeweils 21, einschließlich
Verhoeff-Prüfziffer. Führende Nullen bleiben erhalten.

**Abschlussprüfung am 10. November 2026:** 297 Python- und 82 JavaScript-Tests
bestanden. Ruff, Format-, Syntax- und Whitespace-Prüfungen bestanden. Die Tests
prüfen zusätzlich die offiziellen Matter-Referenzvektoren, reine Laufzeitdaten,
HA-Identität bei Speichern/Import/Umbenennen/Entfernen sowie schreibgeschützte
HA-Angaben und getrennte Code-/Erreichbarkeitsanzeigen.

Die lokale Browserprüfung bei 390 × 844 Pixeln bestätigt den zusätzlichen
maskierten Matter-Code, die formatierte Ziffernanzeige und das Kopieren ohne
Trennzeichen durch anschließendes Einfügen in einen verworfenen Testentwurf.
Verknüpfte Namen/Räume sind Textanzeigen; die eigene Notiz bleibt editierbar.
Grüne Speicherkennzeichnungen sind auch bei einem nicht erreichbaren Testgerät
sichtbar. Alle Browserdaten sind synthetisch. Die Zahlen in den folgenden
Abschnitten beziehen sich ausdrücklich auf frühere Betas.

Für die praktische Abnahme im Zielsystem sind zusätzlich zu den bisherigen Fällen
zu prüfen: bestehender Matter-QR ohne neuen Scan, getrenntes Anzeigen und Kopieren,
grüner Speicherstatus bei einem Offline-Gerät, HA-Umbenennung und Raumwechsel,
mehrere Verknüpfungen sowie Datenerhalt nach Entfernen der letzten Verknüpfung.
[Versionshinweise](releases/0.1.0b4.md).

## Lokale Prüfung von 0.1.0b3 am 7. November 2026

Die Gerätedetails besitzen einen festen Kopf mit sicherem Bildschirmabstand und
einen separat scrollbaren Inhalt. Lange Titel sind auf zwei Zeilen begrenzt;
Standort, Modell und weitere Angaben stehen im Scrollbereich. Die Scrollposition bleibt beim Anzeigen eines
Codes und beim Aktualisieren desselben Geräts erhalten. Schließen per Schaltfläche
oder Escape maskiert aufgedeckte Codes und gibt den Fokus an den zugehörigen
Listeneintrag zurück; fehlt dieser in der gefilterten Liste, erhält die Suche den
Fokus. Ein anderes oder erneut geöffnetes Gerät beginnt oben.

- **270 Python-Tests und 48 Node-Tests bestanden.** 15 neue Verhaltenstests
  prüfen Scrollposition, Fokus und Schließen; die 33 früheren Node-Tests bleiben enthalten.
- Browserprüfung mit 390 × 844 Pixeln und simuliertem oberen Sicherheitsabstand
  von 59 px: Zuvor war die Detailansicht 1001 px hoch und besaß keinen nutzbaren
  eigenen Scrollbereich. Die Schließen-Schaltfläche begann bei 18 px hinter der
  Statusleiste. Nach der Korrektur ist die Ansicht 844 px hoch; die Schaltfläche
  beginnt bei 71 px und der Inhalt ist bis zum Ende erreichbar.
- Scrollen bis zum unteren Inhalt und anschließendes Schließen wurden in der
  lokalen Browserprüfung erfolgreich ausgeführt.
- Querformat mit 844 × 390 Pixeln und seitlichen Sicherheitsabständen von je
  44 px: Scrollbereich und untere Aktionen erreichbar, Schließen bei 20 px.
- Ein 1024 px breites Fenster mit 235 px HA-Seitenleiste lässt dem Panel 789 px;
  die schmale Detailansicht greift auch bei dieser Containerbreite. Bei 1440 px
  bleiben Geräteliste und Detailansicht nebeneinander sichtbar.
- Ein Grenzfall mit jeweils 256 Zeichen in Name, Standort und Modell, 30 Zeilen
  Notizen und drei Codes bleibt mit begrenztem Titel und scrollbarem Inhalt bedienbar.

Diese Messung mit simulierten Insets ersetzt keine Abnahme in der iPhone-
Companion-App. Installation und der spätere WebKit-Test am laufenden HA-System
sind unten gesondert dokumentiert; die ausdrückliche Bestätigung auf dem
physischen iPhone steht noch aus.
[Versionshinweise](releases/0.1.0b3.md).

## Lokale Prüfung von 0.1.0b2 am 7. November 2026

Diese Beta ergänzt:

- **Foto aufnehmen** über den Systemdialog bei HTTP-Aufrufen sowie eine separate
  Auswahl vorhandener Fotos. Der Livevideo-Zugriff benötigt weiterhin einen sicheren
  Browserkontext und eine Kamerafreigabe.
- QR-Erkennung mit mehreren Bildauflösungen und begrenzten Erkennungsversuchen.
- Abstände mobiler Vollbilddialoge unter Berücksichtigung der HA-/Companion-App-Insets.

Die Bildvorbereitung verwendet zuerst ein HTML-Bildelement; `ImageBitmap` dient
nur als Rückfall beim Öffnungsfehler. Für die QR-Erkennung werden Bildgrößen mit
maximal 2400, 1200 und 600 Pixeln Kantenlänge geprüft. Damit wird das Originalfoto
auch im Safari-Panel korrekt verarbeitet.

Abgeschlossen wurden:

- **270 Python-Tests** und **33 Node-Tests** bestanden; darunter 20 Scanner- und
  13 Paneltests.
- Ruff-Codeprüfung, Ruff-Formatprüfung, JavaScript-Syntaxprüfung und
  Git-Whitespace-Prüfung bestanden.
- Reales Original-JPEG in der produktiven Panelkomponente der lokalen Safari-Vorschau
  ausgewählt: **Matter-Code erkannt**, maskiertes Codefeld gefüllt. Der Entwurf
  wurde ohne Speichern verworfen.

Der lokale Fototest belegt die Erkennung im Safari-Panel. Die anschließende
Prüfung auf dem Ziel-iPhone ist unten getrennt dokumentiert. Die unten genannten
**12 Node-Tests** bleiben als früherer Teststand erhalten.

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
Diese CI-Nachweise beziehen sich auf den genannten Entwicklungscommit und sind
von den oben dokumentierten lokalen Läufen für die nachfolgenden Betas zu unterscheiden.

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

## Frühere Installationsprüfung von 0.1.0b1 auf Home Assistant OS

Am 7. November 2026 auf **HA OS 18.4 / Core 2026.11.0 / Frontend 20261028.4** geprüft:

- Marketplace-Installation von **Setup Code Manager 0.1.0b1**, Autor `durkadigital`,
  Installationsverzeichnis `setup_code_manager`.
- Einrichtung über den Config-Flow erfolgreich; das Administrator-Panel zeigte
  fünf automatisch erkannte, verknüpfte Geräte.
- Ein echter HA-Neustart wurde abgeschlossen; danach waren weiterhin fünf Einträge sichtbar.
- Geräteerfassung, manuelle Eingabe und HA-Geräteauswahl mit dem voreingestellten
  Filter **Ohne Matter-Code** wurden ohne Speichern geprüft.

In diesem Lauf wurden keine Codes gespeichert und weder Migration noch Import ausgeführt.
Dieser Installationsnachweis belegt deshalb noch keine Codepersistenz nach Neustart,
Export-/Import-Abnahme, echten Companion-App-Scan oder vollständige Wiederherstellung.

## Prüfung von 0.1.0b2 auf dem Ziel-iPhone

Am 7. November 2026 wurde **0.1.0b2** auf dem HA-OS-Zielsystem installiert. Der Nutzer
bestätigte die Fotoaufnahme in der iPhone-Companion-App über den HTTP-Zugang.
Der anschließend übermittelte Screenshot zeigt den erkannten und gespeicherten
realen Gerätecode. Private Bilder und Codewerte werden nicht übernommen.

Dieser Fototest allein prüfte noch keine Neustartpersistenz. Der spätere Neustart
mit `0.1.0b3` ist im folgenden Abschnitt dokumentiert. Weitere Geräte, Abbruchfälle
und der Livevideo-Test über HTTPS bleiben offen.

## Installation und WebKit-Prüfung von 0.1.0b3 auf Home Assistant OS

Am 7. November 2026 wurde die veröffentlichte **0.1.0b3** über den Marketplace auf
dem Zielsystem installiert und Home Assistant neu gestartet. Danach zeigte das
Panel weiterhin **fünf Geräte, davon zwei mit gespeicherten Codes**.

Die tatsächliche HA-Oberfläche wurde anschließend in Safari/WebKit mit einer
Darstellungsgröße von **390 × 844 Pixeln** geprüft: Detailinhalt bis zum Ende
scrollbar, Schließen-Schaltfläche erreichbar und Rückkehr zur Liste erfolgreich.
Dies ist ein Browsertest am laufenden HA-System; die ausdrückliche Bestätigung
des korrigierten Layouts auf dem physischen iPhone steht noch aus.

## Installation und Prüfung von 0.1.0b4 auf Home Assistant OS

Am 10. November 2026 wurde vor dem Update eine **verschlüsselte lokale HA-Sicherung
mit 40,21 MB** erstellt. Anschließend wurde **0.1.0b4** auf dem Zielsystem mit
**HA Core 2026.11.1** installiert und Home Assistant neu gestartet. Danach waren
**neun Geräte, davon sechs mit gespeicherten Codes**, sichtbar. Die verknüpften
Geräte zeigten die übernommenen aktuellen Namen und Räume aus Home Assistant.

In Safari erschien jedoch `codeStored` statt **Gespeichert**: Das neue Panel
verwendete noch eine zwischengespeicherte ältere Übersetzungsdatei. Ein frischer
Abruf dieser Datei enthielt die korrekten Texte. Dieser Befund begrenzt die
Oberflächenabnahme von Beta 4 und ist Anlass für die Cachekorrektur in Beta 5.

Die Sicherung wurde erstellt, aber nicht wiederhergestellt. Dieser Lauf belegt
keinen vollständigen Restore und ersetzt nicht die übrigen noch offenen
Funktions- und Smartphone-Tests. Private Adressen, Gerätenamen, Codewerte und
Sicherungsgeheimnisse werden nicht dokumentiert.

## Direktscan und HTTP

Am 10. November 2026 wurde auf dem Zielsystem ein bereits aktiver Nabu-Casa-
Fernzugang gefunden. Dessen gültige HTTPS-Adresse führte bis zur HA-Anmeldeseite.
Eine Anmeldung in dieser HTTPS-Sitzung sowie die Livekamera-Abnahme auf dem
physischen iPhone stehen noch aus. Dafür ist keine zusätzliche Tailscale- oder
Netzwerkkonfiguration erforderlich. Der Test muss über die HTTPS-Adresse erfolgen;
eine weiterhin verwendete interne HTTP-Adresse stellt keinen sicheren Browserkontext her.

Die vorhandene Browser-Livekamera benötigt HTTPS bzw. einen sicheren Kontext.
Über HTTP bleibt die bestätigte System-Fotoaufnahme verfügbar. Im geprüften
Frontend **20261028.4** und iOS **2026.10.3** bietet Home Assistant keinen unterstützten
öffentlichen Ladeweg zum nativen Scanner für Custom Panels: Die vorhandene
Scanner-Komponente wird nach Bedarf geladen, ihre Ergebnisverteilung ist intern.
Ein allgemeines `show-dialog`-Ereignis lädt sie nicht selbstständig.
Siehe [Scanner-Komponente](https://github.com/home-assistant/frontend/blob/20261028.4/src/components/ha-qr-scanner.ts),
[Ergebnisverteilung](https://github.com/home-assistant/frontend/blob/20261028.4/src/external_app/external_app_entrypoint.ts)
und [Dialogmanager](https://github.com/home-assistant/frontend/blob/20261028.4/src/dialogs/make-dialog-manager.ts).
Die Integration ersetzt keine HA-Nachrichtenhandler. Netzwerkeinstellungen wurden
nicht geändert.

## Noch erforderliche Abnahme im Zielsystem

1. Zugriff als normaler Benutzer im Zielsystem prüfen: Es darf kein Zugriff auf
   die Codes bestehen. Für weitere Installationen gilt die
   [Testinstallation](../README.md#testinstallation); die ursprüngliche Integration
   und ihre Daten bleiben erhalten.
2. Geräte mit Matter und HomeKit sowie ein offline geschaltetes Gerät vorbereiten.
   Bei Matter-Erfassung muss ein Gerät mit gespeichertem HomeKit-Code und fehlendem
   Matter-Code auswählbar bleiben; Speichern ergänzt denselben Inventareintrag.
3. Den Original-QR eines eigenen Geräts per Smartphone-Kamera und Bildauswahl
   erfassen. Safari/iOS, Android und gegebenenfalls die HA-Companion-App getrennt
   prüfen. Die erste Fotoaufnahme auf dem Ziel-iPhone mit `0.1.0b2` ist bestätigt;
   **Foto aufnehmen** und **Foto auswählen** über HTTP weiterhin getrennt prüfen,
   einschließlich Rückkehr aus dem Systemdialog, Abbruch,
   erneuter Auswahl desselben Fotos und Wechsel zu manueller Eingabe. Livevideo
   über HTTPS sowie Kameraverweigerung gesondert prüfen. Titel und Schließen-Schaltfläche
   müssen auch auf Geräten mit oberem Bildschirmausschnitt erreichbar bleiben.
   Bei `0.1.0b3` zusätzlich lange Gerätedetails bis zum Ende scrollen, einen Code
   anzeigen und die erhaltene Scrollposition sowie Schließen und Rückkehr zur Liste prüfen.
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

Offen sind Export/Import im Zielsystem, ein vollständiger HA-Restore, die
Cachekorrektur aus `0.1.0b5` und die weiteren Smartphone-/Companion-App-Abnahmen
einschließlich HTTPS-Livekamera, Detail-Layout und verbleibender Funktionen aus
`0.1.0b4` auf dem physischen iPhone. Ein automatisierter
Decoder-Test belegt die Erkennung der Testbilder, nicht die Qualität aller realen
Kameras, Ausdrucke und Lichtverhältnisse.

## Ergebnis der früheren lokalen Prüfung am 7. November 2026

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
