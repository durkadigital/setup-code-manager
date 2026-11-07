# Setup Code Manager – Bildschirmkonzept

Status: **Bestätigte Planungsgrundlage**. Die lokale Implementierung folgt diesem Konzept; tatsächlicher Teststand und offene Abnahmen stehen in [TESTING.de.md](TESTING.de.md).
Stand: 7. November 2026. Die Texte und Abläufe dienen als Grundlage für die Abstimmung.
Die visuelle Richtung der Bildentwürfe wurde bestätigt. Die folgende Geräteauswahl
ergänzt den bestätigten Ablauf; sie ist in den bisherigen Bildern noch nicht dargestellt.

## 1. Grundmodell und Navigation

Ein Eintrag beschreibt ein physisches Gerät und kann mehrere Protokollcodes besitzen,
zum Beispiel einen Matter-Code und einen HomeKit-Code derselben Steckdose.
Home-Assistant-Verknüpfungen sind optional; der Inventareintrag besitzt eine eigene Identität.
Mehrere HA-Geräteeinträge dürfen nach bewusster Auswahl zu diesem Inventareintrag gehören.

Vorschlag: **Alle / Verknüpft / Nicht verknüpft / Archiv**, Standardansicht **Alle**.
„Alle“ zeigt alle nicht archivierten Einträge, damit auch neu erfasste Geräte sichtbar sind.
„Verknüpft“ bedeutet: Mindestens eine Zuordnung verweist auf ein vorhandenes HA-Gerät.
„Nicht verknüpft“ bedeutet: Keine Zuordnung verweist auf ein vorhandenes HA-Gerät.
Erreichbarkeit wird separat angezeigt; ein nicht erreichbares Gerät bleibt verknüpft.
„Archiv“ enthält bewusst archivierte Geräte. Archivierung löscht weder Codes noch Notizen.
Die Archivansicht ist unabhängig vom Verknüpfungsstatus und aus „Alle“ ausgenommen.

Wird das letzte zugeordnete Gerät aus HA entfernt, wechselt ein aktiver Eintrag zu
„Nicht verknüpft“. Archivierte Einträge bleiben im Archiv. Es wird nichts automatisch gelöscht.
Nach „Aus Archiv wiederherstellen“ erscheint der Eintrag entsprechend seiner Zuordnung wieder.

## 2. Geräteübersicht

Desktop: kompakte Tabelle mit Suche, Ansichten und optionalem Protokollfilter.

```text
Setup Code Manager                 [Gerät hinzufügen] [Importieren] [Exportieren]
[Alle 15] [Verknüpft 12] [Nicht verknüpft 3] [Archiv 4]
[Geräte suchen …                                     ] [Protokoll: Alle ▾]
Gerät                    Codes            Standort       Home Assistant
Wohnzimmer-Steckdose     Matter, HomeKit   Wohnzimmer     Verknüpft · Nicht erreichbar
Schreibtischlampe        Matter           Arbeitszimmer  Nicht verknüpft
Flursensor               Code fehlt       Flur           Verknüpft · Erreichbar
```

Mobil: kompakte Karten; Aktionen oben als „+ Gerät“ und Menü. Ansichten horizontal scrollbar.

```text
Setup Code Manager                  [+ Gerät] [⋮]
[Alle 15] [Verknüpft 12] [Nicht verknüpft 3] [Archiv 4]
[Geräte suchen …                             ]
Wohnzimmer-Steckdose                         [›]
Wohnzimmer · Matter, HomeKit
Verknüpft · Nicht erreichbar
──────────────────────────────────────────────
Schreibtischlampe                            [›]
Arbeitszimmer · Matter
Nicht verknüpft
```

Auswahl einer Zeile/Karte öffnet die Details. Codes sind in der Liste nicht ausgeschrieben.
„Code fehlt“ bedeutet, dass für diesen Inventareintrag noch kein Code hinterlegt ist.
Nach Auswahl eines Protokolls bezieht sich „Code fehlt“ auf dieses Protokoll.
Ein entsprechender Filter führt direkt zu HA-Geräten, deren Code ergänzt werden kann.

## 3. Gerät hinzufügen und Code erfassen

„Gerät hinzufügen“ öffnet die Auswahl „QR-Code scannen“, „Foto auswählen“, „Manuell anlegen“.
Ein Inventareintrag darf zunächst ohne Code gespeichert und später ergänzt werden.
Ein Scan erzeugt einen Entwurf; gespeichert wird nach Prüfung durch den Nutzer.

