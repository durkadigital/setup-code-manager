# Setup Code Manager

Der Projektname wurde am 7. November 2026 festgelegt.

## Bezeichnungen

- Anzeigename: **Setup Code Manager** (bestätigt)
- GitHub-Repository-Name: `setup-code-manager`
- Home-Assistant-Integrationskennung: `setup_code_manager`
- Kurzbeschreibung: Geräte und Einrichtungscodes verwalten, scannen und sichern.

Die technische Namensprüfung vom 7. November 2026 fand keinen gleichnamigen
Eintrag im HACS-Katalog und keine Core-Integration mit dieser Kennung.
Die Repository-Suche ergab keinen exakten Namenstreffer. Das ist eine technische
Vorprüfung, keine Markenprüfung. Der öffentliche Fork wurde unter
[durkadigital/setup-code-manager](https://github.com/durkadigital/setup-code-manager)
angelegt.

## Projektstand

Der lokale Entwicklungsstand **0.1.0b5** korrigiert das Laden zwischengespeicherter
Oberflächendateien nach Updates. Die Korrektur ist lokal geprüft; die praktische
Abnahme auf dem Zielsystem steht noch aus. Die [Versionshinweise](docs/releases/0.1.0b5.md)
beschreiben Umfang und Grenzen. Zuletzt wurde die veröffentlichte
[0.1.0b4](https://github.com/durkadigital/setup-code-manager/releases/tag/0.1.0b4)
auf dem Zielsystem installiert.
Dies ist noch keine stabile Version. Der Standardbranch `main` bleibt beim
bereits veröffentlichten und auf HA OS geprüften Stand **0.1.0b1**.
Die neue Integration liegt unter `custom_components/setup_code_manager` und hat
von der ursprünglichen Integration getrennte API-, Panel- und Speicherkennungen.
Grundlage bleibt [PhantomPhoton/Setup-Codes](https://github.com/PhantomPhoton/Setup-Codes),
Version 1.1.11, Commit `5a9ab4a703482edbcb43276d6dae74351ca881cf`.
Originalhistorie und Lizenz bleiben erhalten.

Umgesetzt sind lokale QR-Erkennung, ein unabhängiges Inventar, HA-Geräteauswahl
nach fehlendem Protokollcode, Archiv, versionierter CSV-/JSON-Austausch und eine
Vorschau zur Übernahme alter Daten. Die Integration schreibt atomar unter
`.storage/setup_code_manager`. Die lokale Oberflächenvorschau verwendet Beispieldaten.

[Prüfungen und offene praktische Abnahme](docs/TESTING.de.md) sowie
[Sicherung und Wiederherstellung](docs/BACKUP.de.md) trennen den lokalen Teststand
von der Abnahme im Zielsystem. Ein isolierter lokaler Lauf mit echtem HA Core ist
bestanden. Am 7. November 2026 gelangen mit **0.1.0b1** auf HA OS 18.4 / Core 2026.11.0
Marketplace-Installation, Einrichtung und ein echter HA-Neustart; danach waren weiterhin fünf automatisch
erkannte, verknüpfte Geräte sichtbar. Es wurden keine Codes gespeichert und keine
Migration oder Imports ausgeführt. Dieser frühere Installationslauf prüfte noch
keine realen Codes.

Die Vorabversion **0.1.0b2** ergänzt eine
systemeigene Fotoaufnahme für HTTP-Aufrufe, eine getrennte Auswahl vorhandener Fotos,
QR-Erkennung in mehreren Bildauflösungen und sichere Bildschirmabstände im mobilen
Vollbilddialog. Ein reales Originalfoto wurde mit der produktiven Panelkomponente
in der lokalen Safari-Vorschau als Matter-Code erkannt und in das maskierte
Eingabefeld übernommen; der Entwurf wurde ohne Speichern verworfen. Der lokale
Abschlusslauf umfasst **270 Python- und 33 Node-Tests**, jeweils bestanden.
Anschließend wurde **0.1.0b2** auf dem Zielsystem installiert. Die Fotoaufnahme in
der iPhone-Companion-App wurde vom Nutzer bestätigt; dessen Screenshot zeigt einen
gespeicherten realen Gerätecode. Export, Import und vollständiger Restore im
Zielsystem sind weiterhin offen.

**0.1.0b3** korrigiert die mobile Detailansicht: Der Kopf mit Schließen-Schaltfläche
bleibt unterhalb des sicheren Bildschirmbereichs sichtbar, der Inhalt scrollt
separat. Lange Titel sind auf zwei Zeilen begrenzt; die weiteren Geräteangaben
stehen im Scrollbereich. Anzeigen eines Codes und Aktualisieren desselben Geräts erhalten die
Scrollposition; Schließen per Schaltfläche oder Escape setzt den Fokus zurück
in die Geräteliste und maskiert aufgedeckte Codes. Lokal sind **270 Python- und
48 Node-Tests** bestanden. Browserprüfungen im Hoch- und Querformat,
mit HA-Seitenleiste und auf dem Desktop bestätigten die Detaildarstellung.
Nach Veröffentlichung und Installation von **0.1.0b3** wurde Home Assistant neu
gestartet. Danach blieben fünf Geräte sichtbar, davon zwei mit gespeicherten Codes.
Ein WebKit-Browsertest der tatsächlichen HA-Oberfläche bei 390 × 844 Pixeln
bestätigte Scrollen bis zum Ende und erreichbares Schließen. Die ausdrückliche
Bestätigung des Layouts auf dem physischen iPhone steht noch aus.

**0.1.0b4** leitet aus gültigen gespeicherten Matter-QRs automatisch den manuellen
11- oder 21-stelligen Einrichtungscode ab. Original und Ziffernfolge sind getrennt
maskiert, anzeigbar und kopierbar. Bestehende Einträge benötigen keinen neuen Scan.
Die Ableitung erfolgt nur zur Laufzeit; Speicherformat, CSV/JSON und HA-Backups
behalten den Original-QR und erzeugen keinen zweiten Matter-Codeeintrag. Nach
Import oder Wiederherstellung wird der manuelle Code erneut berechnet.
Die grüne Anzeige **Gespeichert** beschreibt vorhandene Codes unabhängig vom
Online-/Offline-Status. Bei vorhandener HA-Verknüpfung sind Name und Raum von HA
vorgegeben und hier schreibgeschützt; Umbenennungen und Raumänderungen werden
automatisch übernommen. Mehrere Verknüpfungen ergeben eindeutige, sortierte Namen
und Räume. Ohne vorhandene HA-Verknüpfung bleiben manuelle Angaben möglich;
Notizen sind immer bearbeitbar. Nach Entfernen des letzten HA-Geräts bleiben die
zuletzt bekannten Angaben und Codes erhalten. Eine Formatmigration ist nicht nötig.
Automatisierte Tests und Browserabnahme siehe [Teststand](docs/TESTING.de.md).
Weitere Betas stammen vom Featurebranch; `main` bleibt bei `0.1.0b1`.

Am 10. November 2026 wurde **0.1.0b4** nach einer verschlüsselten lokalen Sicherung
auf dem Zielsystem mit **HA Core 2026.11.1** installiert. Nach dem Neustart waren
neun Geräte sichtbar, davon sechs mit gespeicherten Codes. Verknüpfte Namen und
Räume wurden aus HA aktualisiert. Safari lud jedoch eine ältere Übersetzungsdatei
zum neuen Panel; sichtbar war unter anderem `codeStored` statt **Gespeichert**.
Ein frischer Abruf der Übersetzungen enthielt die richtigen Texte.

**0.1.0b5** gibt dem Panel und sämtlichen nachgeladenen JavaScript-, CSS- und
Decoderdateien einen gemeinsamen versionsbezogenen Pfad. Dadurch erhalten auch
verschachtelte Importe nach einem Update neue Adressen. Inventar und Codes
bleiben unverändert; eine Formatmigration ist nicht erforderlich. Die abschließenden
Prüfungen dieser Korrektur werden im Teststand getrennt von Beta 4 dokumentiert.

Die vorhandene Livekamera benötigt HTTPS. Fotoaufnahme über HTTP bleibt verfügbar;
ein unterstützter öffentlicher Ladeweg zum nativen Companion-Scanner besteht für
Custom Panels derzeit nicht. Es wurden keine Netzwerkeinstellungen geändert.
Ein bereits aktiver Nabu-Casa-Fernzugang mit gültigem HTTPS wurde gefunden und
bis zur Anmeldeseite geprüft. Anmeldung und praktische Livekamera-Abnahme auf dem
iPhone stehen noch aus; dafür ist keine neue Tailscale-Konfiguration erforderlich.

Für Tests über ein benutzerdefiniertes Repository im integrierten Marketplace von
HA 2026.11 ist für die Cachekorrektur die GitHub-Vorabversion `0.1.0b5` ausdrücklich in der Versionsauswahl
zu wählen. Vorabversionen müssen **vor dem Installieren** eingeschlossen werden;
Name, Versionsnummer und die neue Domain `setup_code_manager` sind zu prüfen.
Der Standardbranch `main` enthält jetzt ebenfalls `setup_code_manager`.
Die ursprüngliche Integration und ihre Daten bleiben für die Migration erhalten.
Eine Aufnahme in den allgemeinen Marketplace-/HACS-Katalog ist noch nicht beantragt.

## Konzeptunterlagen

- [Funktions- und Datenkonzept](docs/CONCEPT.de.md)
- [Ansichten und Bedienabläufe](docs/SCREENS.de.md)
- [Herkunft und technischer Ausgangsstand](docs/PROVENANCE.md)
- [Visuelle Entwürfe](docs/design/README.md)

Die visuelle Gestaltungsrichtung und die ergänzte HA-Geräteauswahl wurden am
7. November 2026 bestätigt. Der ursprüngliche Konzeptstand bleibt als
Planungsgrundlage erhalten; den tatsächlichen Implementierungsumfang und bekannte
Grenzen beschreibt die [README](README.md).
