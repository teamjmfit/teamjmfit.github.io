-- TEAM JMFIT · 016 · Descarga con RIR 2 (no «+2») y premio en los objetivos
--   Semana de descarga: RIR 2 (si lo pautado ya era más alto, se mantiene), en vez de sumar 2 puntos
--   (que dejaba series a RIR 4). Afecta a set_week_kind, a la copia de semanas y a los mesociclos.
--   Además: premio opcional al conseguir un objetivo (goals.reward).
begin;

create or replace function public._apply_kind_routine(p_routine uuid, p_kind text, p_prev_week uuid)
returns void language plpgsql security definer set search_path = public as $$
declare it public.routine_items; b jsonb; perf record; inc numeric;
begin
  for it in select * from public.routine_items where routine_id = p_routine loop
    b := coalesce(it.base, jsonb_build_object('sets', it.sets, 'target_rir', it.target_rir, 'load_kg', it.load_kg));
    if p_kind in ('normal', 'maintenance', 'test') then
      update public.routine_items set sets = (b->>'sets')::int, target_rir = (b->>'target_rir')::numeric,
             load_kg = (b->>'load_kg')::numeric, base = null where id = it.id;
    elsif p_kind = 'deload' then
      update public.routine_items set sets = greatest(1, round((b->>'sets')::int * 0.6)::int),
             target_rir = greatest(coalesce((b->>'target_rir')::numeric, 2), 2),
             load_kg = (b->>'load_kg')::numeric, base = b where id = it.id;
    elsif p_kind = 'intensity' then
      inc := coalesce((it.progression->>'inc_kg')::numeric, 2.5);
      select count(*) as n, min(sl.reps) as min_reps, min(sl.rir) as min_rir, max(sl.weight) as top
        into perf
        from public.set_logs sl join public.sessions s on s.id = sl.session_id
        join public.routines rr on rr.id = s.routine_id
       where sl.lineage_id = it.lineage_id and rr.program_week_id = p_prev_week and s.finished_at is not null;
      update public.routine_items set sets = (b->>'sets')::int,
             target_rir = greatest(coalesce((b->>'target_rir')::numeric, 2) - 1, 0),
             load_kg = case when p_prev_week is not null and perf.n >= (b->>'sets')::int and it.reps_max is not null
                              and perf.min_reps >= it.reps_max
                              and ((b->>'target_rir') is null or perf.min_rir is null or perf.min_rir >= (b->>'target_rir')::numeric)
                            then public.round_load(coalesce((b->>'load_kg')::numeric, perf.top) + inc)
                            else (b->>'load_kg')::numeric end,
             base = b where id = it.id;
    end if;
  end loop;
end $$;
revoke all on function public._apply_kind_routine(uuid, text, uuid) from public, anon, authenticated;

