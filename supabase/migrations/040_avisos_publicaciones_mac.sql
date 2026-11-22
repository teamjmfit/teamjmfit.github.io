-- 040: (1) avisos al publicar píldoras/novedades y aviso al entrenador de cada revisión (cualquier día)
--      (2) «Recordar este dispositivo»: en un ordenador de confianza no se vuelve a pedir el código de verificación.

-- 1a) Publicación nueva (o borrador que pasa a publicado) → aviso a los clientes. La función «avisos» lo comprueba
--     y no lo repite (push_log). Si algo falla, la publicación se guarda igual.
create or replace function public._push_post() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.published and (tg_op = 'INSERT' or not coalesce(old.published, false)) then
    begin
      perform net.http_post(
        url := 'https://ctbliwwthavmamcoekmr.supabase.co/functions/v1/avisos',
        headers := '{"Content-Type":"application/json"}'::jsonb,
        body := jsonb_build_object('job', 'post', 'id', new.id));
    exception when others then null;
    end;
  end if;
  return new;
end $$;
drop trigger if exists t_push_post on public.posts;
create trigger t_push_post after insert or update of published on public.posts for each row execute function public._push_post();

-- 1b) Revisión enviada por un cliente → aviso al entrenador cualquier día (antes solo en fin de semana)
create or replace function public._push_checkin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform net.http_post(
      url := 'https://ctbliwwthavmamcoekmr.supabase.co/functions/v1/avisos',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := jsonb_build_object('job', 'checkin', 'id', new.id));
  exception when others then null;
  end;
  return new;
end $$;

-- 2) Dispositivos de confianza: tras meter el código con «Recordar este dispositivo», la app guarda una clave aleatoria
--    en ese ordenador y la manda en cada petición (cabecera x-jm-device). Aquí solo se guarda su huella (sha256).
create extension if not exists pgcrypto with schema extensions;
create table if not exists public.mfa_trusted (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  token_hash  text not null unique,
  label       text check (label is null or length(label) <= 100),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
alter table public.mfa_trusted enable row level security;
revoke all on public.mfa_trusted from anon, authenticated;

create or replace function public._trusted_device() returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from public.mfa_trusted t
    where t.user_id = auth.uid() and t.expires_at > now()
      and t.token_hash = encode(extensions.digest(coalesce((nullif(current_setting('request.headers', true), '')::json ->> 'x-jm-device'), ''), 'sha256'), 'hex'));
$$;

create or replace function public.is_coach() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'coach')
     and (coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
          or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
          or public._trusted_device());
$$;

-- Recordar este dispositivo (solo desde una sesión ya verificada con el código); 90 días
create or replace function public.mfa_trust_device(p_label text) returns text
language plpgsql volatile security definer set search_path = public, extensions as $$
declare tok text;
begin
  if auth.uid() is null or coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then raise exception 'Primero verifica el código'; end if;
  tok := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.mfa_trusted(user_id, token_hash, label, expires_at)
    values (auth.uid(), encode(extensions.digest(tok, 'sha256'), 'hex'), left(p_label, 100), now() + interval '90 days');
  delete from public.mfa_trusted where user_id = auth.uid() and expires_at < now();
  return tok;
end $$;
-- ¿Este dispositivo está recordado? (lo usa la app al abrir para no pedir el código)
create or replace function public.mfa_device_ok() returns boolean
language sql stable security definer set search_path = public as $$ select public._trusted_device(); $$;
-- Olvidar todos los dispositivos recordados
create or replace function public.mfa_untrust_all() returns int
language sql volatile security definer set search_path = public as $$
  with d as (delete from public.mfa_trusted where user_id = auth.uid() returning 1) select count(*)::int from d;
$$;
-- Cuántos hay (para Seguridad)
create or replace function public.mfa_trusted_count() returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.mfa_trusted where user_id = auth.uid() and expires_at > now();
$$;
revoke all on function public.mfa_trust_device(text), public.mfa_device_ok(), public.mfa_untrust_all(), public.mfa_trusted_count(), public._trusted_device() from public, anon;
grant execute on function public.mfa_trust_device(text), public.mfa_device_ok(), public.mfa_untrust_all(), public.mfa_trusted_count(), public._trusted_device() to authenticated;
