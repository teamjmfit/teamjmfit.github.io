-- 022: músculos prioritarios por rutina (sus ejercicios van al principio de la sesión).
alter table public.routines add column if not exists prio_muscles text[];

-- Las semanas nuevas de un mesociclo, las repeticiones automáticas y las copias de semana crean rutinas
-- con el mismo nombre: heredan la prioridad de la última rutina igual de ese cliente (el orden ya viaja con los ejercicios).
create or replace function public.routines_inherit_prio() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.prio_muscles is null then
    select r.prio_muscles into new.prio_muscles from public.routines r
     where r.client_id = new.client_id and r.name = new.name and r.prio_muscles is not null and r.id <> new.id
     order by r.created_at desc nulls last limit 1;
  end if;
  return new;
end $$;
drop trigger if exists routines_inherit_prio on public.routines;
create trigger routines_inherit_prio before insert on public.routines for each row execute function public.routines_inherit_prio();