```text
Gerät hinzufügen                                      [Schließen]
Matter-Code erkannt                          [Erneut scannen]
Name*                  [Schreibtischlampe                    ]
Hersteller / Modell    [Hersteller] [Modell                   ]
Standort               [Arbeitszimmer                        ]
Notiz                  [                                    ]
Codes                  Matter · [Code anzeigen] [Entfernen]
                       [+ Weiteren Code hinzufügen]
Home Assistant         [Optional: Gerät zuordnen ▾]
                                        [Abbrechen] [Speichern]
```

Mobil stehen alle Felder untereinander; „Speichern“ ist am Formularende eindeutig erreichbar.
Name ist Pflicht. Aus dem QR verfügbare Angaben werden als Vorschlag eingetragen.
Eine automatische zuverlässige Erkennung von Modell, Seriennummer oder HA-Gerät wird nicht versprochen.
Scannen erfasst den Code und startet keine Matter-Kopplung oder andere Geräteinstallation.

### Vorhandenes HA-Gerät direkt wählen

Das Feld heißt künftig „Mit Home Assistant verknüpfen“. Nach einem Matter-Scan
öffnet es standardmäßig diese nach Geräteverwaltung und eigenem Codebestand
zusammengestellte Liste:

```text
HA-Gerät auswählen                                      [Schließen]
[Name, Raum oder Modell suchen …                               ]
[Ohne Matter-Code] [Alle HA-Geräte]

Schreibtischlampe                                         [Auswählen]
Arbeitszimmer · Matter
Matter-Code fehlt

Steckdose Sofa                                            [Auswählen]
Wohnzimmer · Matter, HomeKit
Matter-Code fehlt · HomeKit vorhanden

[Ohne HA-Verknüpfung fortfahren]
```

Hersteller und Modell werden zusätzlich angezeigt, wenn HA sie bereitstellt.
„Alle HA-Geräte“ enthält auch Geräte mit gespeichertem Code oder anderer Integration;
ein vorhandener Code wird sichtbar gekennzeichnet und nicht unbemerkt ersetzt.
Gerätename und Raum helfen bei der Suche, die Verknüpfung nutzt die konkrete Geräte-ID.

Nach Auswahl zeigt das Formular das gewählte Gerät mit „Ändern“ und übernimmt
bekannte Angaben als Vorschläge. **Speichern** legt Code und Verknüpfung gemeinsam ab.
Ein bereits zugehöriger Inventareintrag wird ergänzt. Die Auswahl eines archivierten
Treffers weist auf das Archiv hin und fragt vor dem Ergänzen; sie stellt ihn nicht
automatisch wieder her. Bei mehreren Inventartreffern muss der richtige gewählt werden.

Alternativ beginnt der Nutzer in der Geräteübersicht bei einem Eintrag ohne Code:
**Gerät öffnen → Code scannen → Speichern**. Die Verknüpfung ist dann bereits gesetzt.
Ein offline befindliches, aber noch in HA eingerichtetes Gerät bleibt auswählbar.

Wurde das gewählte HA-Gerät inzwischen entfernt, bleiben die Eingaben erhalten:
„Dieses Gerät ist nicht mehr in Home Assistant vorhanden.“ Aktionen: „Anderes Gerät
wählen“ oder „Ohne Verknüpfung speichern“. Ein inzwischen gespeicherter anderer Code
öffnet den Vergleich. Beide Prüfungen erfolgen vor der Übernahme.

Livekamera: Rückkamera bevorzugen, Berechtigung erst beim Start anfordern und Kamera beim Schließen stoppen.
Browser-Livekamera benötigt normalerweise HTTPS. Fotoauswahl und manuelle Eingabe bleiben verfügbar.
Safari/iPhone, Android/Chrome und beide Companion-Apps müssen vor Freigabe praktisch geprüft werden.
Die erste Version liest QR-Codes; OCR ausschließlich gedruckter Ziffern ist ein späterer Zusatz.

## 4. Details, mehrere Codes und Zuordnung

```text
Wohnzimmer-Steckdose                              [Bearbeiten] [⋮]
Wohnzimmer · Eve Energy
Home Assistant: Verknüpft · Nicht erreichbar       [Gerät öffnen]

Codes                                             [+ Code hinzufügen]
Matter          Originalcode vom Gerät            [Anzeigen] [Kopieren] [QR]
HomeKit         Code vom Beileger                  [Anzeigen] [Kopieren] [QR]

Notiz: Aufkleber auf der Unterseite.
HA-Zuordnungen                                    [Zuordnung ändern]
  Wohnzimmer-Steckdose · Matter
```

