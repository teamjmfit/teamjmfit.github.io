-- =====================================================================
--  TEAM JMFIT · Migración 004 · Endurecimiento de seguridad
--  Aditiva e idempotente. Objetivo: aunque un cliente tenga el móvil
--  comprometido (o sea malicioso), solo puede ver y tocar lo suyo.
-- =====================================================================

-- 1) Enlazar una ficha de cliente SOLO con una cuenta de correo verificado.
--    Antes se usaba profiles.email, que el propio usuario puede editar: un cliente
--    podía poner el correo de un cliente futuro y quedarse con su ficha.
create or replace function public.link_client_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.email := lower(trim(new.email));
  if new.user_id is null then
    select u.id into new.user_id
      from auth.users u
     where lower(u.email) = new.email
       and u.email_confirmed_at is not null
       and not exists (select 1 from public.clients c2 where c2.user_id = u.id and c2.id is distinct from new.id)
     limit 1;
  end if;
  return new;
end $$;

-- 2) Un cliente no puede cambiarse el correo ni el rol en su perfil
create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_coach() then
    new.id := old.id; new.email := old.email; new.role := old.role;
  end if;
  return new;
end $$;
drop trigger if exists profiles_protect on public.profiles;
create trigger profiles_protect before update on public.profiles
  for each row execute function public.protect_profile();

-- 3) Campos que solo escribe el entrenador (respuesta y "visto")
create or replace function public.protect_coach_fields() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_coach() then return new; end if;
  if tg_op = 'INSERT' then
    new.coach_seen := false;
    if tg_table_name = 'checkins' then new.coach_reply := null; end if;
  else
    new.coach_seen := old.coach_seen;
    if tg_table_name = 'checkins' then new.coach_reply := old.coach_reply; end if;
    new.client_id := old.client_id;
  end if;
  return new;
end $$;
drop trigger if exists checkins_protect on public.checkins;
create trigger checkins_protect before insert or update on public.checkins
  for each row execute function public.protect_coach_fields();
drop trigger if exists sessions_protect on public.sessions;
create trigger sessions_protect before insert or update on public.sessions
  for each row execute function public.protect_coach_fields();

-- 4) Un cliente solo puede apuntar series en SUS entrenos
create or replace function public.guard_set_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_coach() then return new; end if;
  if not exists (select 1 from public.sessions s where s.id = new.session_id and s.client_id = new.client_id) then
    raise exception 'Entreno no válido';
  end if;
  return new;
end $$;
drop trigger if exists set_logs_guard on public.set_logs;
create trigger set_logs_guard before insert or update on public.set_logs
  for each row execute function public.guard_set_log();

-- Las funciones de trigger no se llaman directamente
revoke all on function public.protect_profile(), public.protect_coach_fields(), public.guard_set_log() from public, anon, authenticated;
