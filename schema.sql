-- ============================================================
--  Weihnachtspäckli-Aktion – Datenbank-Schema (Supabase / Postgres)
-- ============================================================
--  Im Supabase-Dashboard unter "SQL Editor" einfügen und ausführen.
--  Reihenfolge ist wichtig (Teardown -> Tabellen -> View -> Policies -> Beispieldaten).
--
--  Datenmodell: Päckli-Typen liegen in `parcels` (vorerst Erwachsene/E, Kinder/K),
--  die Zusammensetzung in `parcel_content`. `articles` enthält nur noch den
--  Artikel selbst. So lassen sich weitere Päckli-Typen anlegen, ohne Spalten zu
--  ändern.
-- ============================================================

-- ---------- Teardown (nur Datentabellen; profiles + campaign bleiben) ----------
-- Reihenfolge wegen Fremdschlüsseln. Beim sauberen Neuaufbau gehen Beispiel-
-- Artikel & -Käufe verloren; Teilnehmende (profiles) und Kampagne bleiben.
drop view  if exists public.article_status;
drop table if exists public.parcel_content;
drop table if exists public.purchases;
drop table if exists public.parcels;
drop table if exists public.articles;

-- ---------- Tabellen ----------

-- Teilnehmende. Verknüpft 1:1 mit dem Supabase-Auth-Benutzer.
create table if not exists public.profiles (
  id             uuid primary key references auth.users on delete cascade,
  first_name     text not null,
  last_name      text not null,
  contact_email  text,                                   -- = Login-E-Mail, bei Registrierung gesetzt, nicht editierbar
  contact_phone  text,                                   -- Telefon für Rückfragen (optional, editierbar)
  is_admin       boolean not null default false,
  created_at     timestamptz not null default now()
);
-- Migration für bestehende Deployments (Tabelle wird nicht neu erstellt).
alter table public.profiles add column if not exists contact_email text;
alter table public.profiles add column if not exists contact_phone text;
alter table public.profiles drop column if exists contact;
alter table public.profiles add column if not exists first_name text;
alter table public.profiles add column if not exists last_name text;
-- Best-effort Migration aus altem `name`-Feld (erstes Wort -> Vorname, Rest -> Nachname).
-- Bei zusammengesetzten Nachnamen danach ggf. im Table Editor korrigieren.
-- In einen DO-Block verpackt, damit das Skript beim erneuten Ausführen (nachdem
-- `name` schon entfernt wurde) nicht mit "column does not exist" fehlschlägt.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'profiles' and column_name = 'name') then
    update public.profiles set
      first_name = coalesce(first_name, split_part(name, ' ', 1)),
      last_name  = coalesce(last_name, nullif(split_part(name, ' ', 2), ''))
    where name is not null and first_name is null;
  end if;
end $$;
alter table public.profiles drop column if exists name;
-- contact_email an die tatsächliche Login-E-Mail angleichen (ab jetzt fest
-- gekoppelt, nicht mehr frei editierbar). Gefahrlos mehrfach ausführbar.
update public.profiles p set contact_email = u.email
from auth.users u where p.id = u.id and p.contact_email is distinct from u.email;

-- Kampagnen-Einstellungen (genau eine Zeile, id = 1).
-- Die Anzahl Päckli liegt jetzt pro Typ in `parcels.number`.
create table if not exists public.campaign (
  id            int primary key default 1 check (id = 1),
  title         text not null default 'Weihnachtspäckli-Aktion',
  target_date   date                                  -- Stichtag (bis wann fertig)
);
-- Migration: alte Spalten (Ziel pro Typ) entfernen, Stichtag sicherstellen.
alter table public.campaign add  column if not exists target_date  date;
alter table public.campaign drop column if exists target_adult;
alter table public.campaign drop column if exists target_kid;
insert into public.campaign (id) values (1) on conflict (id) do nothing;

