# Filtern, Ansichten und Codepflege

## Suche und Filter

Die Suche berücksichtigt Gerätenamen, Räume, Hersteller, Modell, Seriennummer,
Notizen, Codebeschreibungen, QR-Inhalte und manuelle Codes. Dazu gehört der aus
Matter-QRs berechnete Zahlencode. Bei numerischen Codes sind Leerzeichen und
Bindestriche optional; führende Nullen bleiben erhalten.

**Filter** öffnet die Auswahl für Raum, Protokoll und Codestatus. Die Liste reagiert
sofort. Die Zahl am Button zählt aktive Filterbedingungen, nicht den Suchtext.
Raum- oder Etagenauswahl öffnen sich erst beim Antippen des jeweiligen Felds.
Nach einer Auswahl bleibt der Filterbereich offen, ohne die Auswahl erneut zu öffnen.
Nach dem Schließen bleiben aktive Bedingungen sichtbar und einzeln entfernbar.
**Filter zurücksetzen** leert Suche und Filter; Ansicht, Sortierung und Gruppierung
bleiben erhalten.

Unter **Weitere Filter & Gruppierung** stehen Etagen, direkte HA-Gerätelabels und
Raumgruppen bereit. Diese Metadaten kommen aus aktiven HA-Verknüpfungen. Labels an
Bereichen oder einzelnen Entitäten werden nicht zusätzlich übernommen. Entfernte
und unabhängige Einträge haben keine aktuelle HA-Etage und keine HA-Labels; der
zuletzt bekannte Raum bleibt als Raumfilter erhalten. HA-Änderungen aktualisieren
die Listen, ohne Etagen oder Labels in die Inventardatei zu kopieren.

Bei gewähltem Protokoll bezieht sich **Code vorhanden / Code fehlt** auf dieses
Protokoll. **Kinderzimmer + Matter + Code fehlt** kann deshalb Geräte mit einem
HomeKit-Code anzeigen. Ein fehlender Code ist kein Nachweis dafür, dass ein Gerät
das gewählte Protokoll unterstützt.

## Sortieren und gruppieren

Die Sortierung bleibt direkt neben der Suche erreichbar:

- Name A–Z oder Z–A.
- Raum, mit Einträgen ohne Raum am Ende.
- Zuletzt geändert, mit den neuesten Änderungen zuerst.
- Fehlende Codes zuerst, bezogen auf das gewählte Protokoll.

Die Raumgruppierung lässt sich unabhängig davon ein- und ausklappen. Jeder Eintrag
erscheint genau einmal. Geräte mit mehreren HA-Räumen erhalten eine eigene Gruppe
**Mehrere Räume**; Raumnamen mit einem Schrägstrich werden nicht zerlegt.

## Ansichten speichern

Unter **Filter → Gespeicherte Ansichten** einen Namen eingeben und **Ansicht
speichern** wählen. Eine Ansicht merkt sich die gewählte Registerkarte, Filter,
Sortierung und Gruppierung. Suchbegriffe, Notizen, Codes und Inventarkopien werden
nicht gespeichert. Beim Anwenden einer Ansicht wird die Suche geleert.

Eine gespeicherte Ansicht auswählen und **Als Standard verwenden** wählen, damit
sie beim Öffnen automatisch geladen wird. **Standard aufheben** entfernt nur diese
Voreinstellung; die gespeicherte Ansicht bleibt erhalten. Automatische
HA-Aktualisierungen überschreiben zwischenzeitlich geänderte Filter nicht.
Beim Löschen der Standardansicht wird auch die Voreinstellung entfernt.

Bis zu 20 Ansichten lassen sich speichern, aktualisieren und entfernen. Die
Ansichten und ihr Standard werden in Home Assistant für dein angemeldetes HA-Konto
gespeichert. Mit demselben Konto stehen sie auch auf anderen Browsern und Geräten
derselben HA-Installation zur Verfügung. Andere HA-Konten haben eigene Ansichten.
Bei einem Kontowechsel werden die vorherige Suche und Filterauswahl zurückgesetzt;
ohne eigenen Standard startet das neue Konto mit den normalen Listeneinstellungen.

Beim ersten Öffnen übernimmt die App bisherige lokale Ansichten samt Standard,
wenn für das Konto noch nie zentrale Ansichten gespeichert wurden. Die lokale
v1-Sicherung bleibt unverändert im Browser. Ein bewusst geleerter zentraler
Katalog wird nicht automatisch aus dieser Sicherung wieder gefüllt. Existieren
bereits zentrale Ansichten, können zusätzliche lokale Ansichten über **Lokale
Ansichten übernehmen** hinzugefügt werden. Bestehende zentrale Einträge und der
zentrale Standard werden dabei nicht ersetzt. Wegen des Limits nicht übernommene
Ansichten bleiben lokal erhalten.

Bei gleichzeitigen Änderungen auf mehreren Geräten wird ein veralteter
Speicherversuch abgelehnt und der aktuelle Katalog geladen. Die Änderung prüfen
und bei Bedarf erneut speichern. Ist der Kontospeicher nicht verfügbar, bleiben
die gespeicherten Ansichten schreibgeschützt; die Geräteliste ist weiter nutzbar.
Ansichten gehören zur HA-Konfigurationssicherung, nicht zum JSON-/CSV-Inventarexport.

## Ausgewählte Einträge exportieren

