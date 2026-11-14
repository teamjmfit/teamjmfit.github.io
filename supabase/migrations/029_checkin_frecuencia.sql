-- 029: frecuencia del check-in por cliente, descartes del entrenador y qué ve cada cliente en su app.
-- Periodos de 7 o 14 días desde ck_anchor (un lunes); el día clave es el viernes de la última semana (ck_day).
-- Un check-in guarda qué periodos cubre (period_start–period_end): enviado tarde, cubre todos los pendientes.

alter table public.clients add column if not exists ck_freq text not null default 'semanal';
alter table public.clients drop constraint if exists clients_ck_freq_chk;
alter table public.clients add constraint clients_ck_freq_chk check (ck_freq in ('semanal', 'quincenal', 'ninguno'));
alter table public.clients add column if not exists ck_day smallint not null default 5 check (ck_day between 1 and 7);
-- solo cuentan los periodos desde hoy: nadie aparece con atrasados antiguos al ejecutar esto
alter table public.clients add column if not exists ck_anchor date not null default (date_trunc('week', current_date))::date;
alter table public.clients add column if not exists ui_prefs jsonb not null default '{}'::jsonb;
alter table public.clients drop constraint if exists clients_ui_prefs_chk;
alter table public.clients add constraint clients_ui_prefs_chk check (jsonb_typeof(ui_prefs) = 'object' and pg_column_size(ui_prefs) < 4000);

alter table public.checkins add column if not exists period_start date;
alter table public.checkins add column if not exists period_end date;
update public.checkins set period_start = (date_trunc('week', date))::date, period_end = (date_trunc('week', date))::date + 6
 where period_start is null and date is not null;

create table if not exists public.checkin_skips (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  period_start date not null,
  period_end date not null check (period_end >= period_start),
  reason text check (char_length(reason) <= 120),
  created_at timestamptz not null default now()
);
create index if not exists checkin_skips_client on public.checkin_skips (client_id, period_start desc);
alter table public.checkin_skips enable row level security;
drop policy if exists p_ckskip_coach on public.checkin_skips;
create policy p_ckskip_coach on public.checkin_skips for all to authenticated using (public.is_coach()) with check (public.is_coach());
drop policy if exists p_ckskip_own on public.checkin_skips;
create policy p_ckskip_own on public.checkin_skips for select to authenticated using (client_id = public.my_client_id());
grant select on public.checkin_skips to authenticated;
grant insert, update, delete on public.checkin_skips to authenticated;   -- solo el entrenador, por la política
revoke all on public.checkin_skips from anon;
