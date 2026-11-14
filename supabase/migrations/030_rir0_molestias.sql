-- 030: RIR 0 distinto de «al fallo» en los mesociclos, quitar el aviso de molestias de un check-in
-- y, a petición de Jorge, quitar el aviso de la última revisión de Miguel González (dijo que no tenía molestias).

-- 1) Molestias: el entrenador puede marcar que un check-in no tiene molestias (no sale ⚠️ ni en el semáforo)
alter table public.checkins add column if not exists pain_ok boolean not null default false;
update public.checkins set pain_ok = true
 where id = (select k.id from public.checkins k join public.clients c on c.id = k.client_id
              where c.name ilike 'miguel gonz%' order by k.date desc, k.created_at desc limit 1);

-- 2) Mesociclos: un RIR 0 es «al fallo» solo si se elige «Fallo» (progression.fail); si no, es RIR 0.
--    weeks[k].fail manda en esa semana; en los modos rango/prioridades, opts.zero_fail; si no, lo que tuviera el ejercicio.
create or replace function public._meso_fail(it public.routine_items, k int, o jsonb, v jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select case
    when (v->>'target_rir') is null or (v->>'target_rir')::numeric <> 0 then coalesce(it.progression, '{}'::jsonb) - 'fail'
    else jsonb_set(coalesce(it.progression, '{}'::jsonb), '{fail}', to_jsonb(
      case when coalesce(o->'weeks'->k, '{}'::jsonb) ? 'fail' then coalesce((o->'weeks'->k->>'fail')::boolean, false)
           when coalesce(o->'weeks'->k, '{}'::jsonb) ? 'rir' then false
           when o->>'rir_mode' = 'range' or jsonb_array_length(coalesce(o->'prio', '[]'::jsonb)) > 0 then coalesce((o->>'zero_fail')::boolean, false)
           else coalesce((it.progression->>'fail')::boolean, false) end))
  end;
$$;
revoke all on function public._meso_fail(public.routine_items, int, jsonb, jsonb) from public, anon;
grant execute on function public._meso_fail(public.routine_items, int, jsonb, jsonb) to authenticated;

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
               (v->>'target_rir')::numeric, it.target_rpe, it.tempo, it.superset, public._meso_fail(it, k, o, v),
               case when jsonb_typeof(v->'base') = 'object' then v->'base' end);
      end loop;
    end loop;
  end loop;
  return prog;
end $$;
revoke all on function public.create_mesocycle(uuid, text, date, int, jsonb, uuid) from public, anon;
grant execute on function public.create_mesocycle(uuid, text, date, int, jsonb, uuid) to authenticated;