create or replace function public._clone_week(
  p_week_id uuid,
  p_mode text default 'progress',
  p_deload_volume numeric default 0.6       -- 60 % de las series en la semana de descarga
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  src public.program_weeks;
  base public.program_weeks;                -- semana de la que se toman las cargas
  new_week uuid;
  r record; it record; perf record;
  new_routine uuid;
  v_sets int; v_load numeric; v_rmin int; v_rmax int; v_rir numeric; v_reps text;
  rule text; inc numeric; progressed boolean; bs jsonb; b_sets int; b_rir numeric; b_load numeric;
begin
  if p_mode not in ('copy', 'progress', 'deload', 'repeat') then raise exception 'Modo no válido: %', p_mode; end if;

  select * into src from public.program_weeks where id = p_week_id for update;
  if not found then raise exception 'Semana no encontrada'; end if;

  -- Tras una descarga, la progresión continúa desde la última semana normal (no desde las cargas de descarga)
  base := src;
  if src.kind in ('deload', 'intensity') and p_mode <> 'deload' then
    select * into base from public.program_weeks
     where program_id = src.program_id and week_no < src.week_no and kind in ('normal', 'maintenance')
     order by week_no desc limit 1;
    if not found then base := src; end if;
  end if;

  insert into public.program_weeks (program_id, client_id, week_no, start_date, kind, source_week_id, published)
  select src.program_id, src.client_id, max(w.week_no) + 1, max(w.start_date) + 7,
         case when p_mode = 'deload' then 'deload' else 'normal' end, src.id, false
    from public.program_weeks w where w.program_id = src.program_id
  returning id into new_week;

  for r in select * from public.routines where program_week_id = base.id order by position, day loop
    insert into public.routines (client_id, name, day, position, notes, program_week_id)
    values (r.client_id, r.name, r.day, r.position, r.notes, new_week)
    returning id into new_routine;

    for it in select * from public.routine_items where routine_id = r.id order by position loop
      -- Se parte siempre de lo FIJO del ejercicio (sin el ajuste de descarga / intensidad de la semana origen)
      bs := coalesce(it.base, jsonb_build_object('sets', it.sets, 'target_rir', it.target_rir, 'load_kg', it.load_kg));
      b_sets := coalesce((bs->>'sets')::int, it.sets); b_rir := (bs->>'target_rir')::numeric; b_load := (bs->>'load_kg')::numeric;
      v_sets := b_sets; v_load := b_load; v_rmin := it.reps_min; v_rmax := it.reps_max;
      v_rir := b_rir; v_reps := it.reps; progressed := false;
      rule := coalesce(it.progression->>'type', 'none');
      inc  := coalesce((it.progression->>'inc_kg')::numeric, (it.progression->>'inc')::numeric, 0);

      -- Rendimiento registrado en la semana origen para ESTE ejercicio (por linaje)
      select count(*)                                   as n_sets,
             min(sl.reps)                               as min_reps,
             max(sl.weight)                             as top_weight,
             min(sl.rir)                                as min_rir
        into perf
        from public.set_logs sl
        join public.sessions s on s.id = sl.session_id
        join public.routines rr on rr.id = s.routine_id
       where sl.lineage_id = it.lineage_id
         and rr.program_week_id = src.id
         and s.finished_at is not null;

      -- Sin rango numérico (p. ej. "40 s", "al fallo") no hay criterio objetivo: se copia tal cual
      if p_mode in ('progress', 'repeat') and rule <> 'none' and it.reps_max is not null and perf.n_sets >= b_sets then
        -- Criterio: todas las series hechas, reps en el tope del rango y RIR igual o mayor que el objetivo
        if perf.min_reps >= it.reps_max
           and (b_rir is null or perf.min_rir is null or perf.min_rir >= b_rir) then
          if rule in ('load', 'double') then
            v_load := public.round_load(coalesce(b_load, perf.top_weight) + inc);
            progressed := true;
          elsif rule = 'reps' and it.reps_max is not null then
            v_rmin := it.reps_min + inc::int; v_rmax := it.reps_max + inc::int;
            v_reps := case when v_rmin = v_rmax then v_rmin::text else v_rmin || '-' || v_rmax end;
            progressed := true;
          end if;
        end if;
        -- Si no se cumplió, se mantiene la carga de la semana origen (o la que realmente usó)
        if not progressed then
          v_load := case when p_mode = 'repeat' then coalesce(nullif(perf.top_weight, 0), b_load) else coalesce(b_load, perf.top_weight) end;
        end if;
      elsif p_mode = 'repeat' and perf.n_sets > 0 and coalesce(perf.top_weight, 0) > 0 then
        -- Repetición automática: la semana nueva parte de los pesos que el cliente hizo
        v_load := perf.top_weight;
      end if;

      if p_mode = 'deload' then
        v_sets := greatest(1, round(b_sets * p_deload_volume)::int);
        v_rir  := greatest(coalesce(b_rir, 2), 2);
      end if;

      insert into public.routine_items (routine_id, client_id, exercise_id, exercise_name, media_url, position,
             sets, reps, reps_min, reps_max, load, load_kg, rest_sec, notes,
             lineage_id, target_rir, target_rpe, tempo, superset, progression, base)
      values (new_routine, it.client_id, it.exercise_id, it.exercise_name, it.media_url, it.position,
             v_sets, v_reps, v_rmin, v_rmax, it.load, v_load, it.rest_sec, it.notes,
             it.lineage_id, v_rir, it.target_rpe, it.tempo, it.superset, it.progression,
             -- la descarga guarda lo fijo para poder volver a normal / mantenimiento
             case when p_mode = 'deload' then jsonb_build_object('sets', b_sets, 'target_rir', b_rir, 'load_kg', b_load) end);
    end loop;
  end loop;

  return new_week;
end $$;
revoke all on function public._clone_week(uuid, text, numeric) from public, anon, authenticated;

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
  ov jsonb := coalesce(o->'weeks'->k, '{}'::jsonb); ov_rir numeric; ov_sets int; d_sets int; d_rir numeric;
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
  -- ajuste manual de la semana: RIR fijo y/o series de más o de menos
  ov_rir := case when jsonb_typeof(ov->'rir') = 'number' then least(10, greatest(0, (ov->>'rir')::numeric)) end;
  ov_sets := case when jsonb_typeof(ov->'sets') = 'number' then round((ov->>'sets')::numeric)::int else 0 end;
  if k < a then
    return jsonb_build_object('kind', 'normal', 'sets', greatest(1, v_sets + ov_sets), 'target_rir', coalesce(ov_rir, v_rir), 'load_kg', v_load, 'reps', v_reps, 'base', null);
  end if;
  d_sets := greatest(1, round(v_sets * (1 - vol))::int); d_rir := greatest(coalesce(v_rir, 2), 2);
  return jsonb_build_object('kind', 'deload',
    'sets', greatest(1, d_sets + ov_sets),
    'load_kg', case when v_load is null then null else public.round_load(v_load * (1 - inten)) end,
    'target_rir', coalesce(ov_rir, d_rir), 'reps', v_reps,
    'base', jsonb_build_object('sets', v_sets, 'target_rir', v_rir, 'load_kg', v_load));
end $$;
revoke all on function public._meso_value(public.routine_items, int, int, jsonb) from public, anon, authenticated;

alter table public.goals add column if not exists reward text check (length(reward) <= 200);

-- Repara las descargas de esta semana en adelante que tenían el RIR calculado con «+2»
update public.routine_items i
   set target_rir = greatest(coalesce((i.base->>'target_rir')::numeric, 2), 2)
  from public.routines r join public.program_weeks w on w.id = r.program_week_id
 where i.routine_id = r.id and w.kind = 'deload' and i.base is not null
   and w.start_date >= date_trunc('week', current_date)::date
   and i.target_rir = least(coalesce((i.base->>'target_rir')::numeric, 2) + 2, 5)
   and i.target_rir is distinct from greatest(coalesce((i.base->>'target_rir')::numeric, 2), 2);

commit;
