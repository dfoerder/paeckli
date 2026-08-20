-- ============================================================
--  Migration: Benutzerverwaltung (Admin > Benutzer)
-- ============================================================
--  Für bestehende Supabase-Projekte, die schon laufen und deshalb NICHT das
--  ganze `schema.sql` neu ausführen können (dessen Teardown löscht Artikel,
--  Käufe, Päckli und deren Zusammensetzung).
--
--  Ergänzt die beiden Funktionen hinter der Seite Admin > Benutzer:
--    * set_admin(target_id, make_admin)   – Admin-Rechte vergeben/entziehen
--    * set_password(target_id, new_password) – Passwort einer anderen Person setzen
--
--  Ausführen im Supabase-Dashboard unter **SQL Editor** (Rolle `postgres` –
--  sonst fehlt `set_password` das Schreibrecht auf `auth.users`).
--  Ändert keine Daten und ist gefahrlos mehrfach ausführbar.
--
--  Identisch mit dem gleichnamigen Abschnitt in `schema.sql` – wer beides
--  ändert, muss es an beiden Orten tun.
-- ============================================================

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
