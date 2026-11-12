-- TEAM JMFIT · 015 · Plantillas de Programas (semanas base: PPL, torso/pierna, anterior/posterior…)
--   Una plantilla es un «cliente» interno (is_template, inactivo, correo .invalid) para reutilizar
--   los editores de rutinas, semanas y mesociclos. Aditiva.
begin;
alter table public.clients add column if not exists is_template boolean not null default false;
create index if not exists clients_is_template on public.clients (is_template) where is_template;
commit;
