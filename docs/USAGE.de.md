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
Bereits gespeicherte Ansichten bleiben erhalten und können direkt zum Standard
gemacht werden. Beim Löschen der Standardansicht wird auch die Voreinstellung entfernt.

Bis zu 20 Ansichten lassen sich speichern, aktualisieren und entfernen. Die
Ansichten und ihr Standard gelten für die HA-Instanz und das angemeldete HA-Konto
in diesem Browser.
Ein anderer Browser oder eine andere HA-Adresse hat einen eigenen Browser-Speicher.
Die Ansichten sind nicht Teil eines Inventarexports oder HA-Backups. Ein gesperrter
Browser-Speicher verhindert nur das Speichern von Ansichten, nicht die Codepflege.

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

## Gerätekarten drucken

Eine Gerätekarte lässt sich in den Gerätedetails öffnen. Mehrere Karten werden
über **Auswählen → Gerätekarten drucken** vorbereitet; am Handy steht die Funktion
auch im Menü für die aktuellen Treffer bereit. Pro Vorgang sind bis zu 100 Geräte
möglich. Notizen werden nur nach ausdrücklicher Auswahl mit ausgegeben.

Die gesonderte Druckansicht enthält Namen, Raum, Gerätemetadaten, gespeicherte Codes
und darstellbare Original-QRs. Der manuelle Matter-Code steht getrennt beim
Original-QR. Aus bloßen Zahlencodes werden keine neuen Kopplungs-QRs erfunden.
Die Erzeugung erfolgt lokal ohne externe Schrift-, Bild- oder QR-Dienste.

Im Browser-Druckdialog Drucker und Papierformat wählen beziehungsweise als PDF
sichern, sofern das Drucksystem dies anbietet. Blockiert der Browser das zusätzliche
Fenster, zeigt die App eine entsprechende Meldung. Die App erhält keine verlässliche
Bestätigung, ob tatsächlich gedruckt, als PDF gespeichert oder abgebrochen wurde.
Gerätekarten enthalten lesbare Einrichtungscodes.

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
