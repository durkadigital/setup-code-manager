# Setup Code Manager — Funktions- und Datenkonzept

Stand: 7. November 2026. Vorschlag zur Durchsicht; noch nicht implementiert.

## Ziel und erster Umfang

Eine lokale Home-Assistant-Integration bewahrt Geräte und ihre Einrichtungscodes
dauerhaft auf. Eine Verbindung zu einem eingerichteten HA-Gerät ist optional.
Die erste Version umfasst:

- Vorhandene Matter-, HomeKit- und Z-Wave-Geräte aus HA übernehmen.
- Geräte unabhängig von HA manuell anlegen; Einträge ohne Code erlauben.
- Matter-QR per Livekamera oder Bilddatei lokal auslesen und speichern.
- Bestehende Eingabe, Prüfung und QR-Anzeige für HomeKit und Z-Wave erhalten.
- Einträge bearbeiten, verknüpfen, archivieren und ausdrücklich löschen.
- JSON-Sicherungen und CSV-Tabellen exportieren und kontrolliert importieren.
- Originaldaten aus Setup Codes übernehmen und reguläre HA-Backups unterstützen.
- Deutsche und englische Bedienoberfläche; HA-Farben, Hell-/Dunkelmodus und mobile Nutzung.

Nicht im ersten Umfang: automatische Gerätekopplung, OCR gedruckter Ziffern,
Cloudkonto, externe Bildanalyse oder eine separate Smartphone-App.

## Inventar und Status

Ein Inventareintrag beschreibt ein physisches Gerät und erhält eine eigene,
dauerhafte UUID. Er kann mehrere nach Protokoll getrennte Einrichtungscodes
und HA-Verknüpfungen besitzen. Bestehende Einträge werden niemals allein wegen
gleicher Namen, Modelle, Seriennummern oder Codes automatisch zusammengeführt.
Bei der Übernahme bleiben zweifelhafte Zuordnungen zunächst getrennt.

| Zustand | Bedeutung und Verhalten |
| --- | --- |
| Verknüpft | Mindestens eine bestätigte Zuordnung zu einem vorhandenen HA-Gerät. Erreichbarkeit separat anzeigen. |
| Nicht verknüpft | Keine aktive Zuordnung; auch noch nie eingebundene Geräte sind erlaubt. |
| Archiviert | Bewusste Nutzerentscheidung; unabhängig von der Verknüpfung. Aus aktiven Ansichten ausgeblendet. |

Wird ein HA-Gerät entfernt, entfällt die betreffende aktive Verknüpfung.
Inventareintrag, Codes, eigene Angaben und letzte bekannte HA-Daten bleiben erhalten.
Bei mehreren Verknüpfungen bleibt der Eintrag verknüpft, solange mindestens eine
gültig ist. Ein Offline-Gerät gilt nicht als entfernt. Eine spätere Synchronisation
hebt eine Archivierung nicht auf. Endgültiges Löschen erfordert eine eigene Bestätigung.

## Gespeicherte Angaben

| Bereich | Angaben |
| --- | --- |
| Inventar | Eigene UUID, Name, Hersteller, Modell, Seriennummer, Standort als Text, Notiz, Archivstatus, Zeitstempel |
| Codes | Eigene Code-ID, Protokoll, Original-QR-Inhalt oder eingegebener Zahlencode, gegebenenfalls abgeleiteter Zahlencode, Herkunft |
| HA-Bezug | Optional bestätigte HA-Geräte-IDs, Installationsbezug, Protokoll und letzter bekannter Geräte-/Raumstand |
| Herkunft | Bei Importen Quellsystem, Export-/Datensatz-ID und ursprüngliche ID zur Wiedererkennung |

Eigene Angaben und zuletzt bekannte HA-Metadaten werden getrennt behandelt.
Eine Synchronisation überschreibt keine selbst bearbeiteten Namen oder Notizen.
Der gespeicherte Standort bleibt bei gelöschten HA-Bereichen oder einem Umzug lesbar.
HA-interne IDs sind Zuordnungshinweise, keine installationsübergreifende Identität.

## Scan und Codepflege

