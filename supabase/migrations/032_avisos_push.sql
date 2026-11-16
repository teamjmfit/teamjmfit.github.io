-- 032: avisos en el móvil (notificaciones push).
--  · Clientes: cada mañana (08:00 hora canaria) un aviso con sus tareas del día (entreno, revisión, descanso…) y una frase de motivación.
--  · Entrenador: un aviso cada vez que un cliente envía su revisión en fin de semana.
-- Las claves de envío (VAPID) las genera la propia función «avisos» la primera vez y se guardan en push_vapid,
-- que solo puede leer el servidor (sin políticas RLS = nadie desde la app). No hay ninguna clave en el repositorio.

create table if not exists public.push_subs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null unique check (length(endpoint) <= 1000),
  p256dh      text not null check (length(p256dh) <= 200),
  auth        text not null check (length(auth) <= 100),
  created_at  timestamptz not null default now()
);
create index if not exists push_subs_user on public.push_subs(user_id);
alter table public.push_subs enable row level security;
drop policy if exists p_push_subs_self on public.push_subs;
create policy p_push_subs_self on public.push_subs for select to authenticated using (user_id = auth.uid());
grant select on public.push_subs to authenticated;

-- Alta y baja de este dispositivo (si el móvil lo usaba otra cuenta, pasa a la cuenta actual)
create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sin sesión'; end if;
  delete from public.push_subs where endpoint = p_endpoint;
  insert into public.push_subs(user_id, endpoint, p256dh, auth) values (auth.uid(), p_endpoint, p_p256dh, p_auth);
end $$;
create or replace function public.push_unsubscribe(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from public.push_subs where endpoint = p_endpoint and user_id = auth.uid();
$$;
revoke all on function public.push_subscribe(text, text, text), public.push_unsubscribe(text) from public, anon;
grant execute on function public.push_subscribe(text, text, text), public.push_unsubscribe(text) to authenticated;

-- Solo para el servidor
create table if not exists public.push_vapid (
  id int primary key default 1 check (id = 1),
  public_key text not null, private_key text not null, created_at timestamptz not null default now()
);
alter table public.push_vapid enable row level security;
revoke all on public.push_vapid from anon, authenticated;

create table if not exists public.push_log (
  key text primary key, sent_at timestamptz not null default now()
);
alter table public.push_log enable row level security;
revoke all on public.push_log from anon, authenticated;

-- Llamadas a la función desde la base de datos
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- Revisión enviada en fin de semana → aviso al entrenador (si algo falla, la revisión se guarda igual)
create or replace function public._push_checkin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if extract(isodow from (now() at time zone 'Atlantic/Canary')) in (6, 7) then
    begin
      perform net.http_post(
        url := 'https://ctbliwwthavmamcoekmr.supabase.co/functions/v1/avisos',
        headers := '{"Content-Type":"application/json"}'::jsonb,
        body := jsonb_build_object('job', 'checkin', 'id', new.id));
    exception when others then null;
    end;
  end if;
  return new;
end $$;
drop trigger if exists t_push_checkin on public.checkins;
create trigger t_push_checkin after insert on public.checkins for each row execute function public._push_checkin();

-- Cada hora (minuto 5): la función solo manda el aviso del día a partir de las 08:00 y una vez por cliente
select cron.unschedule('jmfit-avisos') where exists (select 1 from cron.job where jobname = 'jmfit-avisos');
select cron.schedule('jmfit-avisos', '5 * * * *', $$
  select net.http_post(url := 'https://ctbliwwthavmamcoekmr.supabase.co/functions/v1/avisos',
    headers := '{"Content-Type":"application/json"}'::jsonb, body := '{"job":"daily"}'::jsonb);
$$);
