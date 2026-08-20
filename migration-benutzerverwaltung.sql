-- ============================================================
--  Migration: Benutzerverwaltung (Admin > Benutzer)
-- ============================================================
--  Für bestehende Supabase-Projekte, die schon laufen und deshalb NICHT das
--  ganze `schema.sql` neu ausführen können (dessen Teardown löscht Artikel,
--  Käufe, Päckli und deren Zusammensetzung).
--
--  Ergänzt alles hinter der Seite Admin > Benutzer:
--    * View user_purchase_totals            – Käufe je Person (für die Löschregel)
--    * set_admin(target_id, make_admin)     – Admin-Rechte vergeben/entziehen
--    * set_password(target_id, new_password) – Passwort einer anderen Person setzen
--    * delete_user(target_id)               – Person löschen (nur ohne Käufe)
--
--  Ausführen im Supabase-Dashboard unter **SQL Editor** (Rolle `postgres` –
--  sonst fehlt `set_password`/`delete_user` das Schreibrecht auf `auth.users`).
--  Ändert keine Daten und ist gefahrlos mehrfach ausführbar.
--
--  Identisch mit den gleichnamigen Abschnitten in `schema.sql` – wer etwas
--  ändert, muss es an beiden Orten tun.
-- ============================================================

-- ---------- Käufe je Person über ALLE Sammlungen hinweg ----------
-- Für die Löschregel bei Personen (siehe delete_user): Wer je einen Kauf
-- erfasst hat, kann nicht gelöscht werden – sonst verschwänden die Käufe per
-- `on delete cascade` mit und der Einkaufsstand sänke, obwohl die Ware
-- physisch vorhanden ist.
create or replace view public.user_purchase_totals
with (security_invoker = true) as
  select user_id as id, count(*) as purchases, sum(quantity) as bought
  from public.purchases
  group by user_id;

-- ---------- Benutzerverwaltung: Admin-Rechte vergeben/entziehen ----------
-- `is_admin` ist für `authenticated` bewusst nicht beschreibbar (Spaltenrechte
-- in `schema.sql`), sonst könnte sich jede:r selbst zum Admin machen.
-- Diese Funktion umgeht das kontrolliert: security definer, aber nur für
-- Admins und mit Schutz davor, dass sich die Verwaltung selbst aussperrt.
create or replace function public.set_admin(target_id uuid, make_admin boolean)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  admin_count int;
begin
  if not public.is_admin() then
    raise exception 'Nur Admins dürfen Admin-Rechte vergeben.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.profiles where id = target_id) then
    raise exception 'Person nicht gefunden.' using errcode = 'P0002';
  end if;

  if not make_admin then
    -- Wer sich selbst degradiert, sperrt sich ggf. aus der Verwaltung aus.
    if target_id = auth.uid() then
      raise exception 'Die eigenen Admin-Rechte kann man nicht entziehen.' using errcode = '42501';
    end if;
    -- Sicherheitsnetz: mindestens eine Person behält Admin-Rechte. (Kann durch
    -- die Selbst-Sperre oben eigentlich nicht eintreten, schadet aber nicht.)
    select count(*) into admin_count from public.profiles where is_admin;
    if admin_count <= 1 then
      raise exception 'Es muss mindestens eine Person mit Admin-Rechten geben.' using errcode = '42501';
    end if;
  end if;

  update public.profiles set is_admin = make_admin where id = target_id;
end;
$$;

revoke all on function public.set_admin(uuid, boolean) from public;
grant execute on function public.set_admin(uuid, boolean) to authenticated;

-- ---------- Benutzerverwaltung: Passwort einer anderen Person setzen ----------
-- Damit jede:r Admin helfen kann, wenn ein Passwort vergessen wurde – direkt
-- in der App statt über die Supabase-Admin-API. Der service_role-Key bleibt
-- damit ganz aus dem Spiel; er gehört nie in ein öffentliches Frontend.
--
-- Der Hash wird direkt in `auth.users` geschrieben (bcrypt, genau wie GoTrue
-- selbst es tut). Bewusst KEIN Mailversand. Bestehende Anmeldungen der Person
-- auf ihren Geräten bleiben gültig – sie braucht das neue Passwort erst beim
-- nächsten Login.
--
-- Wichtig: dieses Skript im Supabase-SQL-Editor ausführen (Rolle `postgres`),
-- damit die Funktion einem Besitzer mit Schreibrecht auf `auth.users` gehört.
create extension if not exists pgcrypto with schema extensions;

create or replace function public.set_password(target_id uuid, new_password text)
  returns void
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
begin
  if not public.is_admin() then
    raise exception 'Nur Admins dürfen Passwörter setzen.' using errcode = '42501';
  end if;

  if new_password is null or length(new_password) < 6 then
    raise exception 'Das Passwort muss mindestens 6 Zeichen haben.' using errcode = '22023';
  end if;

  -- Nur Personen, die es in dieser App wirklich gibt (nicht irgendeine
  -- auth.users-Zeile).
  if not exists (select 1 from public.profiles where id = target_id) then
    raise exception 'Person nicht gefunden.' using errcode = 'P0002';
  end if;

  update auth.users
     set encrypted_password = crypt(new_password, gen_salt('bf', 10)),
         updated_at = now()
   where id = target_id;
end;
$$;

revoke all on function public.set_password(uuid, text) from public;
grant execute on function public.set_password(uuid, text) to authenticated;

-- ---------- Benutzerverwaltung: Person löschen ----------
-- Löscht die Zeile in `auth.users`; `profiles` (und damit Sitzungen und
-- Anmelde-Identitäten) hängen per `on delete cascade` daran und verschwinden
-- mit. Gedacht für Tippfehler-Konten, Doppelregistrierungen und Personen, die
-- doch nicht mitmachen.
--
-- Gesperrt, sobald die Person Käufe erfasst hat (über alle Sammlungen
-- hinweg): `purchases.user_id` hängt per `on delete cascade` an `profiles`,
-- die Käufe würden also stillschweigend mitgelöscht und der Einkaufsstand
-- sänke, obwohl die Ware physisch bei jemandem lagert. Gleiche Logik wie bei
-- Artikeln, die schon gekauft wurden. Wer so jemanden wirklich entfernen
-- will, löscht zuerst deren Käufe.
create or replace function public.delete_user(target_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  purchase_count int;
begin
  if not public.is_admin() then
    raise exception 'Nur Admins dürfen Personen löschen.' using errcode = '42501';
  end if;

  -- Sich selbst zu löschen würde die eigene Sitzung ins Leere laufen lassen.
  if target_id = auth.uid() then
    raise exception 'Das eigene Konto lässt sich hier nicht löschen.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.profiles where id = target_id) then
    raise exception 'Person nicht gefunden.' using errcode = 'P0002';
  end if;

  select count(*) into purchase_count from public.purchases where user_id = target_id;
  if purchase_count > 0 then
    raise exception 'Person hat % Käufe erfasst und kann nicht gelöscht werden.', purchase_count
      using errcode = '42501';
  end if;

  delete from auth.users where id = target_id;
end;
$$;

revoke all on function public.delete_user(uuid) from public;
grant execute on function public.delete_user(uuid) to authenticated;