„Gerät hinzufügen“ bietet Scan, Bildauswahl und manuelle Eingabe. Beim bestehenden
Eintrag ist das Ziel bereits gewählt. Nach Erkennung werden Protokoll und Code
geprüft; der Nutzer ergänzt einen Namen und wählt optional ein HA-Gerät.
Ein Scan speichert erst nach Bestätigung und löst keine Kopplung aus.

Der QR-Rohinhalt bleibt erhalten. Zahlen werden als Text gespeichert, damit führende
Nullen bestehen bleiben. Ein unterschiedlicher vorhandener Code wird nicht still
ersetzt. Gleiche Codes erzeugen einen Dublettenhinweis, beweisen aber keine Identität.
Für das dauerhafte Archiv ist der Originalcode vom Gerät oder Beileger vorgesehen;
zeitlich begrenzte Freigabecodes ersetzen ihn nicht.

Der Decoder wird lokal mitgeliefert. Kein Bild und kein Code wird zur Erkennung an
einen externen Dienst gesendet. Livekamera benötigt im Browser einen sicheren Kontext
und Kamerafreigabe; HTTP, verweigerte Freigabe und fehlende Kamera führen zu den
Alternativen Bildauswahl und Eingabe. Nach Schließen des Scanners wird die Kamera beendet.
Die Companion-Apps und mobilen Browser brauchen getrennte Gerätetests.

## Import und Export

**JSON** ist das vollständige, versionierte Sicherungsformat. Standardmäßig werden
alle Einträge einschließlich Archiv, Codes, Metadaten, eigenen IDs und Herkunft
exportiert. Nur Zuordnungshinweise werden übertragen; ein Listenimport stellt
weder Matter-Verbindungen noch Automationen oder HA-Geräte wieder her.

**CSV** ist das Tabellenformat. Eine Zeile pro Code, gruppierbar über `record_id`;
Einträge ohne Code bekommen eine Zeile mit leeren Codefeldern. Die Spalten enthalten
Formatversion, Eintrags-/Code-ID, Name, Protokoll, Codeform, Rohcode, Hersteller,
Modell, Seriennummer, Standort, Notiz und Archivstatus. HA-interne Verknüpfungen
werden nicht über CSV wiederhergestellt. Genaues Schema und reversible Behandlung
potenzieller Tabellenformeln werden vor Implementierung in einer Formatspezifikation festgelegt.
Beim Öffnen in Tabellenprogrammen müssen Codes und IDs als Text behandelt werden;
JSON bleibt das maßgebliche Format für vollständige Sicherungen.

Der Import prüft Datei, Version, Größenlimits, Struktur und Codeformate vor einer
Änderung. Die Vorschau zeigt neue, unveränderte, konfliktbehaftete und ungültige
Einträge. Ungültige Zeilen können ausdrücklich übersprungen werden; ohne bestätigte
gültige Auswahl wird nichts gespeichert. Ein unbekanntes Format wird abgewiesen.

Standard: ergänzen und identische Einträge überspringen. Konflikte brauchen eine
ausdrückliche Entscheidung „Vorhandenen behalten“ oder „Importierten übernehmen“.
Kein automatisches „neuester Zeitstempel gewinnt“ und kein ersetzender Gesamtimport
in Version 1. Wiederholte Importe mit stabilen IDs erzeugen keine neuen Einträge.
CSV ohne IDs nutzt eine reproduzierbare Herkunftsreferenz für unveränderte Zeilen;
geänderte oder mehrdeutige Zeilen brauchen eine Zuordnung statt einer stillen Fusion.

Die bestätigte Auswahl wird als ein konsistenter Schreibvorgang übernommen.
Bei Speicherfehlern entsteht keine teilweise importierte Liste. Vor der Übernahme
wird geprüft, ob sich seit der Vorschau betroffene Einträge geändert haben.

## Neuinstallation und Übernahme aus dem Original

Beim Import in eine neue HA-Installation bleiben Einträge zunächst unabhängig.
Alte Geräte-IDs werden nicht blind als gültige Verknüpfungen behandelt. Wiedererkennung
liefert Vorschläge; unsichere Zuordnungen bestätigt der Nutzer.

