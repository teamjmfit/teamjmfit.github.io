-- TEAM JMFIT · 013 · Objetivos S.M.A.R.T. (aditiva)
--   El cliente o el entrenador definen metas medibles con fecha límite; los micro-objetivos por bloque
--   y el progreso se calculan en la app a partir de check-ins, pesajes y series.
begin;

-- % de grasa en el check-in (opcional), para poder medir ese tipo de objetivo
alter table public.checkins add column if not exists body_fat numeric(4,1) check (body_fat between 2 and 70);

create table if not exists public.goals (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete cascade,
  title         text not null check (length(title) between 3 and 200),
  metric        text not null check (metric in ('weight','body_fat','waist','hip','chest','arm','thigh','e1rm')),
  exercise_name text check (length(exercise_name) <= 120),
  start_value   numeric(7,2) not null check (start_value > 0),
  target_value  numeric(7,2) not null check (target_value > 0),
  start_date    date not null default current_date,
  deadline      date not null,
  block_weeks   int not null default 4 check (block_weeks in (4, 6)),
  focus         text check (focus in ('fat_loss','muscle','strength','recomp','health')),
  why           text check (length(why) <= 1000),
  is_primary    boolean not null default true,
  status        text not null default 'active' check (status in ('active','done','dropped')),
  achieved_at   timestamptz,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  check (deadline > start_date),
  check (target_value <> start_value),
  check (metric <> 'e1rm' or exercise_name is not null)
);
create index if not exists goals_client on public.goals (client_id, status);

alter table public.goals enable row level security;
drop policy if exists p_goals_coach on public.goals;
create policy p_goals_coach on public.goals for all using (public.is_coach()) with check (public.is_coach());
-- El cliente gestiona sus propios objetivos
drop policy if exists p_goals_self on public.goals;
create policy p_goals_self on public.goals for all
  using (client_id = public.my_client_id()) with check (client_id = public.my_client_id());

revoke all on public.goals from anon;
grant select, insert, update, delete on public.goals to authenticated;

-- La copia diaria incluye también el calendario y los objetivos
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
    'routine_items','sessions','set_logs','messages','exercises','profiles','form_responses','calendar_events','goals'] loop
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

commit;
