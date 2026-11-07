# Setup Code Manager — visuelle Entwürfe

Stand: 7. November 2026. **Statische Designvorschläge zur Abstimmung.**
Die visuelle Gestaltungsrichtung wurde vom Nutzer bestätigt. Ergänzend wurde eine
direkte Auswahl von HA-Geräten ohne passenden gespeicherten Code festgelegt;
dieser Picker ist im [Bildschirmkonzept](../SCREENS.de.md) beschrieben.
Die Bilder zeigen keine implementierte oder getestete Home-Assistant-Oberfläche.
Eine klickbare Vorschau und die eigentliche Integration sind noch nicht umgesetzt.
Diese Entwürfe sind zunächst lokal gespeichert, noch nicht auf GitHub übertragen.

## Ansichten

1. [Geräteübersicht mit geöffneten Details](overview-v1.png)
2. [Mobiler Scan und anschließendes Erfassen](mobile-scan-v1.png)
3. [Importvorschau mit Code-Konflikt](import-v1.png)

## Gestaltungsrichtung

- Home-Assistant-Rahmen mit vertrautem Blau, weißer Oberfläche und grauem Hintergrund.
- Kompakte Tabelle auf dem Desktop und ein separater Detailbereich.
- Verknüpfung und Erreichbarkeit sind getrennte Informationen.
- Protokollcodes stehen als einzelne Bereiche im Gerät; in der Liste bleiben Codes verdeckt.
- Hauptaktion „Gerät erfassen“ verdeutlicht den Unterschied zum Einbinden eines HA-Geräts.
- Mobiler Scan bietet Fotoauswahl und Eingabe; vor Speichern folgt ein kurzes Formular.
- Optionale Hersteller-/Modelldaten und Notizen befinden sich unter „Weitere Angaben“.
- Beim Import werden neue, vorhandene und abweichende Einträge vor einer Übernahme gezeigt.

## Für eine spätere klickbare Vorschau

Die Gestaltung soll HA-Themenvariablen und vorhandene Bedienelemente verwenden.
Zielwerte für den hellen Entwurf: Hintergrund `#f5f5f5`, Oberfläche `#ffffff`,
Haupttext `#212121`, Akzent `#03a9f4`, Schrift passend zur HA-Oberfläche.
Am Desktop werden Geräteübersicht und Details nebeneinander gezeigt; auf kleinen
Bildschirmen öffnen sich Details und Formulare als eigene volle Ansicht.

Alle/Verknüpft/Nicht verknüpft beziehen sich auf Einträge außerhalb des Archivs.
Im Bild erklärt „Geräte ohne Archiv“ diesen Vorschlag; die endgültige Bezeichnung
ist Teil der Abstimmung. Eine im Bild gezeigte Kamera-/Blitzfunktion ist vor der
Implementierung je Browser auf Verfügbarkeit zu prüfen.

## Prüfung der Bildentwürfe

Visuell auf Lesbarkeit, Hierarchie, Farben, Abstände, getrennte Statusangaben und
den Ablauf Scan → Prüfen → Speichern geprüft. Geräte und Codes sind illustrative
Beispiele. Der abgebildete QR-Code ist kein verwendbarer Testdatensatz.
Die Bilder ersetzen keine Browser-, Kamera-, Import- oder Barrierefreiheitstests.

Bildgenerierung kann Details wie HA-Seitenleisten und einzelne Icons zwischen
Ansichten variieren. Diese Bereiche sind Kontext, keine Vorgabe zur Änderung der
Home-Assistant-Navigation. Im Importbild steht „Überspringen“ für eine feste Aktion
bei identischen Einträgen; die dabei gezeichneten leeren Kästchen sind keine
zusätzliche gewünschte Auswahl. Ein echter Prototyp soll hier nur Text anzeigen.

Erstellt mit dem eingebauten Bildgenerator. Die verwendeten Texte und Vorgaben
stehen in [PROMPTS.md](PROMPTS.md).

## Implementierte Oberfläche (lokale Beispieldaten)

Die folgenden Screenshots zeigen die echte Web-Komponente in der lokalen
Vorschau am 7. November 2026. Der HA-Rahmen und die Daten sind synthetisch;
eine installierte HA-Instanz ist damit nicht abgenommen.

- [Desktopansicht](implementation-desktop.jpg)
- [Mobile Ansicht bei 390 Pixel Breite](implementation-mobile.jpg)

Desktop, mobile Darstellung, helles/dunkles Thema und deutsche/englische
Oberflächentexte wurden im Browser geprüft. Codewerte bleiben in den Screenshots maskiert.
