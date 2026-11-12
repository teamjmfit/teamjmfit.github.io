-- TEAM JMFIT · 014 · Mesociclos: RIR y series ajustables por semana (opts.weeks[k] = {rir, sets})
--   Solo redefine _meso_value; create_mesocycle ya le pasa las opciones. Misma lógica que meso.js.
begin;

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
  d_sets := greatest(1, round(v_sets * (1 - vol))::int); d_rir := least(coalesce(v_rir, 2) + 2, 5);
  return jsonb_build_object('kind', 'deload',
    'sets', greatest(1, d_sets + ov_sets),
    'load_kg', case when v_load is null then null else public.round_load(v_load * (1 - inten)) end,
    'target_rir', coalesce(ov_rir, d_rir), 'reps', v_reps,
    'base', jsonb_build_object('sets', v_sets, 'target_rir', v_rir, 'load_kg', v_load));
end $$;
revoke all on function public._meso_value(public.routine_items, int, int, jsonb) from public, anon, authenticated;

commit;
