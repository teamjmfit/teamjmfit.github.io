-- TEAM JMFIT · 012 · Mesociclos cerrados de 4 o 6 semanas
--   Semanas 1…N-1: acumulación con la sobrecarga progresiva proyectada (kg, reps o series; RIR que baja).
--   Semana N: descarga automática (menos volumen y carga, RIR +2) que guarda lo fijo en «base».
--   Misma lógica que meso.js (vista previa y modo demo). Aditiva.
begin;

alter table public.programs add column if not exists meso_weeks int check (meso_weeks in (4, 6));
alter table public.programs add column if not exists meso_opts jsonb;

create or replace function public._meso_value(it public.routine_items, k int, n int, o jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  b jsonb := coalesce(it.base, '{}'::jsonb);
  s_sets int := coalesce(case when b ? 'sets' then (b->>'sets')::int end, it.sets, 3);
  s_rir numeric := case when b ? 'target_rir' then (b->>'target_rir')::numeric else it.target_rir end;
  s_load numeric := case when b ? 'load_kg' then (b->>'load_kg')::numeric else it.load_kg end;
  a int := n - 1; kk int; ks int; off int := greatest(0, least(coalesce((o->>'offset')::int, 0), 6)); t text; kg numeric; rr int; pt text := coalesce(it.progression->>'type', 'none');
  v_sets int; v_rir numeric; v_load numeric; v_min int; v_max int; v_reps text; fl numeric;
  vol numeric := coalesce((o->>'deload_vol')::numeric, 0.4); inten numeric := coalesce((o->>'deload_int')::numeric, 0.1);
begin
  kg := coalesce((o->>'inc_kg')::numeric, 2.5); rr := coalesce((o->>'inc_reps')::int, 1);
  -- regla: la del ejercicio si la tiene; si no, la del bloque
  if pt in ('load', 'double') then
    t := case when s_load is not null then 'load' else 'reps' end; kg := coalesce((it.progression->>'inc_kg')::numeric, kg);
  elsif pt = 'reps' then
    t := 'reps'; rr := coalesce((it.progression->>'inc')::int, rr);
  else
    t := coalesce(o->>'prog', 'auto');
    if t = 'auto' then t := case when s_load is not null then 'load' when it.reps_min is not null then 'reps' else 'sets' end; end if;
    if t = 'load' and s_load is null then t := case when it.reps_min is not null then 'reps' else 'none' end; end if;
    if t = 'reps' and it.reps_min is null then t := 'none'; end if;
  end if;
  kk := least(k, a - 1); ks := kk + off;   -- off: pasos por encima del bloque anterior (no toca el RIR)
  v_sets := s_sets; v_rir := s_rir; v_load := s_load; v_min := it.reps_min; v_max := it.reps_max; v_reps := it.reps;
  if t = 'load' then v_load := public.round_load(s_load + ks * kg);
  elsif t = 'reps' then
    v_min := it.reps_min + ks * rr; v_max := coalesce(it.reps_max, it.reps_min) + ks * rr;
    v_reps := case when v_min = v_max then v_min::text else v_min || '-' || v_max end;
  elsif t = 'sets' then v_sets := s_sets + least(2, ks / 2);
  end if;
  if coalesce((o->>'rir_ramp')::boolean, true) and s_rir is not null and a > 1 then
    fl := case when s_rir >= 1 then 1 else 0 end;
    v_rir := greatest(fl, s_rir - round(kk * (s_rir - fl) / (a - 1)));
  end if;
  if k < a then
    return jsonb_build_object('kind', 'normal', 'sets', v_sets, 'target_rir', v_rir, 'load_kg', v_load, 'reps', v_reps, 'base', null);
  end if;
  return jsonb_build_object('kind', 'deload',
    'sets', greatest(1, round(v_sets * (1 - vol))::int),
    'load_kg', case when v_load is null then null else public.round_load(v_load * (1 - inten)) end,
    'target_rir', least(coalesce(v_rir, 2) + 2, 5), 'reps', v_reps,
    'base', jsonb_build_object('sets', v_sets, 'target_rir', v_rir, 'load_kg', v_load));
end $$;
revoke all on function public._meso_value(public.routine_items, int, int, jsonb) from public, anon, authenticated;

-- p_from_week null → parte de las rutinas fijas del cliente; si no, de las rutinas de esa semana
create or replace function public.create_mesocycle(p_client uuid, p_name text, p_start date, p_weeks int,
                                                   p_opts jsonb default '{}'::jsonb, p_from_week uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare prog uuid; wk uuid; st date := date_trunc('week', p_start)::date; k int; r record; it public.routine_items; nr uuid; v jsonb;
        o jsonb := coalesce(p_opts, '{}'::jsonb); pub boolean := coalesce((p_opts->>'publish')::boolean, true); n_src int;
begin
  if not public.is_coach() then raise exception 'Solo el entrenador'; end if;
  if p_weeks not in (4, 6) then raise exception 'El mesociclo es de 4 o 6 semanas'; end if;
  if p_from_week is not null and not exists (select 1 from public.program_weeks where id = p_from_week and client_id = p_client) then
    raise exception 'Semana de origen no válida';
  end if;
  select count(*) into n_src from public.routines
   where client_id = p_client and (case when p_from_week is null then program_week_id is null else program_week_id = p_from_week end);
  if n_src = 0 then raise exception 'No hay rutinas de partida'; end if;

  -- Los programas anteriores dejan de repetirse y se quitan sus semanas futuras sin entrenar
  update public.programs set auto_repeat = false where client_id = p_client and status = 'active';
  delete from public.program_weeks w
   where w.client_id = p_client and w.start_date >= st
     and not exists (select 1 from public.sessions s join public.routines rr on rr.id = s.routine_id where rr.program_week_id = w.id);

  insert into public.programs (client_id, name, start_date, auto_repeat, deload_every, meso_weeks, meso_opts)
  values (p_client, coalesce(nullif(trim(p_name), ''), 'Mesociclo'), st, false, p_weeks, p_weeks, o) returning id into prog;

  for k in 0 .. p_weeks - 1 loop
    insert into public.program_weeks (program_id, client_id, week_no, start_date, kind, published, notes)
    values (prog, p_client, k + 1, st + 7 * k, case when k = p_weeks - 1 then 'deload' else 'normal' end, pub,
            case when k = p_weeks - 1 then 'Descarga del mesociclo' else 'Acumulación ' || (k + 1) || '/' || (p_weeks - 1) end)
    returning id into wk;
    for r in select * from public.routines
              where client_id = p_client and (case when p_from_week is null then program_week_id is null else program_week_id = p_from_week end)
              order by position, day loop
      insert into public.routines (client_id, name, day, position, notes, program_week_id)
      values (r.client_id, r.name, r.day, r.position, r.notes, wk) returning id into nr;
      for it in select * from public.routine_items where routine_id = r.id order by position loop
        v := public._meso_value(it, k, p_weeks, o);
        insert into public.routine_items (routine_id, client_id, exercise_id, exercise_name, media_url, position,
               sets, reps, load, load_kg, rest_sec, notes, lineage_id, target_rir, target_rpe, tempo, superset, progression, base)
        values (nr, it.client_id, it.exercise_id, it.exercise_name, it.media_url, it.position,
               (v->>'sets')::int, v->>'reps', it.load, (v->>'load_kg')::numeric, it.rest_sec, it.notes, it.lineage_id,
               (v->>'target_rir')::numeric, it.target_rpe, it.tempo, it.superset, it.progression,
               case when jsonb_typeof(v->'base') = 'object' then v->'base' end);
      end loop;
    end loop;
  end loop;
  return prog;
end $$;
revoke all on function public.create_mesocycle(uuid, text, date, int, jsonb, uuid) from public, anon;
grant execute on function public.create_mesocycle(uuid, text, date, int, jsonb, uuid) to authenticated;

commit;
