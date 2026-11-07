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

Diese Testversion **0.1.0b3** ist lokal geprüft; die praktische iPhone-Abnahme
des korrigierten Layouts steht noch aus. Die [Versionshinweise](docs/releases/0.1.0b3.md)
beschreiben Umfang und Grenzen. Die veröffentlichte und auf dem Zielsystem
installierte Testversion ist [0.1.0b2](https://github.com/durkadigital/setup-code-manager/releases/tag/0.1.0b2).
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
gespeicherten realen Gerätecode. Die Persistenz nach einem HA-Neustart sowie Export,
Import und vollständiger Restore im Zielsystem sind weiterhin offen.

**0.1.0b3** korrigiert die mobile Detailansicht: Der Kopf mit Schließen-Schaltfläche
bleibt unterhalb des sicheren Bildschirmbereichs sichtbar, der Inhalt scrollt
separat. Lange Titel sind auf zwei Zeilen begrenzt; die weiteren Geräteangaben
stehen im Scrollbereich. Anzeigen eines Codes und Aktualisieren desselben Geräts erhalten die
Scrollposition; Schließen per Schaltfläche oder Escape setzt den Fokus zurück
in die Geräteliste und maskiert aufgedeckte Codes. Lokal sind **270 Python- und
48 Node-Tests** bestanden. Browserprüfungen im Hoch- und Querformat,
mit HA-Seitenleiste und auf dem Desktop bestätigten die Detaildarstellung.
Scrollen bis zum Ende und erreichbares Schließen wurden geprüft; die Abnahme auf dem Ziel-iPhone
steht aus. Diese Beta wird vom Featurebranch veröffentlicht; `main` bleibt bei `0.1.0b1`.

Die vorhandene Livekamera benötigt HTTPS. Fotoaufnahme über HTTP bleibt verfügbar;
ein unterstützter öffentlicher Ladeweg zum nativen Companion-Scanner besteht für
Custom Panels derzeit nicht. Es wurden keine Netzwerkeinstellungen geändert.

Für Tests über ein benutzerdefiniertes Repository im integrierten Marketplace von
HA 2026.11 ist die GitHub-Vorabversion `0.1.0b2` ausdrücklich in der Versionsauswahl
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
