-- =====================================================================
-- 009 · Tipo de semana (normal / mantenimiento / descarga / intensidad),
--       cambios de rutina hacia las semanas siguientes y formularios de Google.
-- Aditiva; se puede ejecutar más de una vez.
-- =====================================================================

-- 1) Tipos de semana
alter table public.program_weeks drop constraint if exists program_weeks_kind_check;
alter table public.program_weeks add constraint program_weeks_kind_check
  check (kind in ('normal', 'maintenance', 'deload', 'intensity', 'test'));
alter table public.program_weeks add column if not exists kind_set_at timestamptz;
-- Lo pautado antes de aplicar descarga/intensidad (para poder volver atrás sin perder nada)
alter table public.routine_items add column if not exists base jsonb;

-- Aplica el tipo de semana a una rutina:
--   normal / mantenimiento → lo pautado
--   descarga  → 60 % de las series, misma carga, RIR +2 (máx. 5)
--   intensidad → RIR −1 (mín. 0) y +carga en los ejercicios que la semana anterior cumplieron el tope del rango con el RIR pedido
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
             target_rir = least(coalesce((b->>'target_rir')::numeric, 2) + 2, 5),
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

create or replace function public.set_week_kind(p_week uuid, p_kind text)
returns void language plpgsql security definer set search_path = public as $$
declare w public.program_weeks; prev uuid; r record;
begin
  if not public.is_coach() then raise exception 'Solo el entrenador'; end if;
  if p_kind not in ('normal', 'maintenance', 'deload', 'intensity') then raise exception 'Tipo no válido'; end if;
  select * into w from public.program_weeks where id = p_week;
  if not found then raise exception 'Semana no encontrada'; end if;
  select id into prev from public.program_weeks where program_id = w.program_id and week_no < w.week_no order by week_no desc limit 1;
  for r in select id from public.routines where program_week_id = p_week loop
    perform public._apply_kind_routine(r.id, p_kind, prev);
  end loop;
  update public.program_weeks set kind = p_kind, kind_set_at = now() where id = p_week;
end $$;
revoke execute on function public.set_week_kind(uuid, text) from public, anon;
grant execute on function public.set_week_kind(uuid, text) to authenticated;

-- 2) Pasar los cambios de una rutina a las semanas siguientes del programa.
--    No toca semanas pasadas ni las rutinas que el cliente ya ha entrenado.
--    En cada semana siguiente se conserva la carga que tenía cada ejercicio (su progresión)
--    y se vuelve a aplicar el tipo de esa semana (descarga, intensidad…).
create or replace function public.propagate_routine(p_routine uuid)
returns int language plpgsql security definer set search_path = public as $$
declare src public.routines; sw public.program_weeks; w public.program_weeks; t public.routines; tid uuid; prev uuid; n int := 0;
begin
  if not public.is_coach() then raise exception 'Solo el entrenador'; end if;
  select * into src from public.routines where id = p_routine;
  if not found or src.program_week_id is null then return 0; end if;
  select * into sw from public.program_weeks where id = src.program_week_id;
  for w in select * from public.program_weeks where program_id = sw.program_id and week_no > sw.week_no order by week_no loop
    select * into t from public.routines
     where program_week_id = w.id and (day is not distinct from src.day) and lower(name) = lower(src.name) limit 1;
    if not found then
      select * into t from public.routines where program_week_id = w.id and (day is not distinct from src.day) and position = src.position limit 1;
    end if;
    if found and exists (select 1 from public.sessions s where s.routine_id = t.id and s.finished_at is not null) then
      continue;                                   -- ya entrenada: no se cambia
    end if;
    if found then
      tid := t.id;
      update public.routines set name = src.name, day = src.day, notes = src.notes where id = tid;
    else
      insert into public.routines (client_id, name, day, position, notes, program_week_id)
      values (src.client_id, src.name, src.day, src.position, src.notes, w.id) returning id into tid;
    end if;
    -- cargas que ya tenía cada ejercicio en esa semana (por linaje)
    create temp table if not exists _loads (lineage_id uuid primary key, load_kg numeric) on commit drop;
    delete from _loads;
    insert into _loads select lineage_id, coalesce((base->>'load_kg')::numeric, load_kg) from public.routine_items
      where routine_id = tid on conflict do nothing;
    delete from public.routine_items where routine_id = tid;
    insert into public.routine_items (routine_id, client_id, exercise_id, exercise_name, media_url, position,
           sets, reps, reps_min, reps_max, load, load_kg, rest_sec, notes,
           lineage_id, target_rir, target_rpe, tempo, superset, progression, base)
    select tid, i.client_id, i.exercise_id, i.exercise_name, i.media_url, i.position,
           coalesce((i.base->>'sets')::int, i.sets), i.reps, i.reps_min, i.reps_max, i.load,
           coalesce(l.load_kg, (i.base->>'load_kg')::numeric, i.load_kg), i.rest_sec, i.notes,
           i.lineage_id, coalesce((i.base->>'target_rir')::numeric, i.target_rir), i.target_rpe, i.tempo, i.superset, i.progression, null
      from public.routine_items i left join _loads l on l.lineage_id = i.lineage_id
     where i.routine_id = src.id order by i.position;
    if w.kind in ('deload', 'intensity') then
      select id into prev from public.program_weeks where program_id = w.program_id and week_no < w.week_no order by week_no desc limit 1;
      perform public._apply_kind_routine(tid, w.kind, prev);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.propagate_routine(uuid) from public, anon;
