-- 042: (1) sensaciones y motivación de cada entreno (1-10)
--      (2) pasos automáticos desde Salud (iPhone: app Atajos; Android: app de automatización):
--          el móvil llama a /rest/v1/rpc/health_steps con la clave personal del cliente y se guardan sus pasos del día.
alter table public.sessions add column if not exists feel int check (feel is null or feel between 1 and 10);
alter table public.sessions add column if not exists motivation int check (motivation is null or motivation between 1 and 10);

create extension if not exists pgcrypto with schema extensions;
create table if not exists public.health_tokens (
  client_id   uuid primary key references public.clients(id) on delete cascade,
  token_hash  text not null unique,
  created_at  timestamptz not null default now(),
  last_used   timestamptz,
  last_steps  int
);
alter table public.health_tokens enable row level security;
revoke all on public.health_tokens from anon, authenticated;

-- Crea (o cambia) la clave personal del cliente que ha iniciado sesión. Solo se guarda la huella.
create or replace function public.health_token() returns text
language plpgsql volatile security definer set search_path = public, extensions as $$
declare cid uuid := public.my_client_id(); tok text;
begin
  if cid is null then raise exception 'Solo para clientes'; end if;
  tok := 'jm_' || encode(extensions.gen_random_bytes(18), 'hex');
  insert into public.health_tokens(client_id, token_hash) values (cid, encode(extensions.digest(tok, 'sha256'), 'hex'))
    on conflict (client_id) do update set token_hash = excluded.token_hash, created_at = now(), last_used = null, last_steps = null;
  return tok;
end $$;
-- Estado (para enseñarlo en Perfil)
create or replace function public.health_status() returns table (active boolean, last_used timestamptz, last_steps int)
language sql stable security definer set search_path = public as $$
  select true, t.last_used, t.last_steps from public.health_tokens t where t.client_id = public.my_client_id();
$$;
create or replace function public.health_off() returns void
language sql volatile security definer set search_path = public as $$
  delete from public.health_tokens where client_id = public.my_client_id();
$$;

-- La llamada del móvil (sin sesión): clave personal + pasos de hoy (hora de Canarias). Se queda el mayor del día.
create or replace function public.health_steps(t text, steps int, day date default null) returns text
language plpgsql volatile security definer set search_path = public, extensions as $$
declare cid uuid; d date := coalesce(day, (now() at time zone 'Atlantic/Canary')::date);
begin
  if t is null or length(t) > 100 then raise exception 'clave no válida'; end if;
  select client_id into cid from public.health_tokens where token_hash = encode(extensions.digest(t, 'sha256'), 'hex');
  if cid is null then raise exception 'clave no válida'; end if;
  if steps is null or steps < 0 or steps > 150000 then raise exception 'pasos fuera de rango'; end if;
  if d > (now() at time zone 'Atlantic/Canary')::date or d < (now() at time zone 'Atlantic/Canary')::date - 3 then raise exception 'fecha fuera de rango'; end if;
  insert into public.daily_metrics(client_id, date, steps) values (cid, d, steps)
    on conflict (client_id, date) do update set steps = greatest(coalesce(public.daily_metrics.steps, 0), excluded.steps);
  update public.health_tokens set last_used = now(), last_steps = steps where client_id = cid;
  return 'ok: ' || steps || ' pasos el ' || to_char(d, 'DD/MM');
end $$;

revoke all on function public.health_token(), public.health_status(), public.health_off(), public.health_steps(text, int, date) from public;
grant execute on function public.health_token(), public.health_status(), public.health_off() to authenticated;
grant execute on function public.health_steps(text, int, date) to anon, authenticated;
