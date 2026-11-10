-- =====================================================================
--  TEAM JMFIT · Migración 002 · Progresión semanal de programas
--  Requiere 001. Todo ocurre en el servidor y en una sola transacción:
--  si algo falla, no se crea media semana.
-- =====================================================================

-- Redondeo de cargas al incremento de disco más cercano (por defecto 0,25 kg)
create or replace function public.round_load(x numeric, step numeric default 0.25) returns numeric
language sql immutable as $$ select case when x is null then null else round(x / step) * step end $$;

-- ---------------------------------------------------------------------
-- clone_program_week
--   p_mode = 'copy'     → copia exacta (misma carga/series/reps)
--          = 'progress' → aplica la regla de progresión de cada ejercicio
--                         según lo que el cliente registró en la semana origen
--          = 'deload'   → menos volumen, misma carga, RIR +2
--   Devuelve el id de la nueva semana (sin publicar).
-- ---------------------------------------------------------------------
create or replace function public.clone_program_week(
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
  rule text; inc numeric; progressed boolean;
begin
  if not public.is_coach() then raise exception 'Solo el entrenador puede crear semanas'; end if;
  if p_mode not in ('copy', 'progress', 'deload') then raise exception 'Modo no válido: %', p_mode; end if;

  select * into src from public.program_weeks where id = p_week_id for update;
  if not found then raise exception 'Semana no encontrada'; end if;

  -- Tras una descarga, la progresión continúa desde la última semana normal (no desde las cargas de descarga)
  base := src;
  if src.kind = 'deload' and p_mode <> 'deload' then
    select * into base from public.program_weeks
     where program_id = src.program_id and week_no < src.week_no and kind = 'normal'
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
      v_sets := it.sets; v_load := it.load_kg; v_rmin := it.reps_min; v_rmax := it.reps_max;
      v_rir := it.target_rir; v_reps := it.reps; progressed := false;
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
      if p_mode = 'progress' and rule <> 'none' and it.reps_max is not null and perf.n_sets >= it.sets then
        -- Criterio: todas las series hechas, reps en el tope del rango y RIR igual o mayor que el objetivo
        if perf.min_reps >= it.reps_max
           and (it.target_rir is null or perf.min_rir is null or perf.min_rir >= it.target_rir) then
          if rule in ('load', 'double') then
            v_load := public.round_load(coalesce(it.load_kg, perf.top_weight) + inc);
            progressed := true;
          elsif rule = 'reps' and it.reps_max is not null then
            v_rmin := it.reps_min + inc::int; v_rmax := it.reps_max + inc::int;
            v_reps := case when v_rmin = v_rmax then v_rmin::text else v_rmin || '-' || v_rmax end;
            progressed := true;
          end if;
        end if;
        -- Si no se cumplió, se mantiene la carga de la semana origen (o la que realmente usó)
        if not progressed then v_load := coalesce(it.load_kg, perf.top_weight); end if;
      end if;

      if p_mode = 'deload' then
        v_sets := greatest(1, round(it.sets * p_deload_volume)::int);
        v_rir  := least(coalesce(it.target_rir, 2) + 2, 5);
      end if;

      insert into public.routine_items (routine_id, client_id, exercise_id, exercise_name, media_url, position,
             sets, reps, reps_min, reps_max, load, load_kg, rest_sec, notes,
             lineage_id, target_rir, target_rpe, tempo, superset, progression)
      values (new_routine, it.client_id, it.exercise_id, it.exercise_name, it.media_url, it.position,
             v_sets, v_reps, v_rmin, v_rmax, it.load, v_load, it.rest_sec, it.notes,
             it.lineage_id, v_rir, it.target_rpe, it.tempo, it.superset, it.progression);
    end loop;
  end loop;

  return new_week;
end $$;

-- ---------------------------------------------------------------------
-- Editar un ejercicio y arrastrar el cambio a las semanas siguientes
-- que aún no están publicadas (las pasadas quedan intactas = historial)
-- ---------------------------------------------------------------------
create or replace function public.propagate_item_change(p_item_id uuid, p_changes jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare it public.routine_items; wk public.program_weeks; n int;
begin
  if not public.is_coach() then raise exception 'Solo el entrenador'; end if;
  select * into it from public.routine_items where id = p_item_id;
  select w.* into wk from public.program_weeks w join public.routines r on r.program_week_id = w.id where r.id = it.routine_id;
  update public.routine_items ri set
    sets       = coalesce((p_changes->>'sets')::int, ri.sets),
    reps       = coalesce(p_changes->>'reps', ri.reps),
    reps_min   = coalesce((p_changes->>'reps_min')::int, ri.reps_min),
    reps_max   = coalesce((p_changes->>'reps_max')::int, ri.reps_max),
    rest_sec   = coalesce((p_changes->>'rest_sec')::int, ri.rest_sec),
    tempo      = coalesce(p_changes->>'tempo', ri.tempo),
    target_rir = coalesce((p_changes->>'target_rir')::numeric, ri.target_rir),
    notes      = coalesce(p_changes->>'notes', ri.notes),
    media_url  = coalesce(p_changes->>'media_url', ri.media_url),
    progression= coalesce(p_changes->'progression', ri.progression)
  from public.routines r join public.program_weeks w on w.id = r.program_week_id
  where ri.routine_id = r.id and ri.lineage_id = it.lineage_id
    and w.program_id = wk.program_id and w.week_no > wk.week_no and not w.published;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Pasar las rutinas "fijas" actuales de un cliente a la semana 1 de un programa
-- (se copian; las fijas siguen existiendo hasta que decidas borrarlas)
-- ---------------------------------------------------------------------
create or replace function public.create_program_from_routines(p_client uuid, p_name text, p_start date)
returns uuid language plpgsql security definer set search_path = public as $$
declare prog uuid; w1 uuid; r record; nr uuid;
begin
  if not public.is_coach() then raise exception 'Solo el entrenador'; end if;
  insert into public.programs (client_id, name, start_date) values (p_client, p_name, date_trunc('week', p_start)::date) returning id into prog;
  insert into public.program_weeks (program_id, client_id, week_no, start_date, published)
  values (prog, p_client, 1, date_trunc('week', p_start)::date, false) returning id into w1;
  for r in select * from public.routines where client_id = p_client and program_week_id is null order by position loop
    insert into public.routines (client_id, name, day, position, notes, program_week_id)
    values (r.client_id, r.name, r.day, r.position, r.notes, w1) returning id into nr;
    insert into public.routine_items (routine_id, client_id, exercise_id, exercise_name, media_url, position, sets, reps,
           reps_min, reps_max, load, load_kg, rest_sec, notes, lineage_id, target_rir, target_rpe, tempo, superset, progression)
    select nr, client_id, exercise_id, exercise_name, media_url, position, sets, reps,
           reps_min, reps_max, load, load_kg, rest_sec, notes, lineage_id, target_rir, target_rpe, tempo, superset, progression
      from public.routine_items where routine_id = r.id;
  end loop;
  return prog;
end $$;

revoke execute on function public.clone_program_week(uuid, text, numeric), public.propagate_item_change(uuid, jsonb),
                           public.create_program_from_routines(uuid, text, date) from anon;
grant execute on function public.clone_program_week(uuid, text, numeric), public.propagate_item_change(uuid, jsonb),
                          public.create_program_from_routines(uuid, text, date) to authenticated;
