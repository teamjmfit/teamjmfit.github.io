-- 043: Salud también manda el sueño (y el peso de una báscula conectada, si lo hay), y el entrenador ve
--      qué clientes tienen el móvil conectado y lo último que llegó.
alter table public.health_tokens add column if not exists last_sleep numeric;
alter table public.health_tokens add column if not exists last_weight numeric;

drop function if exists public.health_steps(text, int, date);
create or replace function public.health_steps(t text, steps int default null, day date default null, sleep_h numeric default null, weight numeric default null) returns text
language plpgsql volatile security definer set search_path = public, extensions as $$
declare cid uuid; d date := coalesce(day, (now() at time zone 'Atlantic/Canary')::date); sl numeric; wt numeric;
begin
  if t is null or length(t) > 100 then raise exception 'clave no válida'; end if;
  select client_id into cid from public.health_tokens where token_hash = encode(extensions.digest(t, 'sha256'), 'hex');
  if cid is null then raise exception 'clave no válida'; end if;
  if steps is not null and (steps < 0 or steps > 150000) then raise exception 'pasos fuera de rango'; end if;
  if d > (now() at time zone 'Atlantic/Canary')::date or d < (now() at time zone 'Atlantic/Canary')::date - 3 then raise exception 'fecha fuera de rango'; end if;
  -- el sueño puede llegar en horas o en segundos/minutos según cómo se haga el atajo
  sl := case when sleep_h is null or sleep_h <= 0 then null when sleep_h > 1440 then sleep_h / 3600 when sleep_h > 24 then sleep_h / 60 else sleep_h end;
  if sl is not null and sl > 16 then sl := null; end if;
  wt := case when weight between 25 and 350 then weight else null end;
  if steps is null and sl is null and wt is null then raise exception 'sin datos'; end if;
  insert into public.daily_metrics(client_id, date, steps, sleep_h, weight) values (cid, d, steps, round(sl, 1), wt)
    on conflict (client_id, date) do update set
      steps   = case when excluded.steps is null then public.daily_metrics.steps else greatest(coalesce(public.daily_metrics.steps, 0), excluded.steps) end,
      sleep_h = coalesce(excluded.sleep_h, public.daily_metrics.sleep_h),
      weight  = coalesce(public.daily_metrics.weight, excluded.weight);      -- el peso apuntado a mano (en ayunas) manda
  update public.health_tokens set last_used = now(), last_steps = coalesce(steps, last_steps), last_sleep = coalesce(round(sl, 1), last_sleep), last_weight = coalesce(wt, last_weight)
    where client_id = cid;
  return 'ok';
end $$;
revoke all on function public.health_steps(text, int, date, numeric, numeric) from public;
grant execute on function public.health_steps(text, int, date, numeric, numeric) to anon, authenticated;

drop function if exists public.health_status();
create or replace function public.health_status() returns table (active boolean, last_used timestamptz, last_steps int, last_sleep numeric, last_weight numeric)
language sql stable security definer set search_path = public as $$
  select true, t.last_used, t.last_steps, t.last_sleep, t.last_weight from public.health_tokens t where t.client_id = public.my_client_id();
$$;
-- Para el entrenador: todos los clientes conectados
create or replace function public.health_status_coach() returns table (client_id uuid, last_used timestamptz, last_steps int, last_sleep numeric, last_weight numeric)
language sql stable security definer set search_path = public as $$
  select t.client_id, t.last_used, t.last_steps, t.last_sleep, t.last_weight from public.health_tokens t where public.is_coach();
$$;
revoke all on function public.health_status(), public.health_status_coach() from public;
grant execute on function public.health_status(), public.health_status_coach() to authenticated;