**Auswählen** aktiviert die Markierungen in der Geräteliste. **Alle Treffer
markieren** wählt alle zur aktuellen Suche und den Filtern passenden Einträge,
auch in eingeklappten Raumgruppen. Eine Änderung von Suche, Filtern oder
Registerkarte hebt die Auswahl auf; Sortieren und Gruppieren erhalten sie.

Im Exportdialog stehen drei Umfänge bereit:

- Alle Einträge einschließlich Archiv.
- Aktuelle Treffer.
- Markierte Einträge.

Die beiden begrenzten Umfänge werden beim Öffnen des Dialogs festgehalten.
Wird ein gewählter Eintrag zwischenzeitlich entfernt, wird kein unvollständiger
Export und kein unbeabsichtigter Gesamtexport erstellt. Liste aktualisieren und
erneut auswählen. JSON und CSV behalten das vorhandene Austauschformat und sind
auch als Teilbestand wieder importierbar. Einrichtungscodes sind in den Dateien
lesbar. Ein Teilbestand ersetzt keine vollständige Inventarsicherung.

## Gerätekarten als PDF herunterladen

In den Gerätedetails **Gerätekarte als PDF** wählen. Für mehrere Geräte über
**Auswählen → Gerätekarten als PDF** gehen; im Menü steht dieselbe Funktion für
die aktuellen Treffer bereit. Die Bestätigung zeigt den gewählten Umfang mit
1 bis 100 Geräten. **Notizen mit ausgeben** ist zunächst ausgeschaltet.
Anschließend **PDF erstellen** wählen. Der Download startet direkt, ohne Popup
oder Browser-Druckdialog. Die heruntergeladene Datei lässt sich anschließend
speichern, teilen oder mit einer PDF-App drucken.

Die PDF enthält Namen, Raum, Gerätemetadaten, gespeicherte Codes und darstellbare
Original-QRs. Der manuelle Matter-Code steht getrennt beim Original-QR. Aus bloßen
Zahlencodes werden keine neuen Kopplungs-QRs erzeugt. Sehr lange QR-Inhalte können
statt als QR vollständig als Text erscheinen; die PDF weist darauf hin.

Die gewählten Geräte werden beim Öffnen der Bestätigung festgehalten. Die PDF
verwendet beim Erstellen die aktuellen Daten dieser Geräte aus Home Assistant.
Wird ein Gerät zwischenzeitlich entfernt, entsteht keine unvollständige PDF und
kein unbeabsichtigter Gesamtexport. Den Dialog schließen, die Liste aktualisieren
und erneut auswählen.

Die Erzeugung läuft lokal in Home Assistant, ohne externe Schrift-, Bild- oder
QR-Dienste. Sie ändert weder Inventar noch Codes und legt auf dem HA-Server keine
PDF-Datei ab. Pro Ausgabe gelten höchstens 8 MiB, 300 Seiten und insgesamt
250.000 Textzeichen. Bei einer zu großen Auswahl bleibt der Dialog erhalten:
weniger Geräte wählen oder Notizen weglassen. Inhalte werden nicht still gekürzt.

Auf dem iPhone die PDF im Download-/Teilen-Dialog über **Teilen → In Dateien
sichern** ablegen. Die geprüfte HA-iOS-App 2026.10.3 unterstützt ab iOS 17 den
[nativen Downloadweg](https://github.com/home-assistant/iOS/blob/release/2026.10.3/2026.3322/Sources/App/Frontend/WebView/WebViewController/WebViewController+WebKitDelegates.swift#L128-L135)
und ein [Teilen-Menü](https://github.com/home-assistant/iOS/blob/release/2026.10.3/2026.3322/Sources/App/Frontend/DownloadManager/DownloadManagerView.swift#L79-L105).
Die App hält die Datei zunächst temporär; vor dem Schließen an den gewünschten
Ort sichern. Diese Unterstützung ist im Quellcode geprüft; die praktische Abnahme
des PDF-Downloads auf dem physischen Ziel-iPhone steht noch aus.

**PDF erstellt. Download gestartet.** bestätigt nur den gestarteten Download,
nicht das endgültige Speichern auf deinem Gerät. Die Datei enthält lesbare
Einrichtungscodes. Sie ist kein importierbares Inventarbackup; dafür weiterhin
JSON/CSV und die HA-Sicherung verwenden.

## Fehlende Codes nacheinander erfassen

**Codes ergänzen** beziehungsweise das entsprechende Menü am Handy öffnet die
geführte Erfassung. Protokoll auswählen und **Erfassung starten** wählen. Raum,
Etage, Label, Suchtext und aktuelle Registerkarte begrenzen die Kandidaten; der
bisherige Protokoll- und Codestatusfilter wird für diesen Vorgang ersetzt.
Archivierte Einträge werden ausgelassen.

Für jedes Gerät einen Code per Kamera, Foto oder Tastatur ergänzen und **Speichern
& weiter** wählen. **Überspringen** ändert das Gerät nicht. Ein anderer QR-Typ wird
mit einer verständlichen Meldung abgelehnt. Änderungen an anderen vorhandenen Codes
werden weiterhin geprüft; bereits vorhandene Codes werden nicht automatisch ersetzt.

Erst nach erfolgreichem Speichern und Aktualisieren geht es weiter. Bei Fehlern
bleibt die Eingabe erhalten. Wurde gespeichert, aber die anschließende Aktualisierung
schlägt fehl, endet die Erfassung mit einem Hinweis zum erneuten Laden. Ein im
Hintergrund aktualisierter, inzwischen vollständiger Eintrag wird übersprungen.
**Beenden** stoppt den Vorgang; ungespeicherte Änderungen benötigen eine Bestätigung.
