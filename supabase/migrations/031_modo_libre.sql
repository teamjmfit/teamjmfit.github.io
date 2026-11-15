-- 031: modo libre. Si el entrenador lo activa (clients.ui_prefs.libre = true), el cliente puede crear, editar y borrar
-- SUS PROPIAS rutinas fijas (routines.by_client) y entrenarlas. Nunca puede tocar las rutinas que pone el entrenador.

alter table public.routines add column if not exists by_client boolean not null default false;

create or replace function public.free_mode_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (c.ui_prefs->>'libre')::boolean from public.clients c where c.id = public.my_client_id()), false);
$$;
create or replace function public.own_free_routine(p_routine uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.routines r where r.id = p_routine and r.client_id = public.my_client_id() and r.by_client and r.program_week_id is null);
$$;
revoke all on function public.free_mode_ok(), public.own_free_routine(uuid) from public, anon;
grant execute on function public.free_mode_ok(), public.own_free_routine(uuid) to authenticated;

drop policy if exists p_routines_free_ins on public.routines;
create policy p_routines_free_ins on public.routines for insert to authenticated
  with check (client_id = public.my_client_id() and by_client and program_week_id is null and public.free_mode_ok());
drop policy if exists p_routines_free_upd on public.routines;
create policy p_routines_free_upd on public.routines for update to authenticated
  using (client_id = public.my_client_id() and by_client)
  with check (client_id = public.my_client_id() and by_client and program_week_id is null and public.free_mode_ok());
drop policy if exists p_routines_free_del on public.routines;
create policy p_routines_free_del on public.routines for delete to authenticated
  using (client_id = public.my_client_id() and by_client and program_week_id is null);

drop policy if exists p_items_free_ins on public.routine_items;
create policy p_items_free_ins on public.routine_items for insert to authenticated
  with check (client_id = public.my_client_id() and public.own_free_routine(routine_id) and public.free_mode_ok());
drop policy if exists p_items_free_upd on public.routine_items;
create policy p_items_free_upd on public.routine_items for update to authenticated
  using (client_id = public.my_client_id() and public.own_free_routine(routine_id))
  with check (client_id = public.my_client_id() and public.own_free_routine(routine_id) and public.free_mode_ok());
drop policy if exists p_items_free_del on public.routine_items;
create policy p_items_free_del on public.routine_items for delete to authenticated
  using (client_id = public.my_client_id() and public.own_free_routine(routine_id));
