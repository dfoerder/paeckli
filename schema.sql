-- ============================================================
--  Weihnachtspäckli-Aktion – Datenbank-Schema (Supabase / Postgres)
-- ============================================================
--  Im Supabase-Dashboard unter "SQL Editor" einfügen und ausführen.
--  Reihenfolge ist wichtig (Tabellen -> View -> Policies -> Beispieldaten).
-- ============================================================

-- ---------- Tabellen ----------

-- Teilnehmende. Verknüpft 1:1 mit dem Supabase-Auth-Benutzer.
create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  name        text not null,
  is_admin    boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Kampagnen-Einstellungen (genau eine Zeile, id = 1).
create table if not exists public.campaign (
  id            int primary key default 1 check (id = 1),
  title         text not null default 'Weihnachtspäckli-Aktion',
  target_adult  int  not null default 50  check (target_adult  >= 0),
  target_kid    int  not null default 100 check (target_kid    >= 0),
  target_date   date                                  -- Stichtag (bis wann fertig)
);
-- Migration: falls die Tabelle bereits ohne target_date existiert.
alter table public.campaign add column if not exists target_date date;
insert into public.campaign (id) values (1) on conflict (id) do nothing;

-- Artikel mit Menge pro Erwachsenen- bzw. Kinderpäckli.
create table if not exists public.articles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  qty_adult   int  not null default 0 check (qty_adult >= 0),  -- pro P. (E)
  qty_kid     int  not null default 0 check (qty_kid   >= 0),  -- pro P. (K)
  donor_note  text,                                            -- "Spenden 2025"
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

-- Käufe der Teilnehmenden.
create table if not exists public.purchases (
  id          uuid primary key default gen_random_uuid(),
  article_id  uuid not null references public.articles on delete cascade,
  user_id     uuid not null references public.profiles on delete cascade default auth.uid(),
  quantity    int  not null check (quantity > 0),
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists purchases_article_idx on public.purchases (article_id);
create index if not exists purchases_user_idx    on public.purchases (user_id);

-- ---------- Status-View: Soll, Bestand, noch kaufen ----------
-- security_invoker => RLS der zugrundeliegenden Tabellen greift.
create or replace view public.article_status
with (security_invoker = true) as
  select
    a.id,
    a.name,
    a.qty_adult,
    a.qty_kid,
    a.donor_note,
    a.sort_order,
    (a.qty_adult * c.target_adult + a.qty_kid * c.target_kid) as total_needed,
    coalesce(sum(p.quantity), 0)                              as bought,
    greatest(a.qty_adult * c.target_adult + a.qty_kid * c.target_kid
             - coalesce(sum(p.quantity), 0), 0)               as still_needed
  from public.articles a
  cross join public.campaign c
  left join public.purchases p on p.article_id = a.id
  group by a.id, c.target_adult, c.target_kid;

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
alter table public.profiles  enable row level security;
alter table public.campaign  enable row level security;
alter table public.articles  enable row level security;
alter table public.purchases enable row level security;

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

-- campaign: alle lesen, nur Admin ändern.
drop policy if exists campaign_select on public.campaign;
create policy campaign_select on public.campaign
  for select to authenticated using (true);

drop policy if exists campaign_update on public.campaign;
create policy campaign_update on public.campaign
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- articles: alle lesen, nur Admin schreiben.
drop policy if exists articles_select on public.articles;
create policy articles_select on public.articles
  for select to authenticated using (true);

drop policy if exists articles_write on public.articles;
create policy articles_write on public.articles
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
--  Beispiel-Artikel aus der Liste 2025 (optional – kann gelöscht werden)
-- ============================================================
insert into public.articles (name, qty_adult, qty_kid, donor_note, sort_order) values
  ('Mehl',                       1, 0, '',                       10),
  ('Reis',                       1, 0, 'Gabriela',               20),
  ('Zucker',                     1, 0, 'Gabriela',               30),
  ('Teigwaren',                  1, 0, 'AVC',                    40),
  ('Schokolade',                 1, 0, 'Annemarie',              50),
  ('Biskuits (Päckli)',          1, 1, 'Elsbeth, Migros',        60),
  ('Kaffee (gemahlen/instant)',  1, 1, 'Cornelia Schumm.',       70),
  ('Tee',                        1, 0, 'AVC',                    80),
  ('Süssigkeiten',               1, 0, 'Erika J.',               90),
  ('Zahnpasta',                  0, 1, 'Migros',                100),
  ('Zahnbürste',                 1, 1, 'Ruetz 50, Rüetschi 100', 110),
  ('Seife (in Alufolie)',        1, 1, 'Ruetz 50, Migros',      120),
  ('Shampoo (Deckel verklebt)',  1, 1, 'Dani Rogenmoser',       130),
  ('Schreibpapier / Hefte',      1, 1, 'Migros',                140),
  ('Kugelschreiber',             4, 4, 'Ingold Biwa, Migros',   150),
  ('Bleistift',                  2, 1, 'Wälchli',               160),
  ('Gummi',                      1, 1, 'Wälchli',               170),
  ('Spitzer',                    0, 1, 'Migros',                180),
  ('Farbstifte',                 0, 1, 'Gaerstecker 0.2/Stk.',  190),
  ('Spielzeug: Plüschtier',      0, 12,'Galaxus',               200),
  ('Spielzeug: Gumpibälle',      0, 2, 'Ricardo',               210),
  ('Spielzeug: Autöli',          0, 1, 'Galaxus',               220),
  ('Spielzeug: Tennisbälle',     0, 1, 'Galaxus',               230),
  ('Spielzeug: Marmeli',         0, 1, 'Walter Tennisclub',     240),
  ('Spielzeug: Div.',            0, 1, '',                      250),
  ('Ansichtskarten',             4, 0, '',                      260),
  ('Kerzen',                     1, 0, 'Regina',                270),
  ('Streichhölzer 10er-Päckli',  1, 0, 'Dani Joss',             280),
  ('Schnur',                     1, 0, 'Walter',                290),
  ('Socken Kinder',              0, 1, '',                      300),
  ('Socken Erwachsene',          1, 0, 'Bachmanns Deutschl.',   310),
  ('Mützen Kinder',              0, 1, 'Erika',                 320),
  ('Mützen Erwachsene',          1, 0, 'Erika',                 330),
  ('Handschuhe Kinder',          0, 1, 'Bachmanns Deutschl.',   340),
  ('Handschuhe Erwachsene',      1, 0, '',                      350),
  ('Decken/Pullis Kinder',       0, 1, '',                      360),
  ('Schals Erwachsene',          1, 0, '',                      370),
  ('Schachteln Kinder',          0, 1, 'AVC',                   380),
  ('Schachteln Erwachsene',      1, 0, 'AVC',                   390),
  ('Geschenkpapier',             1, 1, 'AVC',                   400),
  ('Pyjama Kinder',              0, 1, 'AVC (Kinder)',          410)
on conflict do nothing;
