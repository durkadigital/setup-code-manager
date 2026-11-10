# Installation und Updates

Setup Code Manager ist eine **benutzerdefinierte Integration** für Home Assistant.
Sie liegt im Ordner `custom_components/setup_code_manager` und wird unter
**Geräte & Dienste** eingerichtet.

Die aktuelle Version **0.1.0b7 ist eine Vorabversion**. Das Repository ist noch
nicht im allgemeinen Marketplace-Katalog gelistet und wird daher über seinen
Link hinzugefügt. Lege vor einer Testinstallation oder einem Update eine aktuelle
HA-Sicherung einschließlich Konfigurationsordner an.

## Voraussetzungen

- Administratorkonto in Home Assistant.
- **Home Assistant 2026.11 oder neuer.** Die automatisierte Testumgebung verwendet
  HA 2026.11.0; Installation und Neustart wurden auf HA 2026.11.1 geprüft.
- Für die Livekamera: HTTPS, Kameraberechtigung und ein unterstützter Browser.
  Fotoauswahl und manuelle Codeeingabe sind auch ohne Livevideo möglich.

## Marketplace ab Home Assistant 2026.11

Der Marketplace ist seit HA 2026.11 integriert. Für ein benutzerdefiniertes
Repository wird eine GitHub-Verbindung benötigt.
[Offizielle Beschreibung](https://www.home-assistant.io/blog/2026/11/04/release-202611/#custom-repositories).

1. **Einstellungen → Marketplace** öffnen.
2. **Add from link** / **Über Link hinzufügen** wählen und diese URL eintragen:
   `https://github.com/durkadigital/setup-code-manager`.
3. Die von Home Assistant angeforderte GitHub-Verbindung abschließen.
4. Die Repository-Details öffnen und **Vorabversionen** / **Pre-releases** aktivieren.
5. **Setup Code Manager**, Version **0.1.0b7**, prüfen und installieren.
   Die Integrationskennung lautet **`setup_code_manager`**.
6. Den anschließenden Einrichtungsdialog abschließen und die gewünschten
   Geräteintegrationen wählen. Sollte kein Dialog erscheinen, unter
   **Einstellungen → Geräte & Dienste → Integration hinzufügen** nach
   **Setup Code Manager** suchen.
7. Den Seitenleisteneintrag **Setup Code Manager** als Administrator öffnen.

Beim erstmaligen Installieren führt der Marketplace direkt zur Einrichtung.
Nach Updates ist weiterhin ein Home-Assistant-Neustart erforderlich; dem
entsprechenden Hinweis folgen.
[Installation und Updates im Marketplace](https://www.home-assistant.io/blog/2026/11/04/release-202611/#browse-and-install).

Wird die Beta nicht angeboten, die Vorabversionsoption und Versionsauswahl erneut
prüfen sowie die Repository-Daten aktualisieren. Alternativ die manuelle
Installation unten verwenden. GitHub-Vorabversionen müssen ausdrücklich
eingeschlossen werden.
[Offizielle Release-Dokumentation](https://contributors.home-assistant.io/marketplace/guides/releases/).

## Bestehende HACS-Installationen

Die HACS-kompatiblen Repository-Metadaten bleiben erhalten. Home Assistant 2026.11
übernimmt vorhandene HACS-Installationen, benutzerdefinierte Repositories und
Update-Einträge in den integrierten Marketplace.
[Offizielle Hinweise zum Wechsel](https://www.home-assistant.io/blog/2026/11/04/release-202611/#thank-you-hacs).

Für **0.1.0b7** gilt dennoch die Mindestversion **HA 2026.11.0**. Ältere
Home-Assistant-Versionen werden von dieser Version nicht unterstützt. Ein
separates HACS muss auf HA 2026.11 nicht nachinstalliert werden.

## Manuell installieren

1. Die [Release-Seite von 0.1.0b7](https://github.com/durkadigital/setup-code-manager/releases/tag/0.1.0b7)
   öffnen und **Source code (zip)** herunterladen.
2. Das Archiv entpacken. In
   `custom_components/setup_code_manager/manifest.json` muss die Version
   **`0.1.0b7`** stehen.
3. Den vollständigen Ordner `custom_components/setup_code_manager` nach
   `<HA-Konfiguration>/custom_components/setup_code_manager` kopieren.
4. Home Assistant neu starten und die Integration unter **Geräte & Dienste** hinzufügen.

Verwende für einen festgelegten Versionsstand das Release-Archiv. Einzelne
Python- oder Oberflächendateien aus verschiedenen Versionen dürfen nicht
miteinander vermischt werden.

## Ein Update prüfen

Nach dem Neustart das Panel erneut öffnen. Übersetzungen sollen als normale
Beschriftungen erscheinen, zum Beispiel **Code gespeichert**. Version 0.1.0b5 führte
gemeinsame versionsbezogene Adressen für die Oberflächendateien ein, damit nach
einem Update keine alten Übersetzungen zu einem neuen Panel geladen werden.
Der [Teststand](TESTING.de.md) nennt bereits geprüfte und noch offene Fälle.

## Bestehende Daten

Die ursprüngliche Integration `setup_codes` und Setup Code Manager
`setup_code_manager` besitzen getrennte Inventare. Die ursprünglichen Ordner und
`.storage/setup_codes` werden durch diese Installation nicht ersetzt oder gelöscht.
Seit 0.1.0b6 enthält die Oberfläche keinen Hinweis oder Button zur Übernahme der
Originaldaten mehr. Bestehende Einträge in Setup Code Manager bleiben erhalten.

Exportdateien enthalten Einrichtungscodes im Klartext. Hinweise zur Aufbewahrung
und zu den Wiederherstellungswegen stehen in
[Sicherung und Wiederherstellung](BACKUP.de.md).
