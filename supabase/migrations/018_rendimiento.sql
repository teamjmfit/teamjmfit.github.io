-- TEAM JMFIT · 018 · Rendimiento con más clientes y aviso de almacenamiento
--   1) Índices para las consultas que crecen con el tiempo (mesociclos, entrenos, series, check-ins).
--   2) storage_usage(): cuánto ocupan las fotos de los check-ins y la base de datos (solo el entrenador),
--      para avisar en su Inicio cuando se acerque al límite del plan.
--   Aditiva: no cambia ningún dato.
begin;

create index if not exists items_client on public.routine_items (client_id);
create index if not exists pweeks_client on public.program_weeks (client_id, start_date);
create index if not exists sessions_routine on public.sessions (routine_id);
create index if not exists sessions_started on public.sessions (started_at desc);
create index if not exists setlogs_client_created on public.set_logs (client_id, created_at desc);
create index if not exists checkins_created on public.checkins (created_at desc);

create or replace function public.storage_usage()
returns jsonb language plpgsql stable security definer set search_path = public, storage as $$
declare b bigint; n bigint;
begin
  if not public.is_coach() then raise exception 'Solo el entrenador'; end if;
  select coalesce(sum((o.metadata->>'size')::bigint), 0), count(*) into b, n
    from storage.objects o where o.bucket_id = 'checkins';
  return jsonb_build_object('photo_bytes', b, 'photos', n, 'db_bytes', pg_database_size(current_database()));
end $$;
revoke all on function public.storage_usage() from public, anon;
grant execute on function public.storage_usage() to authenticated;

commit;
