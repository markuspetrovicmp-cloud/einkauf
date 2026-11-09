# Einkauf – GitHub Pages (PWA)

Die Einkaufslisten-App im cremeweiß-grünen Bento-Stil von **Marpet Studio**.

## Veröffentlichung ohne eigene Domain

1. Auf [github.com/new](https://github.com/new) ein **öffentliches** Repository mit dem Namen `einkauf` erstellen. **Kein** Starter-Template nötig.
2. Das ZIP entpacken und **alle enthaltenen Dateien** in das Stammverzeichnis (Root) des Repositories hochladen – insbesondere `index.html`, `app.js`, `styles.css`, `manifest.webmanifest`, `sw.js`, `icon-192.png`, `icon-512.png`, `qr.js` und `firebase-config.js`. **Nicht** nur die ZIP-Datei hochladen. In GitHub: **Add file → Upload files → Commit changes**.
3. Im Repository **Settings → Pages → Build and deployment** wählen: **Deploy from a branch**, Branch **main**, Ordner **/(root)**, **Save**.
4. Die App erscheint unter `https://DEIN-GITHUB-NAME.github.io/einkauf/`. Die Bereitstellung kann einige Minuten dauern.
5. Auf dem Android-Handy den Link in **Chrome** öffnen, Menü **⋮ → App installieren** (je nach Version „Zum Startbildschirm hinzufügen“).

Die URL benötigt **keine kostenpflichtige Domain**. Es muss ein HTTPS-Link sein, weil Kamera, PWA-Installation und Service Worker einen sicheren Kontext verlangen.

## Funktionen dieser Version

- Mehrere Listen/Filialen (Gurkerl, Hofer, Billa, Spar, Lidl, Bipa, dm, Müller, OBI, eigene Geschäfte)
- Artikel erfassen, Mengen eingeben, abhaken, bearbeiten, zwischen Listen bewegen
- Listen klonen, Einträge kopieren/verschieben/einfügen
- Rezeptsammlungen als Text übernehmen, mit Dublettenprüfung
- Für Gurkerl/Maia kopieren; offene Artikel als Text/CSV exportieren
- JSON-Backup / Restore
- Offline nutzbar **nach einmaligem Laden** durch Service Worker
- Fotoimport mit **experimenteller** Texterkennung (Tesseract.js; erster Download online; Handschrift nicht garantiert)
- QR-Einladung & Firebase-Code vorbereitet, **noch nicht aktiviert oder mit zwei Handys bestätigt**

## Datenspeicherung – wichtig

Ohne Firebase liegen die Listen **nur im Speicher deines Browsers / deiner installierten PWA** (localStorage). Keine sensiblen Daten in öffentliche GitHub-Dateien hochladen. Browserdaten löschen oder die App deinstallieren kann deine Listen löschen. **Regelmäßig Einstellungen → JSON-Backup speichern!**

Eine installierte PWA ist technisch keine native APK, erscheint aber auf deinem Android-Handy mit Icon im App-Launcher und startet im eigenen Fenster.

## Später: Firebase-Synchronisierung

Die App funktioniert **ohne** Firebase. Für die gemeinsame Echtzeitliste:

1. Eigenes Firebase-Projekt erstellen und Authentication mit **Anonymous** aktivieren.
2. Cloud Firestore anlegen, **nicht im offenen Testmodus** betreiben.
3. Die mitgelieferte `firestore.rules` in der Firebase-Konsole prüfen, einsetzen und veröffentlichen. **Vor Familiennutzung Regeln und QR-Einladung mit zwei Testgeräten prüfen.**
4. In `firebase-config.js` die **Web-App-Konfiguration** deines Firebase-Projekts eintragen und die Datei erneut zu GitHub hochladen. Nur die Web-Konfiguration ist für den Client gedacht, **keine Admin-Schlüssel oder Service-Account-Dateien** ins öffentliche Repository stellen.
5. Auch beim Teilen bleibt die vorhandene lokale Liste bestehen; die Änderungen synchronisieren sich erst nach erfolgreicher Cloud-Einrichtung.

Es kann eine Weile dauern, bis Firebase auf beiden Geräten live funktioniert. **Die Sync-Funktion ist in diesem Paket vorbereitet, nicht ende-zu-ende verifiziert**. Anonyme Anmeldung kann beim Verlust des Browserspeichers verloren gehen.

## Aktualisieren

Dateien im GitHub-Repository ersetzen. Für CSS/JS-Neuinstallationen bzw. wenn die App noch die alte Oberfläche anzeigt, die PWA einmal online öffnen. Bei späteren Änderungen die `CACHE`-Versionskennung in `sw.js` aktualisieren.

## Lizenzhinweise

Der QR-Code-Generator (`qr.js`) stammt aus einem Fremdprojekt; dessen Lizenz liegt unter `LICENSE-qr.txt`. Der übrige Beispielcode ist für dieses Projekt zusammengestellt.
