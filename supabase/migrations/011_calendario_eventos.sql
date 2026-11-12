-- TEAM JMFIT · 011 · Calendario interactivo: eventos por día (entreno puntual, cardio,
-- movilidad, revisión, fotos, nota). Aditivo: no toca tablas existentes.
begin;

create table if not exists public.calendar_events (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  date        date not null,
  kind        text not null check (kind in ('workout','cardio','mobility','checkin','photos','note')),
  title       text not null default '' check (length(title) <= 120),
  notes       text check (length(notes) <= 2000),
  routine_id  uuid references public.routines(id) on delete set null,
  minutes     int check (minutes between 1 and 600),
  series_id   uuid,
  visible     boolean not null default true,
  done_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists calendar_events_client_date on public.calendar_events (client_id, date);
create index if not exists calendar_events_series on public.calendar_events (series_id) where series_id is not null;

alter table public.calendar_events enable row level security;
drop policy if exists p_calendar_events_coach on public.calendar_events;
create policy p_calendar_events_coach on public.calendar_events for all
  using (public.is_coach()) with check (public.is_coach());
-- El cliente solo lee lo suyo y lo que no es nota privada del entrenador
drop policy if exists p_calendar_events_self on public.calendar_events;
create policy p_calendar_events_self on public.calendar_events for select
  using (client_id = public.my_client_id() and visible);

revoke all on public.calendar_events from anon;
grant select, insert, update, delete on public.calendar_events to authenticated;

-- El cliente solo puede marcar o desmarcar como hecho (nada más)
create or replace function public.set_event_done(p_id uuid, p_done boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.calendar_events
     set done_at = case when p_done then coalesce(done_at, now()) else null end
   where id = p_id
     and (public.is_coach() or (client_id = public.my_client_id() and visible));
  if not found then raise exception 'Evento no encontrado'; end if;
end $$;
revoke all on function public.set_event_done(uuid, boolean) from public, anon;
grant execute on function public.set_event_done(uuid, boolean) to authenticated;

commit;
