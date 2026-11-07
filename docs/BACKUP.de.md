# Sicherung und Wiederherstellung

Stand der Quellenprüfung: 7. November 2026, Home Assistant 2026.11.

## Reguläre Home-Assistant-Sicherung

Setup Code Manager speichert sein Inventar in
`<Home-Assistant-Konfiguration>/.storage/setup_code_manager`. Die Datei enthält
aktive und archivierte Geräte, Codes, optionale HA-Verknüpfungen, Herkunftsangaben,
die eigene Installationskennung und den Bearbeitungsstand. Auch lokale
Einstellungen zur unterdrückten Wiedererkennung ausdrücklich gelöschter Geräte
liegen im Store.

Eine Home-Assistant-Sicherung, die **Home-Assistant-Einstellungen beziehungsweise
den Konfigurationsordner** enthält, erfasst diese Ablage. Automatische Sicherungen
enthalten laut Home Assistant die Einstellungen. Bei einer gezielten Sicherung
einer einzelnen App ohne HA-Konfiguration ist das Inventar nicht enthalten.
Die Sensordatenbank muss für das Inventar nicht mitgesichert werden.
[Offizielle Beschreibung des Sicherungsumfangs](https://www.home-assistant.io/common-tasks/general/backups).

`.storage` ist der reguläre interne Datenbereich von Home Assistant. Seine
Dateien sollten nicht während des Betriebs von Hand bearbeitet werden.
[Speicherarchitektur von Home Assistant](https://contributors.home-assistant.io/architecture/core/registries/).

Der aktuelle Store schreibt die vollständige Datei atomar und übernimmt den neuen
Inhalt erst nach erfolgreichem Schreiben in den Arbeitsspeicher. Es gibt keine
verzögerte Schreibwarteschlange. Vor einer bewusst gestarteten Sicherung die
Speicherbestätigung der letzten Änderung abwarten. Ein parallel startender
Sicherungslauf kann den vorherigen oder den neuen vollständigen Dateistand
erfassen; er ist keine Zusage über noch laufende Eingaben.

Zur technischen Gegenprüfung wurde der lokal installierte Backup-Code von Home
Assistant 2026.11.0 gelesen: Er archiviert den Konfigurationsordner; seine
Ausschlussliste enthält diese `.storage`-Datei nicht. Das ersetzt keinen
Wiederherstellungstest auf dem Zielsystem. Ein eigener Cloud-Backup-Agent ist für
die Aufnahme dieser Datei nicht erforderlich. Falls später gepufferte Daten oder
mehrere zusammengehörende Dateien hinzukommen, stehen
[Vorbereitungs- und Abschlussfunktionen für Backups](https://contributors.home-assistant.io/core/integrations/backup/)
zur Verfügung.

## Export der Geräteliste

**JSON** ist das vollständige, versionierte Austauschformat für das Inventar.
Es enthält auch archivierte und noch nicht verknüpfte Geräte. **CSV** verwendet
ein festes, versioniertes Schema mit einer Metadatenzeile und je einer Zeile pro
Code; Geräte ohne Code erhalten ebenfalls eine Zeile. Alle Datenzellen tragen
ein reversibles Apostroph-Präfix. Der Import entfernt genau dieses Präfix, damit
führende Nullen, Umlaute, Zeilenumbrüche und formelähnlicher Text erhalten bleiben.
Beim Bearbeiten in Tabellenprogrammen muss dieses Format erhalten bleiben.

Beide Exporte enthalten die Einrichtungscodes im Klartext. Sie gehören an einen
geschützten Ablageort. Eine CSV- oder JSON-Datei ersetzt keine vollständige
Home-Assistant-Sicherung. Lokale Einstellungen zur Wiedererkennung gelöschter
HA-Geräte werden nur mit der HA-Konfiguration gesichert, nicht mit dem
portablen Listenexport.

## Zwei Wiederherstellungswege

1. **Gesamtes Home Assistant wiederherstellen:** Die HA-Konfiguration einschließlich
   Geräte-Registry und Inventardatei gemeinsam aus der Sicherung zurückholen.
   Anschließend Integration, Liste, Archiv und Verknüpfungen prüfen. Die installierte
   Integration muss die gespeicherte Datenversion unterstützen.
2. **Frisches Home Assistant, nur Inventar übernehmen:** Setup Code Manager
   installieren und JSON oder CSV importieren. Bei einer abweichenden
   Installationskennung werden alte HA-Verknüpfungen entfernt; Geräte und Codes
   bleiben erhalten. Anschließend passende Geräte neu zuordnen. Ein Listenimport
   stellt weder Matter-Kopplungen noch Automationen oder die alte Geräte-Registry
   wieder her.

Der Import zeigt neue, unveränderte, widersprüchliche und ungültige Einträge vor
der Übernahme. Wiederholte unveränderte Importe erzeugen keine Dubletten.
Vorhandene Daten werden nicht ungefragt ersetzt. Die lokale Migration aus
`.storage/setup_codes` liest die Originaldatei ausschließlich; diese bleibt als
Ausgangsstand erhalten.

## Abnahme vor einem produktiven Einsatz

Die automatisierten Tests prüfen Dateischreiben und Daten-Rundläufe separat.
Ein vollständiger HA-Backup-/Restore-Lauf auf dem vorgesehenen Zielsystem ist
noch als praktische Abnahme durchzuführen:

1. Testgeräte mit mehreren Codearten, Notizen, führenden Nullen und Archivstatus
   anlegen; mindestens ein Gerät ohne HA-Verknüpfung einschließen.
2. Speichern, Home Assistant neu starten und die Einträge prüfen.
3. Eine HA-Sicherung einschließlich Einstellungen erstellen und deren erfolgreichen
   Abschluss prüfen.
4. In einer getrennten Testinstallation wiederherstellen und Inhalt sowie
   Verknüpfungen vergleichen.
5. Zusätzlich den JSON-/CSV-Import in einer frischen Installation prüfen:
   vollständiger Inhalt, keine ungeprüften alten Verknüpfungen, keine Dubletten
   beim zweiten Import.

Der erfolgreiche Export allein belegt keine erfolgreiche vollständige
Wiederherstellung von Home Assistant.
