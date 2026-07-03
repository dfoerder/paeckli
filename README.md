# 🎁 Weihnachtspäckli-Aktion

Progressive Web App zum Organisieren der Weihnachtspäckli-Aktion (EGW Langenthal).
Teilnehmende melden ihre Einkäufe, alle sehen in Echtzeit, von welchen Artikeln
schon genug da ist und was noch fehlt.

## Funktionen

- **Login per E-Mail + Passwort** – kein Mailversand, kein Rate-Limit. Passwort
  vergessen? Admin setzt es über die Supabase Admin-API neu (siehe unten).
- **Übersicht** – Einkaufsstand aller Artikel mit Fortschrittsbalken (genug / fehlt noch).
- **Deine Käufe** – Kauf eintragen (Artikel, Anzahl, optional Shop, Spender:in,
  Notiz) und darunter eigene Einträge ansehen und löschen, alles in einem Tab.
- **Profil** (Klick auf den eigenen Namen in der Kopfzeile) – Vorname/Nachname,
  Kontakt-Telefon sowie das eigene Passwort ändern. Die Kontakt-E-Mail ist die
  Login-E-Mail und nicht änderbar; wer eine andere Adresse will, registriert
  ein neues Konto.
- **Päckli-Zusammensetzung** – was kommt in welchen Päckli-Typ (Erwachsene/Kinder).
- **Admin** – Artikelliste (inkl. Menge je Päckli-Typ) verwalten sowie Sammlungen
  (Titel, Stichtag, Anzahl Päckli je Typ). Mehrere Sammlungen möglich (z.B. eine
  pro Jahr) – die neueste ist automatisch aktiv, ältere bleiben einsehbar. Beim
  Anlegen einer neuen Sammlung kann die Päckli-Zusammensetzung der letzten
  übernommen werden.

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
   - `profiles` speichert `first_name`/`last_name` (Erstanmeldung), `contact_email`
     (= Login-E-Mail, automatisch gesetzt, nicht editierbar) und `contact_phone`
     (optional, editierbar). Vor-/Nachname und Telefon lassen sich im Reiter
     **Profil** ändern; alles ist für Admins im Reiter **Admin** bei „Alle
     Käufe (nach Käufer:in)" sichtbar.

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
> update public.profiles p set contact_email = u.email
> from auth.users u where p.id = u.id and p.contact_email is distinct from u.email;
> ```
> Für die neuen Spalten `shop`/`donor` in `purchases` genügt entsprechend:
> ```sql
> alter table public.purchases add column if not exists shop text;
> alter table public.purchases add column if not exists donor text;
> ```
>
> Für die Löschregeln (Artikel mit Käufen oder Päckli-Zuordnung sind nicht
> löschbar) und die abgesicherten `profiles`-Spaltenrechte (verhindert, dass
> sich jemand per API selbst zum Admin macht):
> ```sql
> -- Artikel mit Käufen dürfen nicht gelöscht werden (vorher: Käufe wurden still mitgelöscht).
> alter table public.purchases drop constraint if exists purchases_article_id_fkey;
> alter table public.purchases add constraint purchases_article_id_fkey
>   foreign key (article_id) references public.articles (id) on delete restrict;
>
> -- Artikel müssen erst aus allen Päckli entfernt werden, bevor sie löschbar sind.
> alter table public.parcel_content drop constraint if exists parcel_content_article_id_fkey;
> alter table public.parcel_content add constraint parcel_content_article_id_fkey
>   foreign key (article_id) references public.articles (id) on delete restrict;
>
> -- profiles: is_admin & contact_email nicht selbst änderbar (Spaltenrechte).
> revoke insert, update on public.profiles from authenticated;
> grant insert (id, first_name, last_name, contact_email, contact_phone)
>   on public.profiles to authenticated;
> grant update (first_name, last_name, contact_phone)
>   on public.profiles to authenticated;
> ```
>
> `sort_order` wurde entfernt: `articles` wird jetzt alphabetisch sortiert
> angezeigt, `parcels` ohne festgelegte Reihenfolge (nur zwei Einträge).
> ```sql
> drop view if exists public.article_status;
> alter table public.parcels  drop column if exists sort_order;
> alter table public.articles drop column if exists sort_order;
>
> create or replace view public.article_status
> with (security_invoker = true) as
>   select
>     a.id,
>     a.name,
>     a.notes,
>     coalesce(n.total_needed, 0)                                 as total_needed,
>     coalesce(b.bought, 0)                                       as bought,
>     greatest(coalesce(n.total_needed, 0) - coalesce(b.bought, 0), 0) as still_needed
>   from public.articles a
>   left join (
>     select pc.article_id, sum(pc.quantity * p.number) as total_needed
>     from public.parcel_content pc
>     join public.parcels p on p.id = pc.parcel_id
>     group by pc.article_id
>   ) n on n.article_id = a.id
>   left join (
>     select article_id, sum(quantity) as bought
>     from public.purchases
>     group by article_id
>   ) b on b.article_id = a.id;
> ```
>
> Kategorisierung der Artikel (Esswaren/Hygiene/Kleidung/Schreibwaren/Spielzeug/
> Sonstiges), für die Gruppierung in der Übersicht. Bekannte Artikel aus der
> Beispielliste werden automatisch zugeordnet, alle anderen fallen vorerst unter
> „Sonstiges" und lassen sich im Admin unter **Päckli-Inhalt** nachträglich ändern:
> ```sql
> alter table public.articles add column if not exists category text;
>
> update public.articles a set category = v.category
> from (values
>   ('Mehl', 'Esswaren'), ('Reis', 'Esswaren'), ('Zucker', 'Esswaren'),
>   ('Teigwaren', 'Esswaren'), ('Schokolade', 'Esswaren'), ('Biskuits (Päckli)', 'Esswaren'),
>   ('Kaffee (gemahlen/instant)', 'Esswaren'), ('Tee', 'Esswaren'), ('Süssigkeiten', 'Esswaren'),
>   ('Zahnpasta', 'Hygiene'), ('Zahnbürste', 'Hygiene'), ('Seife (in Alufolie)', 'Hygiene'),
>   ('Shampoo (Deckel verklebt)', 'Hygiene'),
>   ('Schreibpapier / Hefte', 'Schreibwaren'), ('Kugelschreiber', 'Schreibwaren'),
>   ('Bleistift', 'Schreibwaren'), ('Gummi', 'Schreibwaren'), ('Spitzer', 'Schreibwaren'),
>   ('Farbstifte', 'Schreibwaren'),
>   ('Spielzeug: Plüschtier', 'Spielzeug'), ('Spielzeug: Gumpibälle', 'Spielzeug'),
>   ('Spielzeug: Autöli', 'Spielzeug'), ('Spielzeug: Tennisbälle', 'Spielzeug'),
>   ('Spielzeug: Marmeli', 'Spielzeug'), ('Spielzeug: Div.', 'Spielzeug'),
>   ('Ansichtskarten', 'Sonstiges'), ('Kerzen', 'Sonstiges'),
>   ('Streichhölzer 10er-Päckli', 'Sonstiges'), ('Schnur', 'Sonstiges'),
>   ('Schachteln Kinder', 'Sonstiges'), ('Schachteln Erwachsene', 'Sonstiges'),
>   ('Geschenkpapier', 'Sonstiges'),
>   ('Socken Kinder', 'Kleidung'), ('Socken Erwachsene', 'Kleidung'),
>   ('Mützen Kinder', 'Kleidung'), ('Mützen Erwachsene', 'Kleidung'),
>   ('Handschuhe Kinder', 'Kleidung'), ('Handschuhe Erwachsene', 'Kleidung'),
>   ('Decken/Pullis Kinder', 'Kleidung'), ('Schals Erwachsene', 'Kleidung'),
>   ('Pyjama Kinder', 'Kleidung')
> ) as v(name, category)
> where a.name = v.name and a.category is null;
>
> update public.articles set category = 'Sonstiges' where category is null;
> alter table public.articles alter column category set not null;
> alter table public.articles alter column category set default 'Sonstiges';
> alter table public.articles add constraint articles_category_check
>   check (category in ('Esswaren', 'Hygiene', 'Kleidung', 'Schreibwaren', 'Spielzeug', 'Sonstiges'));
>
> drop view if exists public.article_status;
> create or replace view public.article_status
> with (security_invoker = true) as
>   select
>     a.id,
>     a.name,
>     a.notes,
>     a.category,
>     coalesce(n.total_needed, 0)                                 as total_needed,
>     coalesce(b.bought, 0)                                       as bought,
>     greatest(coalesce(n.total_needed, 0) - coalesce(b.bought, 0), 0) as still_needed
>   from public.articles a
>   left join (
>     select pc.article_id, sum(pc.quantity * p.number) as total_needed
>     from public.parcel_content pc
>     join public.parcels p on p.id = pc.parcel_id
>     group by pc.article_id
>   ) n on n.article_id = a.id
>   left join (
>     select article_id, sum(quantity) as bought
>     from public.purchases
>     group by article_id
>   ) b on b.article_id = a.id;
> ```
>
> **Mehrere Sammlungen (z.B. eine pro Jahr):** Grössere Migration – aus der
> bisherigen Singleton-Tabelle `campaign` (genau eine Zeile) wird `campaigns`
> (mehrzeilig, jede Zeile eine „Sammlung"). Käufe (`purchases`) bekommen eine
> `campaign_id`, damit eine neue Sammlung beim Fortschritt bei 0 startet statt
> alte Käufe mitzuzählen. Die bestehende einzelne Sammlung samt ihren Päckli-
> Typen und allen bisherigen Käufen wird dabei automatisch übernommen – es
> geht nichts verloren. Danach im Admin-Bereich unter **Sammlungen** einmal
> `Titel` und `Stichtag` der übernommenen Sammlung kontrollieren. Idempotent,
> also gefahrlos mehrfach ausführbar:
> ```sql
> -- 1. Neue campaigns-Tabelle anlegen und die bestehende einzelne Sammlung
> --    (aus der alten campaign-Tabelle) einmalig übernehmen.
> create table if not exists public.campaigns (
>   id            uuid primary key default gen_random_uuid(),
>   title         text not null default 'Weihnachtspäckli-Aktion',
>   target_date   date,
>   created_at    timestamptz not null default now()
> );
> insert into public.campaigns (title, target_date)
> select title, target_date from public.campaign
> where not exists (select 1 from public.campaigns);
>
> -- 2. parcels.campaign_id von int (Fremdschlüssel auf campaign) auf uuid
> --    (Fremdschlüssel auf campaigns) umstellen. Da bisher nur eine Sammlung
> --    existierte, bekommen alle vorhandenen Päckli-Typen deren neue id.
> do $$
> begin
>   if exists (
>     select 1 from information_schema.columns
>     where table_schema = 'public' and table_name = 'parcels'
>       and column_name = 'campaign_id' and data_type = 'integer'
>   ) then
>     alter table public.parcels add column campaign_id_new uuid;
>     update public.parcels set campaign_id_new = (select id from public.campaigns order by created_at limit 1);
>     alter table public.parcels drop column campaign_id;
>     alter table public.parcels rename column campaign_id_new to campaign_id;
>     alter table public.parcels alter column campaign_id set not null;
>     alter table public.parcels add constraint parcels_campaign_id_fkey
>       foreign key (campaign_id) references public.campaigns (id) on delete cascade;
>   end if;
> end $$;
> create index if not exists parcels_campaign_idx on public.parcels (campaign_id);
>
> -- 3. purchases: campaign_id ergänzen, bestehende Käufe der (einzigen)
> --    bisherigen Sammlung zuordnen (sie wurden ja für diese getätigt).
> alter table public.purchases add column if not exists campaign_id uuid;
> update public.purchases set campaign_id = (select id from public.campaigns order by created_at limit 1)
>   where campaign_id is null;
> alter table public.purchases alter column campaign_id set not null;
> alter table public.purchases drop constraint if exists purchases_campaign_id_fkey;
> alter table public.purchases add constraint purchases_campaign_id_fkey
>   foreign key (campaign_id) references public.campaigns (id) on delete restrict;
> create index if not exists purchases_campaign_idx on public.purchases (campaign_id);
>
> -- 4. Alte campaign-Tabelle (Singleton) entfernen.
> drop table if exists public.campaign;
>
> -- 5. article_status-View neu: jetzt pro Sammlung statt global (campaign_id
> --    dazu, bought/still_needed nur noch innerhalb derselben Sammlung).
> drop view if exists public.article_status;
> create or replace view public.article_status
> with (security_invoker = true) as
>   select
>     a.id,
>     n.campaign_id,
>     a.name,
>     a.notes,
>     a.category,
>     n.total_needed,
>     coalesce(b.bought, 0) as bought,
>     greatest(n.total_needed - coalesce(b.bought, 0), 0) as still_needed
>   from public.articles a
>   join (
>     select pc.article_id, p.campaign_id, sum(pc.quantity * p.number) as total_needed
>     from public.parcel_content pc
>     join public.parcels p on p.id = pc.parcel_id
>     group by pc.article_id, p.campaign_id
>   ) n on n.article_id = a.id
>   left join (
>     select article_id, campaign_id, sum(quantity) as bought
>     from public.purchases
>     group by article_id, campaign_id
>   ) b on b.article_id = a.id and b.campaign_id = n.campaign_id;
>
> -- 6. Neue View für die Löschregeln: Käufe je Artikel über ALLE Sammlungen
> --    hinweg (der on-delete-restrict auf purchases.article_id kennt keine
> --    Sammlungsgrenzen).
> create or replace view public.article_purchase_totals
> with (security_invoker = true) as
>   select article_id as id, sum(quantity) as bought
>   from public.purchases
>   group by article_id;
>
> -- 7. RLS für campaigns (Rechte campaign -> campaigns übernehmen + neue
> --    Insert-Policy fürs Anlegen einer neuen Sammlung).
> alter table public.campaigns enable row level security;
> drop policy if exists campaigns_select on public.campaigns;
> create policy campaigns_select on public.campaigns
>   for select to authenticated using (true);
> drop policy if exists campaigns_update on public.campaigns;
> create policy campaigns_update on public.campaigns
>   for update to authenticated using (public.is_admin()) with check (public.is_admin());
> drop policy if exists campaigns_insert on public.campaigns;
> create policy campaigns_insert on public.campaigns
>   for insert to authenticated with check (public.is_admin());
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
