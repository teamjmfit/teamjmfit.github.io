-- TEAM JMFIT · 020 · Retrasar un mesociclo una semana (con descarga antes) y diario del entrenador por cliente
--   delay_mesocycle: mueve todas las semanas del mesociclo 7 días más tarde. Con p_deload, en la
--   semana que queda libre pone una descarga (60 % de las series, misma carga, RIR 2 o el pautado si es más alto).
--   p_source 'prev': la descarga usa las rutinas de la última semana del bloque anterior;
--            'meso': las de la primera semana del mesociclo. Si no hay bloque anterior, usa las del mesociclo.
--   Solo si el mesociclo empieza esta semana o más adelante, no tiene entrenos y no hay nada planificado después.
--   client_notes: diario / bloc de notas del entrenador por cliente (solo lo ve el entrenador). Entra en la copia diaria.
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

-- Diario del entrenador por cliente
create table if not exists public.client_notes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  note_date date not null default current_date,
  tag text check (length(tag) <= 30),
  body text not null check (length(body) between 1 and 20000),
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists client_notes_client on public.client_notes (client_id, note_date desc, created_at desc);
alter table public.client_notes enable row level security;
drop policy if exists p_client_notes_coach on public.client_notes;
create policy p_client_notes_coach on public.client_notes for all using (public.is_coach()) with check (public.is_coach());
revoke all on public.client_notes from anon;

create or replace function public.backup_dump(p_key text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare t text; v jsonb; out jsonb := jsonb_build_object('generated_at', now());
begin
  if p_key is null or length(p_key) < 40
     or not exists (select 1 from public.backup_keys where hash = sha256(convert_to(p_key, 'UTF8'))) then
    raise exception 'Clave de copia no válida';
  end if;
  foreach t in array array['clients','checkins','checkin_photos','daily_metrics','nutrition_plans','meal_plans',
    'meal_blocks','meal_options','option_items','meal_choices','foods','programs','program_weeks','routines',
    'routine_items','sessions','set_logs','messages','exercises','profiles','form_responses','calendar_events','goals',
    'consents','client_notes'] loop
    if to_regclass('public.' || t) is not null then
      execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x', t) into v;
      out := out || jsonb_build_object(t, v);
    end if;
  end loop;
  select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) into v from public.settings s where s.key !~* '(token|secret|key|pass)';
  insert into public.settings (key, value) values ('last_backup', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
  on conflict (key) do update set value = excluded.value;
  return out || jsonb_build_object('settings', v);
end $$;
revoke execute on function public.backup_dump(text) from public;
grant execute on function public.backup_dump(text) to anon, authenticated;

commit;
