-- 037: el aviso de «estancado» del entrenador ya no cuenta las semanas de descarga (bajar carga ahí es lo normal).
create or replace function public.stagnation_alerts()
returns table (client_id uuid, exercise_name text, weight numeric, reps int, last_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_coach() then raise exception 'Solo el entrenador'; end if;
  return query
  with logs as (
    select l.client_id, coalesce(l.lineage_id::text, lower(l.exercise_name)) as k, l.exercise_name, l.weight, l.reps, l.created_at,
           date_trunc('week', l.created_at)::date as wk
      from public.set_logs l
      join public.routine_items it on it.id = l.routine_item_id
      join public.routines r on r.id = it.routine_id
      left join public.program_weeks pw on pw.id = r.program_week_id
     where l.created_at >= now() - interval '35 days' and l.weight > 0 and l.reps > 0 and it.position <= 1
       and coalesce(pw.kind, 'normal') <> 'deload'
  ), best as (
    select distinct on (b.client_id, b.k, b.wk) b.client_id, b.k, b.wk, b.exercise_name, b.weight, b.reps, b.created_at
      from logs b order by b.client_id, b.k, b.wk, b.weight desc, b.reps desc, b.created_at desc
  ), seq as (
    select b.*, lag(b.weight, 1) over w w1, lag(b.reps, 1) over w r1, lag(b.wk, 1) over w k1,
           lag(b.weight, 2) over w w2, lag(b.reps, 2) over w r2, lag(b.wk, 2) over w k2,
           row_number() over (partition by b.client_id, b.k order by b.wk desc) rn
      from best b window w as (partition by b.client_id, b.k order by b.wk)
  )
  select s.client_id, s.exercise_name, s.weight, s.reps, s.created_at
    from seq s
   where s.rn = 1 and s.created_at >= now() - interval '10 days'
     and s.w1 = s.weight and s.r1 = s.reps and s.w2 = s.weight and s.r2 = s.reps
     and s.k1 = s.wk - 7 and s.k2 = s.wk - 14
   order by s.created_at desc;
end $$;
revoke all on function public.stagnation_alerts() from public, anon;
grant execute on function public.stagnation_alerts() to authenticated;
