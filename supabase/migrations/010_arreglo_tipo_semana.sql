-- TEAM JMFIT · 010 · Tipo de semana: arreglo de series y RIR que se acumulaban
--
-- Error: al crear una semana en modo «Descarga» (o copiar desde una de descarga/intensidad) se guardaban
-- las series y el RIR ya ajustados como si fueran los fijos. Al pasar después a normal/mantenimiento no
-- se podía volver a lo fijo y, al poner otra vez descarga, se recortaba sobre lo ya recortado (RIR 4-5…).
--
-- 1) _clone_week parte siempre de lo fijo (columna base) y la descarga guarda lo fijo en base.
-- 2) Reparación de las semanas actuales y futuras ya afectadas:
--    a) semanas de descarga/intensidad sin base → base = lo fijo de la semana normal anterior del mismo ejercicio;
--    b) semanas normales/mantenimiento con «restos» de descarga (menos series Y más RIR que la semana normal
--       anterior del mismo ejercicio) → vuelven a las series y RIR de esa semana (la carga no se toca);
--    c) se vuelve a aplicar el tipo de cada semana reparada.
--    Solo semanas que empiezan desde el lunes de esta semana en adelante; no se tocan rutinas ya entrenadas.

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
        v_rir  := least(coalesce(b_rir, 2) + 2, 5);
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

do $$
declare w record; it record; pv record; mon date := date_trunc('week', current_date)::date; n_a int := 0; n_b int := 0;
begin
  for w in
    select pw.* from public.program_weeks pw where pw.start_date >= mon order by pw.program_id, pw.week_no
  loop
    for it in
      select ri.* from public.routine_items ri join public.routines r on r.id = ri.routine_id
       where r.program_week_id = w.id and ri.lineage_id is not null
         and not exists (select 1 from public.sessions s where s.routine_id = r.id and s.finished_at is not null)
    loop
      -- mismo ejercicio en la semana normal/mantenimiento más reciente anterior
      select coalesce((pi.base->>'sets')::int, pi.sets) as sets,
             case when pi.base ? 'target_rir' then (pi.base->>'target_rir')::numeric else pi.target_rir end as rir,
             case when pi.base ? 'load_kg' then (pi.base->>'load_kg')::numeric else pi.load_kg end as load
        into pv
        from public.routine_items pi join public.routines pr on pr.id = pi.routine_id
        join public.program_weeks ppw on ppw.id = pr.program_week_id
       where ppw.program_id = w.program_id and ppw.week_no < w.week_no and ppw.kind in ('normal', 'maintenance')
         and pi.lineage_id = it.lineage_id
       order by ppw.week_no desc limit 1;
      if not found then continue; end if;
      if w.kind in ('deload', 'intensity') and it.base is null then
        update public.routine_items set base = jsonb_build_object('sets', pv.sets, 'target_rir', pv.rir, 'load_kg', coalesce(it.load_kg, pv.load))
         where id = it.id;
        n_a := n_a + 1;
      elsif w.kind in ('normal', 'maintenance') and it.base is null
            and it.sets < pv.sets and coalesce(it.target_rir, 0) > coalesce(pv.rir, 0) then
        update public.routine_items set sets = pv.sets, target_rir = pv.rir where id = it.id;
        n_b := n_b + 1;
      end if;
    end loop;
    if w.kind in ('deload', 'intensity') then
      perform public._apply_kind_routine(r.id, w.kind,
        (select id from public.program_weeks where program_id = w.program_id and week_no < w.week_no order by week_no desc limit 1))
        from public.routines r
       where r.program_week_id = w.id
         and not exists (select 1 from public.sessions s where s.routine_id = r.id and s.finished_at is not null);
    end if;
  end loop;
  raise notice 'Reparados: % ejercicios de descarga/intensidad sin fijo, % ejercicios de semanas normales con restos de descarga', n_a, n_b;
end $$;
