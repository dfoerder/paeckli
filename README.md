# 🎁 Weihnachtspäckli-Aktion

Progressive Web App zum Organisieren der Weihnachtspäckli-Aktion (EGW Langenthal).
Teilnehmende melden ihre Einkäufe, alle sehen in Echtzeit, von welchen Artikeln
schon genug da ist und was noch fehlt.

## Funktionen

- **Login per E-Mail + Passwort** – kein Mailversand, kein Rate-Limit. Passwort
  vergessen? Admin setzt es über die Supabase Admin-API neu (siehe unten).
- **Übersicht** – Einkaufsstand aller Artikel mit Fortschrittsbalken (genug / fehlt noch).
- **Kauf eintragen** – Artikel + Anzahl erfassen.
- **Meine Käufe** – eigene Einträge ansehen und löschen.
- **Profil** (Klick auf den eigenen Namen in der Kopfzeile) – Vorname/Nachname,
  Kontakt-E-Mail/-Telefon sowie das eigene Passwort ändern.
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
   - `profiles` speichert `first_name`/`last_name` (Erstanmeldung) sowie die
     optionalen Spalten `contact_email`/`contact_phone` (für Rückfragen).
     Alles lässt sich im Reiter **Profil** ändern und ist für Admins im
     Reiter **Admin** bei „Alle Käufe (nach Käufer:in)" sichtbar.

> **Bestehende Datenbank aktualisieren:** `schema.sql` **nicht** komplett neu
> einspielen, sobald echte Daten (Artikel, Käufe) existieren – der Teardown-Teil
> am Skriptanfang löscht `articles`/`parcels`/`parcel_content`/`purchases` und
> baut sie mit den Beispieldaten neu auf (`profiles` bleibt zwar erhalten, der
> Rest nicht). Für die `profiles`-Migration genügt es, nur diesen Ausschnitt aus
> `schema.sql` separat im SQL Editor auszuführen:
> ```sql
> alter table public.profiles add column if not exists contact_email text;
> alter table public.profiles add column if not exists contact_phone text;
> alter table public.profiles drop column if exists contact;
> alter table public.profiles add column if not exists first_name text;
> alter table public.profiles add column if not exists last_name text;
> do $$
> begin
>   if exists (select 1 from information_schema.columns
>              where table_schema = 'public' and table_name = 'profiles' and column_name = 'name') then
>     update public.profiles set
>       first_name = coalesce(first_name, split_part(name, ' ', 1)),
>       last_name  = coalesce(last_name, nullif(split_part(name, ' ', 2), ''))
>     where name is not null and first_name is null;
>   end if;
> end $$;
> alter table public.profiles drop column if exists name;
> ```

### 3. E-Mail-Bestätigung deaktivieren

Die App verschickt nie eine Mail (weder beim Registrieren noch bei „Passwort
vergessen“) – dafür muss die Bestätigungsmail beim Registrieren abgeschaltet
werden:

1. **Authentication → Providers → Email**: „Email“ aktiviert lassen, aber
   **„Confirm email“ ausschalten**. Ohne diesen Schritt verlangt Supabase nach
   dem Registrieren eine Bestätigungsmail und Login schlägt fehl.

**Passwort zurücksetzen (kein Selfservice):** Ruft jemand an, weil das
Passwort vergessen wurde, setzt der Admin es direkt über die Supabase
Admin-API neu – ganz ohne Mail oder SMS:

```bash
curl -X PUT 'https://DEIN-PROJEKT.supabase.co/auth/v1/admin/users/<user-id>' \
  -H "apikey: <service_role_key>" \
  -H "Authorization: Bearer <service_role_key>" \
  -H "Content-Type: application/json" \
  -d '{"password":"NeuesPasswort123"}'
```

- `<user-id>` findet sich im Supabase-Dashboard unter **Authentication → Users**.
- Den `service_role_key` gibt es unter **Project Settings → API** – er hat
  vollen Zugriff auf die Datenbank (umgeht Row Level Security) und darf
  **niemals** in `config.js`, im Repo oder sonst im Code landen. Nur lokal
  beim Admin aufbewahren.

### 4. Zugangsdaten in die App eintragen

1. **Project Settings → API** öffnen.
2. `config.js` bearbeiten und eintragen:
   - `SUPABASE_URL` = „Project URL“
   - `SUPABASE_ANON_KEY` = „anon public“ Key
   (Der anon-Key darf öffentlich sein – der Schutz läuft über Row Level Security.)

### 5. Sich selbst zum Admin machen

1. App starten (siehe unten), einmal registrieren (E-Mail + Passwort) und Namen erfassen.
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
