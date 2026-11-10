# Ausbauplan und Umsetzung

Stand: 10. November 2026. Dieser Plan beschreibt den freigegebenen Ausbau nach
Beta 7. Der Implementierungsstand ist von Veröffentlichung und Abnahme im
Zielsystem zu unterscheiden.

| Schritt | Umsetzung | Abnahme |
| --- | --- | --- |
| Filter-Dropdown | Suche und Sortierung sichtbar; Filterzahl, entfernbare Bedingungen, kompakter Filterbereich, erweiterte Optionen einklappbar | Desktop/Mobil, Tastatur, Fokus, Platzierung und kein horizontales Überlaufen |
| Sortierung und Raumgruppen | Name, Raum, letzte Änderung, fehlende Codes; eindeutige aufklappbare Raumgruppen | Stabile Reihenfolge, Mehrfachräume ohne doppelte Einträge, unveränderte Daten |
| Gespeicherte Ansichten | Browserlokal nach HA-Instanz und Konto, maximal 20; nur strukturierte Auswahlwerte | Neuladen, gesperrter Speicher, beschädigte Daten, keine Suche/Codes im gespeicherten Inhalt |
| Gezielter Export | Gesamtbestand, eingefrorene Treffer oder markierte IDs, JSON/CSV im bisherigen Format | Exakte Teilbestände einschließlich Archiv, Import-Roundtrip, Adminschutz und Fehler statt ungewolltem Gesamtexport |
| Druckbare Gerätekarte | Lokale Original-QRs und manuelle Codes, optionale Notizen, Browser-Druckdialog | Layout, QR-Rücklesen, keine externen Ressourcen, Fensterblockade/Abbruch und keine falsche Erfolgsmeldung |
| Geführte Code-Erfassung | Fehlende Codes pro Protokoll nacheinander, Speichern/Weiter/Überspringen/Beenden | Keine leeren oder falschen Protokollschritte, Konflikte, Aktualisierungsfehler und verspätete Antworten |
| Etagen und HA-Labels | Aktuelle Metadaten aus aktiven Verknüpfungen, direkte Gerätelabels | Registry-Änderungen, entfernte Geräte, unverändertes Speicher-/Exportformat |

Alle sieben Schritte sind für **0.1.0b8** implementiert und lokal geprüft. Der
[versionsbezogene Teststand](TESTING.de.md) nennt die Ergebnisse und Grenzen.
Die [Bedienungsanleitung](USAGE.de.md) dokumentiert Umfang und Verhalten.

Die nächsten Freigabeschritte sind GitHub-Prüfungen des genauen Commits,
Veröffentlichung der Vorabversion, Installation mit HA-Neustart und Prüfung im
Zielsystem. Ein physischer Druck, ein PDF-Export im Zielbrowser, iPhone-Livekamera
und ein vollständiger HA-Restore sind eigene praktische Abnahmen. Es werden keine
Netzwerk-, HTTPS- oder Cloudänderungen für diesen Ausbau benötigt.