grant execute on function public.propagate_routine(uuid) to authenticated;

-- 3) Respuestas de los formularios de Google (las envía el script de copia; solo las ve el entrenador)
create table if not exists public.form_responses (
  id uuid primary key default gen_random_uuid(),
  form text not null,                       -- 'plan' (Plan 1:1) o 'salud' (Datos Base y Salud)
  submitted_at timestamptz not null,
  name text, email text,
  answers jsonb not null,                   -- [[pregunta, respuesta], …] en el orden del formulario
  client_id uuid references public.clients(id) on delete set null,
  seen boolean not null default false,
  created_at timestamptz not null default now(),
  unique (form, submitted_at, name)
);
create index if not exists form_responses_client on public.form_responses(client_id);
alter table public.form_responses enable row level security;
drop policy if exists p_form_responses_coach on public.form_responses;
create policy p_form_responses_coach on public.form_responses for all using (public.is_coach()) with check (public.is_coach());
revoke all on public.form_responses from anon;
grant select, insert, update, delete on public.form_responses to authenticated;

create or replace function public._norm(t text) returns text language sql immutable as $$
  select btrim(regexp_replace(lower(translate(coalesce(t, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')), '\s+', ' ', 'g'));
$$;

create or replace function public.ingest_forms(p_key text, p_form text, p_rows jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare r jsonb; nm text; em text; cid uuid; n int := 0; ts timestamptz; isnew boolean;
begin
  if p_key is null or not exists (select 1 from public.backup_keys where hash = sha256(convert_to(p_key, 'UTF8'))) then
    raise exception 'Clave no válida';
  end if;
  if p_form not in ('plan', 'salud') or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then raise exception 'Datos no válidos'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    begin ts := (r->>'ts')::timestamptz; exception when others then continue; end;
    nm := left(btrim(r->>'name'), 120); em := lower(btrim(r->>'email'));
    cid := null;
    if em <> '' then select id into cid from public.clients where lower(email) = em limit 1; end if;
    if cid is null and nm <> '' then
      -- nombre y primer apellido; si solo hay nombre, únicamente si hay un cliente con ese nombre
      select id into cid from public.clients
       where array_to_string((string_to_array(public._norm(name), ' '))[1:2], ' ') = array_to_string((string_to_array(public._norm(nm), ' '))[1:2], ' ')
       limit 1;
      if cid is null and array_length(string_to_array(public._norm(nm), ' '), 1) = 1 then
        select (array_agg(id))[1] into cid from public.clients where split_part(public._norm(name), ' ', 1) = public._norm(nm) having count(*) = 1;
      end if;
    end if;
    insert into public.form_responses (form, submitted_at, name, email, answers, client_id)
    values (p_form, ts, nm, nullif(em, ''), r->'answers', cid)
    on conflict (form, submitted_at, name) do update set answers = excluded.answers,
      client_id = coalesce(public.form_responses.client_id, excluded.client_id)
    returning (xmax = 0) into isnew;
    if isnew then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke execute on function public.ingest_forms(text, text, jsonb) from public;
grant execute on function public.ingest_forms(text, text, jsonb) to anon, authenticated;

-- La copia diaria incluye también las respuestas de los formularios
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
    'routine_items','sessions','set_logs','messages','exercises','profiles','form_responses'] loop
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