-- Päckli-Typen. Vorerst zwei Zeilen (Erwachsene, Kinder).
create table public.parcels (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  int  not null references public.campaign on delete cascade default 1,
  name         text not null,                                  -- "Erwachsene", "Kinder"
  abbreviation text not null,                                  -- "E", "K"
  number       int  not null default 0 check (number >= 0),    -- Anzahl Päckli (Ziel)
  sort_order   int  not null default 0,
  created_at   timestamptz not null default now()
);

-- Artikel (ohne Mengen – die Menge je Päckli steht in parcel_content).
create table public.articles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  notes       text,                                            -- freie Notiz (optional)
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

-- Zusammensetzung: wie viele Stück eines Artikels in einen Päckli-Typ gehören.
-- article_id mit `restrict`: Ein Artikel muss erst aus allen Päckli entfernt
-- werden, bevor er gelöscht werden kann (kein stilles Mitlöschen).
create table public.parcel_content (
  id          uuid primary key default gen_random_uuid(),
  parcel_id   uuid not null references public.parcels  on delete cascade,
  article_id  uuid not null references public.articles on delete restrict,
  quantity    int  not null check (quantity > 0),
  unique (parcel_id, article_id)
);
create index if not exists parcel_content_parcel_idx  on public.parcel_content (parcel_id);
create index if not exists parcel_content_article_idx on public.parcel_content (article_id);

-- Käufe der Teilnehmenden.
-- article_id mit `restrict`: Ein Artikel, den schon jemand gekauft hat, kann
-- nicht gelöscht werden – Käufe stehen für physisch vorhandene Ware.
create table public.purchases (
  id          uuid primary key default gen_random_uuid(),
  article_id  uuid not null references public.articles on delete restrict,
  user_id     uuid not null references public.profiles on delete cascade default auth.uid(),
  quantity    int  not null check (quantity > 0),
  note        text,
  shop        text,                                    -- Einkaufsort (optional)
  donor       text,                                    -- Name Spender:in, falls nicht Käufer:in (optional)
  created_at  timestamptz not null default now()
);
create index if not exists purchases_article_idx on public.purchases (article_id);
create index if not exists purchases_user_idx    on public.purchases (user_id);

-- ---------- Status-View: Soll, Bestand, noch kaufen ----------
-- security_invoker => RLS der zugrundeliegenden Tabellen greift.
-- total_needed = Σ über alle Päckli (quantity × number).
create or replace view public.article_status
with (security_invoker = true) as
  select
    a.id,
    a.name,
    a.notes,
    a.sort_order,
    coalesce(n.total_needed, 0)                                 as total_needed,
    coalesce(b.bought, 0)                                       as bought,
    greatest(coalesce(n.total_needed, 0) - coalesce(b.bought, 0), 0) as still_needed
  from public.articles a
  left join (
    select pc.article_id, sum(pc.quantity * p.number) as total_needed
    from public.parcel_content pc
    join public.parcels p on p.id = pc.parcel_id
    group by pc.article_id
  ) n on n.article_id = a.id
  left join (
    select article_id, sum(quantity) as bought
    from public.purchases
    group by article_id
  ) b on b.article_id = a.id;

-- ---------- Helfer-Funktion: ist der aktuelle Benutzer Admin? ----------
-- security definer, damit die Policy nicht rekursiv die profiles-RLS auslöst.
create or replace function public.is_admin()
  returns boolean
  language sql
  security definer
  stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_admin
  );
$$;

-- ============================================================
--  Row Level Security
-- ============================================================
alter table public.profiles       enable row level security;
alter table public.campaign       enable row level security;
alter table public.parcels        enable row level security;
alter table public.articles       enable row level security;
alter table public.parcel_content enable row level security;
alter table public.purchases      enable row level security;

