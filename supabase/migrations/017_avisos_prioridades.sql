-- TEAM JMFIT · 017 · Avisos al cliente, quitar mesociclos y prioridades en el mesociclo
--   1) clients: avisos activables por cliente (check-in de los viernes y pago) y próximo pago
--      (lo copia la app del entrenador desde la hoja de cobros cada vez que la lee).
--   2) delete_mesocycle: quita un mesociclo publicado (las semanas ya entrenadas se conservan).
--   3) _meso_value: RIR por rango (normal 2 → 1), músculos prioritarios (más series, RIR 1 → 0,
--      descarga con su propio RIR) y tope de repeticiones (después sube la carga). Misma lógica que meso.js.
--   Aditiva: los mesociclos ya creados no cambian.
begin;

alter table public.clients add column if not exists remind_checkin boolean not null default true;
alter table public.clients add column if not exists remind_payment boolean not null default true;
alter table public.clients add column if not exists pay_due date;
alter table public.clients add column if not exists pay_plan text check (length(pay_plan) <= 80);
alter table public.clients add column if not exists pay_amount numeric check (pay_amount >= 0);

-- p_scope 'future': semanas desde esta (lunes) en adelante; 'all': todas. Nunca borra una semana con entrenos.
create or replace function public.delete_mesocycle(p_program uuid, p_scope text default 'future')
returns int language plpgsql security definer set search_path = public as $$
declare n int; cl uuid; mon date := date_trunc('week', current_date)::date;
begin
  if not public.is_coach() then raise exception 'Solo el entrenador'; end if;
  if p_scope not in ('future', 'all') then raise exception 'Alcance no válido'; end if;
  select client_id into cl from public.programs where id = p_program;
  if cl is null then raise exception 'Mesociclo no encontrado'; end if;
  delete from public.program_weeks w
   where w.program_id = p_program
     and (p_scope = 'all' or w.start_date >= mon)
     and not exists (select 1 from public.sessions s join public.routines r on r.id = s.routine_id where r.program_week_id = w.id);
  get diagnostics n = row_count;
  if not exists (select 1 from public.program_weeks where program_id = p_program) then
    delete from public.programs where id = p_program;
  else
    -- queda lo entrenado como historial; el cliente vuelve a lo que tenía antes
    update public.programs set status = 'archived', auto_repeat = false where id = p_program;
  end if;
  return n;
end $$;
revoke all on function public.delete_mesocycle(uuid, text) from public, anon;
grant execute on function public.delete_mesocycle(uuid, text) to authenticated;

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
  has_prio boolean := jsonb_typeof(o->'prio') = 'array' and jsonb_array_length(o->'prio') > 0;
  is_prio boolean := jsonb_typeof(o->'prio') = 'array' and (o->'prio') ? it.id::text;
  mode text := o->>'rir_mode'; hi numeric; lo numeric; cap int := case when jsonb_typeof(o->'rep_cap') = 'number' then greatest(0, (o->>'rep_cap')::int) end;
  step int; extra int;
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
    step := ks * rr;
    -- tope de repeticiones: pasado el tope se mantiene el rango y sube la carga (si la tiene)
    if cap is not null and step > cap then
      extra := step - cap; step := cap;
      if s_load is not null then v_load := public.round_load(s_load + ceil(extra::numeric / greatest(rr, 1)) * kg); end if;
    end if;
    v_min := it.reps_min + step; v_max := coalesce(it.reps_max, it.reps_min) + step;
    v_reps := case when v_min = v_max then v_min::text else v_min || '-' || v_max end;
  elsif t = 'sets' then v_sets := s_sets + least(2, ks / 2);
  end if;
  -- RIR de las semanas de carga
  if is_prio then
    hi := coalesce((o->>'prio_rir_hi')::numeric, 1); lo := coalesce((o->>'prio_rir_lo')::numeric, 0);
    v_rir := case when a > 1 then hi - round(kk * (hi - lo) / (a - 1)) else lo end;
  elsif mode = 'range' then
    hi := coalesce((o->>'rir_hi')::numeric, 2); lo := coalesce((o->>'rir_lo')::numeric, 1);
    v_rir := case when a > 1 then hi - round(kk * (hi - lo) / (a - 1)) else lo end;
  elsif mode = 'keep' then
    v_rir := s_rir;
  elsif (mode = 'routine' or mode is null) and coalesce((o->>'rir_ramp')::boolean, true) and s_rir is not null and a > 1 then
    fl := case when s_rir >= 1 then 1 else 0 end;
    v_rir := greatest(fl, s_rir - round(kk * (s_rir - fl) / (a - 1)));
  end if;
  -- volumen: más series en los prioritarios y, si se quiere, menos en el resto
  if is_prio then v_sets := greatest(1, v_sets + coalesce((o->>'prio_sets')::int, 1));
  elsif has_prio then v_sets := greatest(1, v_sets + coalesce((o->>'other_sets')::int, 0));
  end if;
  -- ajuste manual de la semana: RIR fijo y/o series de más o de menos
  ov_rir := case when jsonb_typeof(ov->'rir') = 'number' then least(10, greatest(0, (ov->>'rir')::numeric)) end;
  ov_sets := case when jsonb_typeof(ov->'sets') = 'number' then round((ov->>'sets')::numeric)::int else 0 end;
  if k < a then
    return jsonb_build_object('kind', 'normal', 'sets', greatest(1, v_sets + ov_sets), 'target_rir', coalesce(ov_rir, v_rir), 'load_kg', v_load, 'reps', v_reps, 'base', null);
  end if;
  d_sets := greatest(1, round(v_sets * (1 - vol))::int);
  d_rir := case when is_prio and o ? 'prio_dl_rir' then (o->>'prio_dl_rir')::numeric
                when not is_prio and o ? 'dl_rir' then (o->>'dl_rir')::numeric
                else greatest(coalesce(v_rir, 2), 2) end;
  return jsonb_build_object('kind', 'deload',
    'sets', greatest(1, d_sets + ov_sets),
    'load_kg', case when v_load is null then null else public.round_load(v_load * (1 - inten)) end,
    'target_rir', coalesce(ov_rir, d_rir), 'reps', v_reps,
    'base', jsonb_build_object('sets', v_sets, 'target_rir', v_rir, 'load_kg', v_load));
end $$;
revoke all on function public._meso_value(public.routine_items, int, int, jsonb) from public, anon, authenticated;

commit;
