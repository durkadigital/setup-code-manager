# Veröffentlichung im Home Assistant Marketplace

Recherche vom **10. November 2026**, anhand offizieller Dokumentation und der
aktuellen Quellen des Katalogbetreibers. Diese Datei bereitet die Einreichung vor;
sie belegt keine bereits erfolgte Katalogaufnahme.

## Welcher Veröffentlichungsweg gilt?

Seit **Home Assistant 2026.11** ist der Marketplace unter **Einstellungen →
Marketplace** integriert. Er übernimmt den HACS-Katalog und verwendet weiterhin
`hacs.json` sowie die HACS-Werkzeuge. Eine gesonderte Einreichung bei einem neuen
Marketplace-Portal ist deshalb nicht erforderlich.
[Quelle: Funktionsweise](https://contributors.home-assistant.io/marketplace/how-it-works/).

Setup Code Manager gehört zur Kategorie **`integration`**. Home-Assistant-Apps
(früher Add-ons) sind dagegen vom Supervisor verwaltete Container mit eigener
Repository- und Konfigurationsstruktur. Der App-Store ist für dieses Projekt der
falsche Einreichungsweg.
[Quelle: Apps](https://contributors.home-assistant.io/apps/how-apps-work/).

Zwei Zustände sind zu unterscheiden:

- **Benutzerdefiniertes Repository:** Installation über einen direkten Link ist
  schon vor der allgemeinen Katalogaufnahme möglich. Dafür benötigt der Nutzer
  eine GitHub-Verbindung im Marketplace.
  [Quelle: Funktionsweise](https://contributors.home-assistant.io/marketplace/how-it-works/).
- **Allgemeiner Katalog:** Dafür wird `durkadigital/setup-code-manager` per Pull
  Request in die alphabetisch sortierte JSON-Liste `integration` von
  [`hacs/default`](https://github.com/hacs/default/blob/master/integration)
  aufgenommen. Die Prüfung kann Monate dauern.
  [Quelle: Katalogaufnahme](https://contributors.home-assistant.io/marketplace/guides/catalog/).

Der öffentliche Installationslink lautet:
[Setup Code Manager im Marketplace öffnen](https://my.home-assistant.io/redirect/marketplace_repository/?owner=durkadigital&repository=setup-code-manager&category=integration).
Der ältere Linktyp `hacs_repository` erreicht zusätzlich Installationen vor
2026.11. Beide Links bedeuten allein noch keine Katalogaufnahme.
[Quelle: Repository-Links](https://contributors.home-assistant.io/marketplace/guides/catalog/#the-link-to-your-repository).

## Technische Voraussetzungen

| Bereich | Offizielle Vorgabe und Konsequenz für dieses Repository |
| --- | --- |
| Struktur | Eine Integration unter `custom_components/setup_code_manager/`; alle Laufzeitdateien darin. Diese Struktur ist vorhanden. |
| Manifest | `domain`, `name`, `documentation`, `issue_tracker`, `codeowners` und `version` müssen gültig sein. Die Felder sind vorhanden; Versionsnummer und Release-Tag müssen übereinstimmen. |
| Übersetzungen | Fertige Dateien unter `translations/`, insbesondere vollständiges `en.json`. Die Datei ist vorhanden; Hassfest prüft die Integrationsdateien. |
| Eigene Domain | Keine Ersetzung einer Core-Integration. `setup_code_manager` ist absichtlich unabhängig von der Ursprungsdomain `setup_codes`; beide Integrationen haben getrennte Daten. Vor Einreichung Kollision erneut prüfen. |

Quellen: [Custom Integrations](https://contributors.home-assistant.io/marketplace/guides/integrations/),
[Manifestprüfung im Katalog](https://contributors.home-assistant.io/marketplace/guides/catalog/#what-the-review-checks),
[Projektherkunft](PROVENANCE.md).

`hacs.json` benötigt mindestens `name`. `homeassistant` nennt die tatsächlich
unterstützte Mindestversion und wird für Releases geprüft. Die zuvor eingetragene
Version `2026.1.0` war durch den dokumentierten Teststand gegen 2026.11 nicht
belegt. Ab 0.1.0b6 ist die Mindestversion deshalb `2026.11.0`.
`render_readme` gehört nicht zu den ausgewerteten Marketplace-Schlüsseln und ist
keine Voraussetzung für die Anzeige der README.
[Quelle: hacs.json](https://contributors.home-assistant.io/marketplace/reference/hacs-json/).

`categories` im Integrationsmanifest ist empfohlen. Ab 0.1.0b6 ist die gültige
Kategorie `productivity_information` für die Inventar- und Informationsverwaltung
eingetragen. Ein fehlender Eintrag erzeugt gegenwärtig eine Warnung, ungültige
Kategorien hingegen einen Fehler.
[Quelle: Validierung](https://contributors.home-assistant.io/marketplace/reference/validation/).

## Bildmaterial, Lizenz und öffentliche Angaben

Ein lokaler Ordner `custom_components/setup_code_manager/brand/` mit mindestens
`icon.png` erfüllt den dokumentierten Brands-Prüfweg. Eine zusätzliche Einreichung
bei `home-assistant/brands` ist dafür nicht erforderlich. Ein fehlendes Logo fällt
auf das Icon zurück. Vorgesehen sind PNG-Icons mit **256 × 256 px**, `@2x` mit
**512 × 512 px**; dunkle Varianten sind optional. Home-Assistant-Markenbilder dürfen
Custom Integrations nicht als eigene Marke verwenden.
[Quelle: Bilder](https://contributors.home-assistant.io/core/integrations/brands/).

Die optionalen, fälschlich als `@2x` bezeichneten 256-Pixel-Dateien wurden in
0.1.0b6 entfernt. Die regulären hellen und dunklen Icons bleiben mit 256 × 256 px
erhalten. Vor der Einreichung die endgültigen Bilddateien erneut prüfen.
Der aktuelle Katalogworkflow lässt neue Integrationen sogar an
`BRAND_IMAGES`-Warnungen von Hassfest scheitern.
[Quelle: Katalogworkflow](https://github.com/hacs/default/blob/master/.github/workflows/checks.yml).

Das Repository muss öffentlich, aktiv und mit Beschreibung, Topics, aktivierten
Issues und README ausgestattet sein. Außerdem verlangt die aktuelle
HACS-Veröffentlichungsdokumentation eine von GitHub erkannte, OSI-anerkannte
Open-Source-Lizenz. Die erhaltene MIT-Lizenz und die Hinweise auf Fremdcode bilden
hier die Grundlage; ihre öffentliche Erkennung vor Einreichung prüfen.
[Quelle: HACS-Veröffentlichungsregeln](https://github.com/hacs/documentation/blob/main/source/docs/publish/include.md),
[Lizenz](../LICENSE), [Herkunft](PROVENANCE.md).

Ein Fork ist in den geprüften Marketplace-Regeln nicht pauschal ausgeschlossen.
Einreichen darf der Eigentümer oder ein wesentlicher Mitwirkender. Das ist keine
Zusicherung, dass jede abgeleitete Integration akzeptiert wird. Herkunft und
Unterschiede zur ursprünglichen Integration müssen deshalb nachvollziehbar
bleiben.
[Quelle: Einreichungsberechtigung](https://contributors.home-assistant.io/marketplace/guides/catalog/#who-can-submit).

Speicherung, Exporte und Administratorzugriff werden in der öffentlichen README
erklärt. Echte Setup-Codes oder private Exporte gehören nicht in öffentliche Issues.

## Release und Prüfungen

Vor der Einreichung müssen **HACS Action ohne `ignore`** und **Hassfest** erfolgreich
laufen. Beide Workflows sind im Repository vorhanden. Maßgeblich sind aktuelle
erfolgreiche GitHub-Läufe für den endgültigen Stand. Die Katalogprüfung klont für
Hassfest den Standardbranch; `main` muss daher die einzureichende Struktur und
Metadaten enthalten.
[Quellen: Validierung](https://contributors.home-assistant.io/marketplace/reference/validation/),
[Katalogworkflow](https://github.com/hacs/default/blob/master/.github/workflows/checks.yml).

Nach erfolgreichen Actions ist ein **veröffentlichtes GitHub Release** erforderlich;
ein Tag allein reicht nicht. Eine ausdrückliche Stable-only-Bedingung enthalten
die geprüfte Vorlage und der Release-Check nicht: Der Check prüft lediglich,
ob `/releases` Einträge liefert. Vorabversionen werden im Marketplace nur bei
aktiviertem Vorabversionsschalter angeboten. Eine stabile Version vor breiter
Veröffentlichung bleibt deshalb unsere Produktentscheidung und darf nicht als
belegte formale Katalogregel ausgegeben werden.
[Quellen: PR-Vorlage](https://github.com/hacs/default/blob/master/.github/PULL_REQUEST_TEMPLATE.md),
[Release-Check](https://github.com/hacs/default/blob/master/scripts/check/releases.py),
[Releases](https://contributors.home-assistant.io/marketplace/guides/releases/).

Die noch offenen praktischen Prüfungen stehen in [TESTING.de.md](TESTING.de.md):
unter anderem aktuelle Oberfläche und Livekamera auf dem physischen iPhone,
Export/Import im Zielsystem und vollständige Wiederherstellung einer HA-Sicherung.
Automatisierte Tests, vorhandene Fotoaufnahme und eine erstellte Sicherung ersetzen
diese Abnahmen nicht.

## Konkrete Einreichung und benötigte Entscheidungen

1. Endgültigen Stand, öffentliche README, Mindestversion, Bilder und aktuelle
   erfolgreiche HACS-/Hassfest-Läufe prüfen; danach passendes Release erstellen.
2. `hacs/default` im persönlichen Konto forken und einen neuen Branch von dessen
   `master` erstellen. Den Projekteintrag alphabetisch in `integration` ergänzen.
3. Vollständige PR-Vorlage verwenden: wahrheitsgemäße Checkliste sowie Links zu
   Release, HACS-Lauf und Hassfest-Lauf. Bearbeitung durch Maintainer ermöglichen;
   keine Personen zur Review anfordern. Die Katalogaufnahme erfolgt erst nach
   Prüfung und Merge.

Quellen: [Einreichungsablauf](https://github.com/hacs/documentation/blob/main/source/docs/publish/include.md),
[PR-Vorlage](https://github.com/hacs/default/blob/master/.github/PULL_REQUEST_TEMPLATE.md).

Vom Maintainer werden vor diesem externen PR noch benötigt:

- Entscheidung, welcher getestete Stand eingereicht wird und ob vorher die erste
  stabile Version erscheinen soll.
- Ergebnisse der verbliebenen praktischen Abnahme, soweit sie als abgeschlossen
  beworben werden sollen.
- Gewünschter privater Kontaktweg für Sicherheitsmeldungen, falls ergänzt.
- Freigabe für die tatsächliche Katalogeinreichung, sobald Release und Nachweise
  konkret vorliegen.

Für die Einreichung sind keine echten Pairing-Codes, privaten HA-Adressen,
Zugangsdaten oder Sicherungsschlüssel erforderlich. Öffentliches GitHub, ein
installierbares benutzerdefiniertes Repository und ein allgemein gelisteter
Katalogeintrag bleiben getrennte Veröffentlichungszustände.