-- profiles: alle Angemeldeten dürfen lesen (um zu sehen, wer was gekauft hat),
--           aber nur den eigenen Datensatz anlegen/ändern.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated with check (id = auth.uid());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Spaltenrechte: RLS prüft nur, WELCHE Zeile geändert wird – nicht welche
-- Spalten. Ohne diese Grants könnte sich jede angemeldete Person per API
-- selbst `is_admin = true` setzen oder die Kontakt-E-Mail ändern. Deshalb:
-- Schreibrechte auf die harmlosen Spalten beschränken (contact_email nur beim
-- Anlegen, da sie dann aus der Login-E-Mail übernommen wird).
-- `is_admin` wird weiterhin manuell im SQL Editor / Table Editor gesetzt.
revoke insert, update on public.profiles from authenticated;
grant insert (id, first_name, last_name, contact_email, contact_phone)
  on public.profiles to authenticated;
grant update (first_name, last_name, contact_phone)
  on public.profiles to authenticated;

-- campaign: alle lesen, nur Admin ändern.
drop policy if exists campaign_select on public.campaign;
create policy campaign_select on public.campaign
  for select to authenticated using (true);

drop policy if exists campaign_update on public.campaign;
create policy campaign_update on public.campaign
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- parcels: alle lesen, nur Admin schreiben.
drop policy if exists parcels_select on public.parcels;
create policy parcels_select on public.parcels
  for select to authenticated using (true);

drop policy if exists parcels_write on public.parcels;
create policy parcels_write on public.parcels
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- articles: alle lesen, nur Admin schreiben.
drop policy if exists articles_select on public.articles;
create policy articles_select on public.articles
  for select to authenticated using (true);

drop policy if exists articles_write on public.articles;
create policy articles_write on public.articles
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- parcel_content: alle lesen, nur Admin schreiben.
drop policy if exists parcel_content_select on public.parcel_content;
create policy parcel_content_select on public.parcel_content
  for select to authenticated using (true);

drop policy if exists parcel_content_write on public.parcel_content;
create policy parcel_content_write on public.parcel_content
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- purchases: alle lesen (Transparenz des Bestands),
--            eigene anlegen/ändern/löschen, Admin darf alle ändern/löschen.
drop policy if exists purchases_select on public.purchases;
create policy purchases_select on public.purchases
  for select to authenticated using (true);

drop policy if exists purchases_insert on public.purchases;
create policy purchases_insert on public.purchases
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists purchases_update on public.purchases;
create policy purchases_update on public.purchases
  for update to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

drop policy if exists purchases_delete on public.purchases;
create policy purchases_delete on public.purchases
  for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ============================================================
--  Beispieldaten aus der Liste 2025 (optional – kann gelöscht werden)
-- ============================================================

-- Päckli-Typen.
insert into public.parcels (name, abbreviation, number, sort_order) values
  ('Erwachsene', 'E',  50, 10),
  ('Kinder',     'K', 100, 20);

-- Artikel (ohne Mengen, ohne Notizen).
insert into public.articles (name, sort_order) values
  ('Mehl',                       10),
  ('Reis',                       20),
  ('Zucker',                     30),
  ('Teigwaren',                  40),
  ('Schokolade',                 50),
  ('Biskuits (Päckli)',          60),
  ('Kaffee (gemahlen/instant)',  70),
  ('Tee',                        80),
  ('Süssigkeiten',               90),
  ('Zahnpasta',                 100),
  ('Zahnbürste',                110),
  ('Seife (in Alufolie)',       120),
  ('Shampoo (Deckel verklebt)', 130),
  ('Schreibpapier / Hefte',     140),
  ('Kugelschreiber',            150),
  ('Bleistift',                 160),
  ('Gummi',                     170),
  ('Spitzer',                   180),
  ('Farbstifte',                190),
  ('Spielzeug: Plüschtier',     200),
  ('Spielzeug: Gumpibälle',     210),
  ('Spielzeug: Autöli',         220),
  ('Spielzeug: Tennisbälle',    230),
  ('Spielzeug: Marmeli',        240),
  ('Spielzeug: Div.',           250),
  ('Ansichtskarten',            260),
  ('Kerzen',                    270),
  ('Streichhölzer 10er-Päckli', 280),
  ('Schnur',                    290),
  ('Socken Kinder',             300),
  ('Socken Erwachsene',         310),
  ('Mützen Kinder',             320),
  ('Mützen Erwachsene',         330),
  ('Handschuhe Kinder',         340),
  ('Handschuhe Erwachsene',     350),
  ('Decken/Pullis Kinder',      360),
  ('Schals Erwachsene',         370),
  ('Schachteln Kinder',         380),
  ('Schachteln Erwachsene',     390),
  ('Geschenkpapier',            400),
  ('Pyjama Kinder',             410)