Für die Übernahme liest ein eigener Migrationsdialog `.storage/setup_codes`
ausschließlich lesend und zeigt die Einträge in einer Vorschau. Das Original und
seine Daten bleiben bestehen. Quellsystem und Original-ID ermöglichen wiederholbare
Übernahme ohne Dubletten. Bei mehreren Quellen kommt der Installationsbezug hinzu.
„Removed“ bedeutet „Nicht verknüpft“, nicht „Archiviert“. Codefreie Einträge bleiben
auswählbar. Mehrere Originalzeilen eines physischen Geräts werden nicht ungefragt verschmolzen.

## Speicherung, Zugriff und Backup

Versionierter Home-Assistant-Store unter `.storage/setup_code_manager`.
Migrationen müssen ältere Dateiversionen verlustfrei übernehmen. Nutzdaten werden
außerhalb des austauschbaren Integrationsordners gespeichert. Ein Speichervorgang
wird erst nach erfolgreicher dauerhafter Ablage als erfolgreich gemeldet.

Panel und sämtliche Datenoperationen bleiben auf HA-Administratoren beschränkt.
Codes gehören weder in Logs/Diagnosedaten noch in das Git-Repository. Die Übersicht
zeigt zunächst „Code gespeichert“; vollständige Codes sind bewusst in den Details
abrufbar. CSV und unverschlüsseltes JSON enthalten lesbare Codes und werden beim
Export entsprechend bezeichnet. Anwendungseigene Verschlüsselung wird nicht behauptet.

HA-Backups mit Konfiguration sollen den Store einschließen. Vor Release wird eine
echte Sicherung und Wiederherstellung geprüft. Falls Schreibvorgänge verzögert werden,
müssen sie vor dem Backup abgeschlossen werden. Browserdaten sind kein dauerhafter Speicher.

## Umsetzung nach Konzeptabstimmung

1. Eigenständige Kennung, Titel, Metadaten und Datenmigration vorbereiten.
2. Inventarmodell, unabhängige Einträge, Verknüpfungen und Archiv umsetzen.
3. Mobile Details und Matter-Scanner einschließlich Bild-Fallback ergänzen.
4. Versionierte JSON-/CSV-Formate, Vorschau und Import ergänzen.
5. Originalmigration, Berechtigungen, Backup/Restore und Browser testen.
6. Dokumentierte Testversion über eigene Repository-Adresse veröffentlichen.
7. Nach stabiler Version Katalogaufnahme beantragen.

## Wesentliche Abnahmefälle

- Gerät ohne HA anlegen, Code speichern, HA neu starten: Eintrag bleibt erhalten.
- Später verknüpfen: kein zusätzlicher Inventareintrag nötig.
- HA-Gerät löschen: Codes und Metadaten bleiben; Offline allein löst keine Trennung aus.
- Archivieren und synchronisieren: Archivstatus bleibt bestehen.
- Matter und HomeKit am selben Inventareintrag: beide Codes bleiben getrennt erhalten.
- Scan über HTTPS sowie HTTP-/Berechtigungs-/Dateifallback auf iPhone und Android prüfen.
- Falscher, unlesbarer, mehrfach enthaltener oder bereits gespeicherter QR: klare Auswahl/Fehler.
- JSON zweimal importieren: keine Dubletten; abweichende Inhalte benötigen Entscheidung.
- Führende Nullen, Umlaute, Kommas, Zeilenumbrüche und Formelfelder über Export/Import prüfen.
- Beschädigte Datei, neuere Formatversion und parallele Änderung: keine stillen Teilimporte.
- Originaldaten zweimal übernehmen: keine Dubletten und unveränderte Quelldatei.
- Frisches HA: Daten nutzbar, alte Zuordnungen nicht blind übernommen.
- Vollständiger HA-Restore: aktive/archivierte Einträge, Codes und Verknüpfungen prüfen.
- Nicht-Administrator: Zugriff auch über direkte API-Aufrufe abgewiesen.

## Quellen

- [Originalprojekt](https://github.com/PhantomPhoton/Setup-Codes)
- [Home-Assistant-Backups](https://www.home-assistant.io/common-tasks/general/backups)
- [HA-Speicherarchitektur](https://contributors.home-assistant.io/architecture/core/registries/)
- [Browser-Kamerazugriff](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
- [Matter in Home Assistant](https://www.home-assistant.io/integrations/matter/)
- [Katalogaufnahme](https://contributors.home-assistant.io/marketplace/guides/catalog/)
