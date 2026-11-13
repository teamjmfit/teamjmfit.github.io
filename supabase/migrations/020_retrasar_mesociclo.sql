-- TEAM JMFIT · 020 · Retrasar un mesociclo una semana (con descarga antes, si se quiere)
--   delay_mesocycle: mueve todas las semanas del mesociclo 7 días más tarde. Con p_deload, en la
--   semana que queda libre pone una descarga (60 % de las series, misma carga, RIR 2 o el pautado si es más alto).
--   p_source 'prev': la descarga usa las rutinas de la última semana del bloque anterior;
--            'meso': las de la primera semana del mesociclo. Si no hay bloque anterior, usa las del mesociclo.
--   Solo si el mesociclo empieza esta semana o más adelante, no tiene entrenos y no hay nada planificado después.
--   Aditiva: no cambia nada hasta que se usa.
begin;

create or replace function public.delay_mesocycle(p_program uuid, p_deload boolean default true, p_source text default 'prev')
returns uuid language plpgsql security definer set search_path = public as $$
declare prog public.programs; w1 public.program_weeks; mon date := date_trunc('week', current_date)::date;
        src uuid; nw uuid; r record; nr uuid;
begin
  if not public.is_coach() then raise exception 'Solo el entrenador'; end if;
  if coalesce(p_source, 'prev') not in ('prev', 'meso') then raise exception 'Origen no válido'; end if;
  select * into prog from public.programs where id = p_program for update;
  if not found then raise exception 'Mesociclo no encontrado'; end if;
  perform pg_advisory_xact_lock(hashtext(p_program::text));
  select * into w1 from public.program_weeks where program_id = p_program order by week_no limit 1;
  if not found then raise exception 'El mesociclo no tiene semanas'; end if;
  if w1.start_date < mon then raise exception 'El mesociclo ya ha empezado: solo se puede retrasar si empieza esta semana o más adelante'; end if;
  if exists (select 1 from public.sessions s join public.routines rr on rr.id = s.routine_id
              join public.program_weeks w on w.id = rr.program_week_id where w.program_id = p_program) then
    raise exception 'Ya hay entrenos registrados en este mesociclo';
  end if;
  if exists (select 1 from public.program_weeks w where w.client_id = prog.client_id and w.program_id <> p_program and w.start_date >= w1.start_date) then
    raise exception 'Hay otra planificación después de este mesociclo';
  end if;

  -- 1) todo una semana más tarde (renumerando sin chocar con el único (programa, semana))
  update public.program_weeks set week_no = week_no + 1000 where program_id = p_program;
  update public.program_weeks set week_no = week_no - 1000 + case when p_deload then 1 else 0 end, start_date = start_date + 7
   where program_id = p_program;
  -- meso_weeks (4 o 6) no cambia: la descarga extra es una semana más del programa
  update public.programs set start_date = start_date + 7 where id = p_program;
  if not coalesce(p_deload, false) then return null; end if;

  -- 2) rutinas de la descarga
  if coalesce(p_source, 'prev') = 'prev' then
    select w.id into src from public.program_weeks w
     where w.client_id = prog.client_id and w.program_id <> p_program and w.start_date < w1.start_date
       and exists (select 1 from public.routines x where x.program_week_id = w.id)
     order by w.start_date desc, w.week_no desc limit 1;
  end if;
  if src is null then   -- primera semana de carga del mesociclo (si ya empezaba con una descarga, la siguiente)
    select w.id into src from public.program_weeks w where w.program_id = p_program and w.kind not in ('deload') order by w.week_no limit 1;
  end if;
  src := coalesce(src, w1.id);

  insert into public.program_weeks (program_id, client_id, week_no, start_date, kind, source_week_id, published, notes)
  values (p_program, prog.client_id, 1, w1.start_date, 'normal', src, w1.published, 'Descarga antes del mesociclo')
  returning id into nw;
  for r in select * from public.routines where program_week_id = src order by position, day loop
    insert into public.routines (client_id, name, day, position, notes, program_week_id)
    values (r.client_id, r.name, r.day, r.position, r.notes, nw) returning id into nr;
    insert into public.routine_items (routine_id, client_id, exercise_id, exercise_name, media_url, position,
           sets, reps, reps_min, reps_max, load, load_kg, rest_sec, notes, lineage_id, target_rir, target_rpe, tempo, superset, progression, base)
    select nr, it.client_id, it.exercise_id, it.exercise_name, it.media_url, it.position,
           it.sets, it.reps, it.reps_min, it.reps_max, it.load, it.load_kg, it.rest_sec, it.notes, it.lineage_id,
           it.target_rir, it.target_rpe, it.tempo, it.superset, it.progression, it.base
      from public.routine_items it where it.routine_id = r.id order by it.position;
    -- parte de lo pautado (base) aunque la semana de origen fuera ya una descarga
    perform public._apply_kind_routine(nr, 'deload', null);
  end loop;
  update public.program_weeks set kind = 'deload', kind_set_at = now() where id = nw;
  return nw;
end $$;
revoke all on function public.delay_mesocycle(uuid, boolean, text) from public, anon;
grant execute on function public.delay_mesocycle(uuid, boolean, text) to authenticated;

commit;
