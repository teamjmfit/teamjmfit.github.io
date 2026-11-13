-- 026: análisis semanal de cada check-in (analisis.js). Se guarda el resultado para comparar semana a semana.
create table if not exists public.checkin_analysis (
  id uuid primary key default gen_random_uuid(),
  checkin_id uuid not null unique references public.checkins(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  light text check (light in ('green', 'amber', 'red')),
  rules_v int not null default 1,
  result jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists checkin_analysis_client on public.checkin_analysis (client_id, created_at desc);
alter table public.checkin_analysis enable row level security;
drop policy if exists p_ckan_coach on public.checkin_analysis;
create policy p_ckan_coach on public.checkin_analysis for all to authenticated using (public.is_coach()) with check (public.is_coach());
drop policy if exists p_ckan_own on public.checkin_analysis;
create policy p_ckan_own on public.checkin_analysis for all to authenticated
  using (client_id = public.my_client_id()) with check (client_id = public.my_client_id());
grant select, insert, update, delete on public.checkin_analysis to authenticated;
revoke all on public.checkin_analysis from anon;