on conflict do nothing;

-- Zusammensetzung: (Artikel, Päckli-Kürzel, Menge je Päckli), nur Menge > 0.
-- Entspricht den früheren qty_adult (E) / qty_kid (K)-Werten.
insert into public.parcel_content (parcel_id, article_id, quantity)
select p.id, a.id, v.qty
from (values
  ('Mehl',                       'E',  1),
  ('Reis',                       'E',  1),
  ('Zucker',                     'E',  1),
  ('Teigwaren',                  'E',  1),
  ('Schokolade',                 'E',  1),
  ('Biskuits (Päckli)',          'E',  1), ('Biskuits (Päckli)',          'K', 1),
  ('Kaffee (gemahlen/instant)',  'E',  1), ('Kaffee (gemahlen/instant)',  'K', 1),
  ('Tee',                        'E',  1),
  ('Süssigkeiten',               'E',  1),
  ('Zahnpasta',                  'K',  1),
  ('Zahnbürste',                 'E',  1), ('Zahnbürste',                 'K', 1),
  ('Seife (in Alufolie)',        'E',  1), ('Seife (in Alufolie)',        'K', 1),
  ('Shampoo (Deckel verklebt)',  'E',  1), ('Shampoo (Deckel verklebt)',  'K', 1),
  ('Schreibpapier / Hefte',      'E',  1), ('Schreibpapier / Hefte',      'K', 1),
  ('Kugelschreiber',             'E',  4), ('Kugelschreiber',             'K', 4),
  ('Bleistift',                  'E',  2), ('Bleistift',                  'K', 1),
  ('Gummi',                      'E',  1), ('Gummi',                      'K', 1),
  ('Spitzer',                    'K',  1),
  ('Farbstifte',                 'K',  1),
  ('Spielzeug: Plüschtier',      'K', 12),
  ('Spielzeug: Gumpibälle',      'K',  2),
  ('Spielzeug: Autöli',          'K',  1),
  ('Spielzeug: Tennisbälle',     'K',  1),
  ('Spielzeug: Marmeli',         'K',  1),
  ('Spielzeug: Div.',            'K',  1),
  ('Ansichtskarten',             'E',  4),
  ('Kerzen',                     'E',  1),
  ('Streichhölzer 10er-Päckli',  'E',  1),
  ('Schnur',                     'E',  1),
  ('Socken Kinder',              'K',  1),
  ('Socken Erwachsene',          'E',  1),
  ('Mützen Kinder',              'K',  1),
  ('Mützen Erwachsene',          'E',  1),
  ('Handschuhe Kinder',          'K',  1),
  ('Handschuhe Erwachsene',      'E',  1),
  ('Decken/Pullis Kinder',       'K',  1),
  ('Schals Erwachsene',          'E',  1),
  ('Schachteln Kinder',          'K',  1),
  ('Schachteln Erwachsene',      'E',  1),
  ('Geschenkpapier',             'E',  1), ('Geschenkpapier',             'K', 1),
  ('Pyjama Kinder',              'K',  1)
) as v(article_name, parcel_abbr, qty)
join public.articles a on a.name         = v.article_name
join public.parcels  p on p.abbreviation = v.parcel_abbr
where v.qty > 0
on conflict (parcel_id, article_id) do nothing;
