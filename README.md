# 🎁 Weihnachtspäckli-Aktion

Progressive Web App zum Organisieren der Weihnachtspäckli-Aktion (EGW Langenthal).
Teilnehmende melden ihre Einkäufe, alle sehen in Echtzeit, von welchen Artikeln
schon genug da ist und was noch fehlt.

## Funktionen

- **Login per Magic-Link** – E-Mail eingeben, Anmelde-Link kommt per Mail (kein Passwort).
- **Übersicht** – Einkaufsstand aller Artikel mit Fortschrittsbalken (genug / fehlt noch).
- **Kauf eintragen** – Artikel + Anzahl erfassen.
- **Meine Käufe** – eigene Einträge ansehen und löschen.
- **Päckli-Zusammensetzung** – was kommt in welchen Päckli-Typ (Erwachsene/Kinder).
- **Admin** – Artikelliste (inkl. Menge je Päckli-Typ) und Ziele (Anzahl Päckli) verwalten.

## Tech-Stack

- Reines HTML/CSS/JS – kein Framework, kein Build-Step (wie *zeit-lernen*).
- [Supabase](https://supabase.com) als Backend (Postgres + Auth + Row Level Security).
- PWA: installierbar, offline-fähig für die App-Hülle (Daten brauchen Internet).

---

## Einrichtung (einmalig)

### 1. Supabase-Projekt anlegen

1. Auf [supabase.com](https://supabase.com) kostenlos registrieren, **New Project** erstellen.
2. Projekt-Name und ein Datenbank-Passwort wählen, Region z.B. *Frankfurt*.
3. Warten, bis das Projekt bereit ist (~1 Min.).

### 2. Datenbank-Schema einspielen

1. Im Supabase-Dashboard: **SQL Editor** → **New query**.
2. Inhalt von [`schema.sql`](schema.sql) komplett einfügen und **Run** klicken.
   - Legt alle Tabellen, die Status-View, die Sicherheitsregeln **und** die
     Artikel aus der Liste 2025 als Startdaten an.
   - `profiles` enthält eine optionale Spalte `contact` (Tel./E-Mail für
     Rückfragen). Sie wird bei der Erstanmeldung abgefragt, lässt sich im
     Reiter **Käufe** ändern und ist für Admins im Reiter **Admin** bei
     „Alle Käufe (nach Käufer:in)" sichtbar.

> **Bestehende Datenbank aktualisieren:** Wenn das Schema schon einmal
> eingespielt wurde und nur die Spalte `contact` fehlt, genügt es, im SQL
> Editor `alter table public.profiles add column if not exists contact text;`
> auszuführen (in `schema.sql` bereits enthalten).

### 3. Magic-Link / E-Mail konfigurieren

1. **Authentication → Providers → Email**: „Email“ aktiviert lassen.
2. **Authentication → URL Configuration**: bei *Redirect URLs* die Adressen
   eintragen, unter denen die App läuft, z.B.:
   - `http://localhost:8091` (lokale Entwicklung)
   - `https://DEIN-NAME.github.io/paeckli/` (GitHub Pages)
3. Hinweis: Der eingebaute Supabase-Mailversand ist auf wenige Mails/Stunde
   begrenzt – für eine kleine Helfergruppe reicht das. Bei Bedarf einen eigenen
   SMTP-Anbieter unter *Authentication → Emails* hinterlegen.

### 4. Zugangsdaten in die App eintragen

1. **Project Settings → API** öffnen.
2. `config.js` bearbeiten und eintragen:
   - `SUPABASE_URL` = „Project URL“
   - `SUPABASE_ANON_KEY` = „anon public“ Key
   (Der anon-Key darf öffentlich sein – der Schutz läuft über Row Level Security.)

### 5. Sich selbst zum Admin machen

1. App starten (siehe unten) und einmal per Magic-Link anmelden, Namen erfassen.
2. Im Supabase-Dashboard: **Table Editor → profiles** → bei deinem Eintrag
   `is_admin` auf `true` setzen. (Oder im SQL Editor:
   `update profiles set is_admin = true where name = 'Dein Name';`)
3. App neu laden – der Reiter **Admin** erscheint.

---

## Lokal entwickeln

```bash
npx serve . -l 8091
# öffnet auf http://localhost:8091
```

Service Worker bei Problemen loswerden:
DevTools → Application → Service Workers → *Unregister*, dann Hard-Reload
(Cmd+Shift+R). Oder `CACHE_NAME` in `sw.js` hochzählen.

## Deployment (GitHub Pages)

1. Repo zu GitHub pushen.
2. **Settings → Pages** → Branch `main` (oder `gh-pages`), Ordner `/`.
3. Wichtig: Da `config.js` in `.gitignore` steht, wird sie **nicht** mit
   deployed. Für GitHub Pages eine der beiden Varianten wählen:
   - `config.js` aus `.gitignore` entfernen und mit-committen (anon-Key ist
     öffentlich, das ist okay), **oder**
   - die Werte beim Deployment anders bereitstellen.
4. Die unter Schritt 3 (Einrichtung) genannte GitHub-Pages-URL als Redirect-URL
   in Supabase eintragen.

## Dateien

| Datei | Zweck |
|---|---|
| `index.html` | App-Hülle, alle Ansichten |
| `style.css` | Styling (CSS Custom Properties, kein Framework) |
| `app.js` | Gesamte Logik (Auth, Daten, Ansichten) |
| `config.js` | Supabase-Zugangsdaten (lokal, nicht im Git) |
| `schema.sql` | Datenbank-Setup für Supabase |
| `sw.js` | Service Worker (Offline-Hülle) |
| `manifest.json` | PWA-Manifest |
| `img/excel-vorlage-2025.jpeg` | Original-Liste als Referenz |
