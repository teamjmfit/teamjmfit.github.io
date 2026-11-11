-- =====================================================================
--  TEAM JMFIT · Migración 003 · Repetición automática de semanas
--  Requiere 002. Aditiva: no borra nada.
--  Cuando la última semana publicada de un programa termina y no hay otra
--  preparada, se crea y publica sola la semana siguiente (modo 'repeat'):
--  mismas rutinas y las cargas que el cliente hizo (o la progresión si se cumplió).
-- =====================================================================

alter table public.programs add column if not exists auto_repeat boolean not null default true;

-- Motor interno de clonado (sin comprobación de rol; solo lo llaman las funciones públicas)
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
  rule text; inc numeric; progressed boolean;
begin
  if p_mode not in ('copy', 'progress', 'deload', 'repeat') then raise exception 'Modo no válido: %', p_mode; end if;

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
      if p_mode in ('progress', 'repeat') and rule <> 'none' and it.reps_max is not null and perf.n_sets >= it.sets then
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
        if not progressed then
          v_load := case when p_mode = 'repeat' then coalesce(nullif(perf.top_weight, 0), it.load_kg) else coalesce(it.load_kg, perf.top_weight) end;
        end if;
      elsif p_mode = 'repeat' and perf.n_sets > 0 and coalesce(perf.top_weight, 0) > 0 then
        -- Repetición automática: la semana nueva parte de los pesos que el cliente hizo
        v_load := perf.top_weight;
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

revoke all on function public._clone_week(uuid, text, numeric) from public, anon, authenticated;

-- Versión pública para el entrenador (igual que en 002 + modo 'repeat')
create or replace function public.clone_program_week(
  p_week_id uuid, p_mode text default 'progress', p_deload_volume numeric default 0.6
) returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.is_coach() then raise exception 'Solo el entrenador puede crear semanas'; end if;
  return public._clone_week(p_week_id, p_mode, p_deload_volume);
end $$;

-- ---------------------------------------------------------------------
-- roll_program_weeks: crea y publica las semanas que falten hasta hoy.
-- La puede llamar el entrenador o el propio cliente (solo para su programa).
-- Devuelve cuántas semanas ha creado.
-- ---------------------------------------------------------------------
create or replace function public.roll_program_weeks(p_program uuid) returns int
language plpgsql security definer set search_path = public as $$
declare prog public.programs; lw public.program_weeks; nw uuid; n int := 0;
begin
  select * into prog from public.programs where id = p_program;
  if not found then return 0; end if;
  if not (public.is_coach() or prog.client_id is not distinct from public.my_client_id() and public.my_client_id() is not null) then raise exception 'Sin permiso'; end if;
  if not prog.auto_repeat or prog.status <> 'active' then return 0; end if;
  perform pg_advisory_xact_lock(hashtext(p_program::text));   -- evita duplicados si dos dispositivos abren a la vez
  loop
    select * into lw from public.program_weeks where program_id = p_program order by week_no desc limit 1;
    exit when not found or not lw.published or lw.start_date + 7 > current_date or n >= 12;
    nw := public._clone_week(lw.id, 'repeat', 0.6);
    update public.program_weeks set published = true, notes = coalesce(notes, 'Repetida automáticamente') where id = nw;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function public.roll_program_weeks(uuid) from anon;
grant execute on function public.roll_program_weeks(uuid) to authenticated;
grant execute on function public.clone_program_week(uuid, text, numeric) to authenticated;