Ein neuer Code wird einem Protokoll und optional einer Herkunft/Beschreibung zugeordnet.
Originalpayloads bleiben erhalten; aus einer reinen Zahleneingabe wird kein Original-QR behauptet.
Temporäre Freigabecodes werden als solche gekennzeichnet und ersetzen keinen Originalcode automatisch.
Bestehende Codes lassen sich gezielt bearbeiten oder entfernen; weitere Codes ersetzen sie nicht.
Gleiche Codes lösen einen Hinweis mit Verweis auf bestehende Einträge aus, keine automatische Fusion.
„Trotzdem speichern“ bleibt möglich, da gleiche Codes nicht sicher dasselbe physische Gerät beweisen.
Das Zusammenführen von Inventareinträgen ist kein automatischer Vorgang und zunächst nicht vorgesehen.

Im Menü: „Archivieren“ beziehungsweise „Aus Archiv wiederherstellen“ und „Dauerhaft löschen“.
Dauerhaftes Löschen benötigt eine Bestätigung und nennt das Gerät samt Anzahl gespeicherter Codes.
HA-Gerät entfernt: „Das Gerät wurde aus Home Assistant entfernt. Dein Eintrag bleibt erhalten.“
Aktionen dazu: „Gerät zuordnen“ und „Archivieren“. Eine Zuordnung setzt keine Codes zurück.

## 5. Export und Importvorschau

Export: Umfang „Alle einschließlich Archiv“ oder aktuelle Ansicht; Formate JSON und CSV.
JSON ist die vollständige versionierte Sicherung. CSV ist das dokumentierte Tabellenformat.
Bei mehreren Codes: eine CSV-Zeile pro Code mit gemeinsamer Inventar-ID; auch Geräte ohne Code bleiben exportierbar.
Codes werden als Text behandelt. Hinweis: „Diese Datei enthält Einrichtungscodes. Bewahre sie geschützt auf.“

```text
Import prüfen                                     [Andere Datei auswählen]
24 Inventareinträge erkannt: 18 neu · 4 identisch · 2 Konflikte
Gerät                   Ergebnis                   Aktion
Schreibtischlampe       Neu                        Hinzufügen
Wohnzimmer-Steckdose    Bereits vorhanden          Überspringen
Flurlampe              Abweichende Daten           [Vergleichen]
                               [Abbrechen] [18 neue Einträge importieren]
```

Vor der Vorschau wird nichts geändert. Bei Konflikten wählt der Nutzer die Übernahme ausdrücklich.
Standard ist ergänzen und eindeutig identische Einträge überspringen; kein stilles Überschreiben.
Ein gleicher Code allein ist nur ein Dublettenhinweis und blockiert keinen zusätzlichen Inventareintrag.
Ungültige Zeilen werden mit verständlichem Grund gezeigt; nur geprüfte, ausgewählte Änderungen werden übernommen.
Nach HA-Neuinstallation bleiben unsichere Zuordnungen offen. Alte IDs oder gleiche Namen reichen nicht als Nachweis.
CSV/JSON-Import stellt Inventar und Codes wieder her; die Wiederherstellung einer HA-Installation ist ein eigener Ablauf.

## 6. Leere Zustände und Fehler

| Situation | Text und nächste Aktion |
| --- | --- |
| Keine Einträge | „Bewahre die Einrichtungscodes deiner Geräte an einem Ort auf.“ – „Erstes Gerät hinzufügen“ |
| Nicht verknüpft leer | „Hier erscheinen Geräte ohne Home-Assistant-Verknüpfung.“ – „Gerät hinzufügen“ |
| Archiv leer | „Dein Archiv ist leer. Archivierte Geräte behalten ihre Codes und Notizen.“ |
| Kamera über HTTP | „Die Livekamera benötigt HTTPS. Wähle ein Foto aus oder gib den Code ein.“ |
| Kamera abgelehnt | „Der Kamerazugriff ist nicht erlaubt.“ – „Foto auswählen“ / „Code eingeben“ |
| QR nicht lesbar | „Kein lesbarer QR-Code gefunden. Versuche ein schärferes Foto.“ – „Code eingeben“ |
| Fremder QR | „Dieser QR-Code enthält keinen unterstützten Einrichtungscode.“ |
| Speichern fehlgeschlagen | „Der Eintrag wurde nicht gespeichert. Deine Eingaben bleiben erhalten.“ – „Erneut versuchen“ |
| Importdatei ungültig | „Diese Datei konnte nicht gelesen werden. Es wurden keine Einträge geändert.“ |
| Dateiversion unbekannt | „Diese Sicherung benötigt eine neuere Version von Setup Code Manager.“ |

Alle Ansichten und Aktionen sind zunächst für HA-Administratoren vorgesehen.
