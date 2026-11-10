-- =====================================================================
--  TEAM JMFIT · Migración 001 · Funcionalidades avanzadas (FASE ADITIVA)
--  Solo AÑADE tablas, columnas, vistas y funciones. No borra ni cambia
--  nada de lo que usa la app en producción: se puede aplicar antes de
--  desplegar el frontend nuevo. Idempotente (se puede ejecutar dos veces).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) PROGRAMAS POR SEMANAS
-- ---------------------------------------------------------------------
create table if not exists public.programs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  start_date date not null,                       -- lunes de la semana 1
  status text not null default 'active' check (status in ('draft','active','archived')),
  deload_every int check (deload_every between 3 and 12),  -- sugerencia: deload cada N semanas
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.program_weeks (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  week_no int not null check (week_no >= 1),
  start_date date not null,
  kind text not null default 'normal' check (kind in ('normal','deload','test')),
  source_week_id uuid references public.program_weeks(id) on delete set null, -- de qué semana se clonó
  published boolean not null default false,       -- el cliente solo ve semanas publicadas
  notes text,
  created_at timestamptz not null default now(),
  unique (program_id, week_no)
);

-- Las rutinas existentes siguen funcionando (program_week_id = null = "semana fija" antigua)
alter table public.routines add column if not exists program_week_id uuid references public.program_weeks(id) on delete cascade;

-- ---------------------------------------------------------------------
-- 2) VARIABLES DE ENTRENAMIENTO (RIR/RPE, tempo, carga, progresión)
-- ---------------------------------------------------------------------
alter table public.routine_items
  add column if not exists lineage_id uuid not null default gen_random_uuid(), -- mismo ejercicio a lo largo de las semanas
  add column if not exists reps_min int,
  add column if not exists reps_max int,
  add column if not exists load_kg numeric(6,2),
  add column if not exists target_rir numeric(3,1) check (target_rir between 0 and 10),
  add column if not exists target_rpe numeric(3,1) check (target_rpe between 1 and 10),
  add column if not exists tempo text check (tempo is null or tempo ~ '^[0-9X]-[0-9X]-[0-9X]-[0-9X]$'),
  add column if not exists superset text,          -- 'A', 'B'… mismo valor = superserie
  add column if not exists progression jsonb not null default '{"type":"none"}'::jsonb;
  -- progression: {"type":"none"} | {"type":"load","inc_kg":2.5}
  --              {"type":"double","inc_kg":2.5}  (doble progresión: reps hasta reps_max y luego carga)
  --              {"type":"reps","inc":1}

-- Rellena reps_min / reps_max a partir del texto actual ("8-10", "12", "8–10")
update public.routine_items
   set reps_min = coalesce(reps_min, (regexp_match(reps, '^\s*(\d+)'))[1]::int),
       reps_max = coalesce(reps_max, coalesce((regexp_match(reps, '^\s*\d+\s*[-–]\s*(\d+)'))[1]::int,
                                              (regexp_match(reps, '^\s*(\d+)'))[1]::int))
 where reps ~ '^\s*\d';

-- …y lo mantiene sincronizado siempre que se cree o edite un ejercicio (también desde la app actual)
create or replace function public.parse_reps_range() returns trigger
language plpgsql as $$
begin
  if new.reps ~ '^\s*\d' and (tg_op = 'INSERT' or new.reps is distinct from old.reps
                              or new.reps_min is null or new.reps_max is null) then
    new.reps_min := (regexp_match(new.reps, '^\s*(\d+)'))[1]::int;
    new.reps_max := coalesce((regexp_match(new.reps, '^\s*\d+\s*[-–]\s*(\d+)'))[1]::int, new.reps_min);
  end if;
  return new;
end $$;
drop trigger if exists routine_items_reps on public.routine_items;
create trigger routine_items_reps before insert or update of reps, reps_min, reps_max on public.routine_items
  for each row execute function public.parse_reps_range();

alter table public.set_logs
  add column if not exists routine_item_id uuid references public.routine_items(id) on delete set null,
  add column if not exists lineage_id uuid,
  add column if not exists rir numeric(3,1) check (rir between 0 and 10),
  add column if not exists rpe numeric(3,1) check (rpe between 1 and 10);

create index if not exists setlogs_lineage on public.set_logs(client_id, lineage_id, created_at desc);
create index if not exists routines_week on public.routines(program_week_id);
create index if not exists pweeks_program on public.program_weeks(program_id, week_no);

-- Últimas series registradas de cada ejercicio (por linaje; respeta RLS de quien consulta)
create or replace view public.last_performance with (security_invoker = on) as
with ranked as (
  select sl.client_id, sl.lineage_id, sl.exercise_name, sl.set_no, sl.weight, sl.reps, sl.rir, sl.rpe,
         s.started_at,
         dense_rank() over (partition by sl.client_id, coalesce(sl.lineage_id::text, sl.exercise_name)
                            order by s.started_at desc, s.id) as rk
  from public.set_logs sl join public.sessions s on s.id = sl.session_id
  where s.finished_at is not null
)
select client_id, lineage_id, exercise_name, set_no, weight, reps, rir, rpe, started_at
from ranked where rk = 1;

-- ---------------------------------------------------------------------
-- 3) NUTRICIÓN MULTIOPCIÓN
-- ---------------------------------------------------------------------
alter table public.nutrition_plans
  add column if not exists show_macros boolean not null default true,
  add column if not exists swap_tolerance_pct int not null default 10 check (swap_tolerance_pct between 0 and 50);

create table if not exists public.foods (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text not null default 'Otros',          -- pasillo de la lista de la compra
  kcal numeric(6,1) not null, protein numeric(5,1) not null,   -- por 100 g
  carbs numeric(5,1) not null, fat numeric(5,1) not null,
  unit_name text, unit_g numeric(6,1),             -- ej. "huevo" = 60 g
  created_at timestamptz not null default now()
);

create table if not exists public.meal_blocks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,                               -- Desayuno, Comida…
  position int not null default 0,
  time_hint text,
  notes text
);

create table if not exists public.meal_options (
  id uuid primary key default gen_random_uuid(),
  block_id uuid not null references public.meal_blocks(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  label text not null default 'A',                  -- A, B, C
  name text,                                        -- "Tostadas con huevo"
  position int not null default 0,
  notes text
);

create table if not exists public.option_items (
  id uuid primary key default gen_random_uuid(),
  option_id uuid not null references public.meal_options(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  food_id uuid references public.foods(id) on delete set null,
  food_name text not null,
  grams numeric(7,1) not null check (grams > 0),
  position int not null default 0
);

-- Lo que el cliente elige/come cada día (alimenta adherencia y lista de la compra)
create table if not exists public.meal_choices (
  client_id uuid not null references public.clients(id) on delete cascade,
  date date not null,
  block_id uuid not null references public.meal_blocks(id) on delete cascade,
  option_id uuid references public.meal_options(id) on delete set null,
  eaten boolean not null default false,
  primary key (client_id, date, block_id)
);

create index if not exists mblocks_client on public.meal_blocks(client_id, position);
create index if not exists mopts_block on public.meal_options(block_id, position);
create index if not exists oitems_option on public.option_items(option_id, position);

-- Macros de cada opción y su desviación frente a la opción A del mismo bloque
create or replace view public.option_macros with (security_invoker = on) as
with m as (
  select o.id as option_id, o.block_id, o.client_id, o.label, o.position,
         round(sum(i.grams * f.kcal    / 100), 0) as kcal,
         round(sum(i.grams * f.protein / 100), 1) as protein,
         round(sum(i.grams * f.carbs   / 100), 1) as carbs,
         round(sum(i.grams * f.fat     / 100), 1) as fat
  from public.meal_options o
  join public.option_items i on i.option_id = o.id
  join public.foods f on f.id = i.food_id
  group by o.id
), ref as (
  select distinct on (block_id) block_id, kcal as ref_kcal from m order by block_id, position, label
)
select m.*, round(100.0 * (m.kcal - ref.ref_kcal) / nullif(ref.ref_kcal, 0), 1) as kcal_dev_pct
from m join ref using (block_id);

-- ---------------------------------------------------------------------
-- 4) PROGRESO: FOTOS POR POSE, MEDIDAS, MEDIA SEMANAL
-- ---------------------------------------------------------------------
alter table public.checkins
  add column if not exists neck numeric(5,1),
  add column if not exists shoulders numeric(5,1),
  add column if not exists calf numeric(5,1);

create table if not exists public.checkin_photos (
  id uuid primary key default gen_random_uuid(),
  checkin_id uuid not null references public.checkins(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  pose text not null check (pose in ('front','side','back')),
  path text not null,                                -- bucket 'checkins', carpeta = client_id
  created_at timestamptz not null default now(),
  unique (checkin_id, pose)
);

create or replace view public.weekly_weight with (security_invoker = on) as
select client_id,
       date_trunc('week', date)::date as week_start,
       round(avg(weight), 2) as avg_weight,
       count(weight) as n_days,
       round(avg(weight) - lag(avg(weight)) over (partition by client_id order by date_trunc('week', date)), 2) as delta_kg
from public.daily_metrics
where weight is not null
group by client_id, date_trunc('week', date);

-- ---------------------------------------------------------------------
-- 5) RLS de las tablas nuevas (entrenador todo; cliente lo suyo)
-- ---------------------------------------------------------------------
alter table public.programs       enable row level security;
alter table public.program_weeks  enable row level security;
alter table public.foods          enable row level security;
alter table public.meal_blocks    enable row level security;
alter table public.meal_options   enable row level security;
alter table public.option_items   enable row level security;
alter table public.meal_choices   enable row level security;
alter table public.checkin_photos enable row level security;

do $$
declare t text;
begin
  -- entrenador: todo
  foreach t in array array['programs','program_weeks','foods','meal_blocks','meal_options','option_items','meal_choices','checkin_photos'] loop
    execute format('drop policy if exists p_%1$s_coach on public.%1$s', t);
    execute format('create policy p_%1$s_coach on public.%1$s for all using (public.is_coach()) with check (public.is_coach())', t);
  end loop;
  -- cliente: escribe lo suyo
  foreach t in array array['meal_choices','checkin_photos'] loop
    execute format('drop policy if exists p_%1$s_self on public.%1$s', t);
    execute format('create policy p_%1$s_self on public.%1$s for all using (client_id = public.my_client_id()) with check (client_id = public.my_client_id())', t);
  end loop;
  -- cliente: solo lee lo suyo. Los bloques/opciones de dieta NO se exponen directamente:
  -- el cliente los lee por get_my_nutrition() para poder ocultar los macros de verdad.
  execute 'drop policy if exists p_programs_self on public.programs';
  execute 'create policy p_programs_self on public.programs for select using (client_id = public.my_client_id() and status = ''active'')';
  execute 'drop policy if exists p_program_weeks_self on public.program_weeks';
  execute 'create policy p_program_weeks_self on public.program_weeks for select using (client_id = public.my_client_id() and published)';
end $$;

-- El cliente no debe ver rutinas de semanas aún no publicadas
drop policy if exists p_routines_self on public.routines;
create policy p_routines_self on public.routines for select
  using (client_id = public.my_client_id()
         and (program_week_id is null
              or exists (select 1 from public.program_weeks w where w.id = program_week_id and w.published)));
drop policy if exists p_routine_items_self on public.routine_items;
create policy p_routine_items_self on public.routine_items for select
  using (client_id = public.my_client_id()
         and exists (select 1 from public.routines r where r.id = routine_id
                     and (r.program_week_id is null
                          or exists (select 1 from public.program_weeks w where w.id = r.program_week_id and w.published))));

revoke all on public.programs, public.program_weeks, public.foods, public.meal_blocks, public.meal_options,
              public.option_items, public.meal_choices, public.checkin_photos from anon;
grant select, insert, update, delete on public.programs, public.program_weeks, public.foods, public.meal_blocks,
              public.meal_options, public.option_items, public.meal_choices, public.checkin_photos to authenticated;
grant select on public.last_performance, public.option_macros, public.weekly_weight to authenticated;
revoke all on public.last_performance, public.option_macros, public.weekly_weight from anon;

-- ---------------------------------------------------------------------
-- 6) FUNCIONES
-- ---------------------------------------------------------------------

-- 6.1 Clonar / progresar una semana  →  ver 002 (archivo aparte, es la lógica clave)

-- 6.2 Dieta del cliente con macros visibles u ocultos según el entrenador
create or replace function public.get_my_nutrition() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cid uuid := public.my_client_id(); p public.nutrition_plans; show boolean;
begin
  if cid is null then return null; end if;
  select * into p from public.nutrition_plans where client_id = cid;
  show := coalesce(p.show_macros, true);
  return jsonb_build_object(
    'show_macros', show,
    'targets', case when show then jsonb_build_object('kcal', p.kcal, 'protein', p.protein, 'carbs', p.carbs, 'fat', p.fat) end,
    'water', p.water, 'notes', p.notes, 'legacy_meals', p.meals,
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'name', b.name, 'time_hint', b.time_hint, 'notes', b.notes,
        'options', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', o.id, 'label', o.label, 'name', o.name, 'notes', o.notes,
            'macros', case when show then (select to_jsonb(om) - 'option_id' - 'block_id' - 'client_id' - 'label' - 'position'
                                           from public.option_macros om where om.option_id = o.id) end,
            'items', coalesce((select jsonb_agg(jsonb_build_object('food', i.food_name, 'grams', i.grams,
                                         'unit', f.unit_name, 'units', case when f.unit_g > 0 then round(i.grams / f.unit_g, 1) end)
                                         order by i.position)
                               from public.option_items i left join public.foods f on f.id = i.food_id
                               where i.option_id = o.id), '[]'::jsonb)
          ) order by o.position, o.label)
          from public.meal_options o where o.block_id = b.id), '[]'::jsonb)
      ) order by b.position)
      from public.meal_blocks b where b.client_id = cid), '[]'::jsonb)
  );
end $$;

-- 6.3 Lista de la compra: suma gramos de la opción elegida cada día
--     (si el cliente no ha elegido, cuenta la opción A del bloque)
create or replace function public.shopping_list(p_client uuid, p_from date default current_date, p_days int default 7)
returns table (category text, food text, total_g numeric, units numeric, unit_name text)
language sql stable security definer set search_path = public as $$
  with allowed as (
    select p_client as cid where public.is_coach() or p_client = public.my_client_id()
  ), days as (
    select generate_series(p_from, p_from + (least(greatest(p_days, 1), 31) - 1), interval '1 day')::date as d
  ), picked as (
    select b.id as block_id, d.d,
           coalesce(mc.option_id,
                    (select o.id from public.meal_options o where o.block_id = b.id order by o.position, o.label limit 1)) as option_id
    from allowed a
    join public.meal_blocks b on b.client_id = a.cid
    cross join days d
    left join public.meal_choices mc on mc.client_id = a.cid and mc.block_id = b.id and mc.date = d.d
  )
  select coalesce(f.category, 'Otros'), i.food_name, round(sum(i.grams), 0),
         case when max(f.unit_g) > 0 then ceil(sum(i.grams) / max(f.unit_g)) end, max(f.unit_name)
  from picked p
  join public.option_items i on i.option_id = p.option_id
  left join public.foods f on f.id = i.food_id
  group by 1, 2
  order by 1, 2;
$$;

-- 6.4 Adherencia semanal (entreno y dieta, 0-100)
create or replace function public.weekly_adherence(p_client uuid, p_week_start date default date_trunc('week', current_date)::date)
returns table (training_pct int, diet_pct int, sessions_done int, sessions_planned int)
language plpgsql stable security definer set search_path = public as $$
declare planned int; done int; meals_total int; meals_eaten int; self_rating int;
begin
  if not (public.is_coach() or p_client = public.my_client_id()) then return; end if;
  -- planificado: rutinas con día de la semana del programa activo; si no hay programa, las rutinas fijas
  select count(*) into planned from public.routines r
   where r.client_id = p_client and r.day is not null
     and (r.program_week_id in (select w.id from public.program_weeks w
                                 where w.client_id = p_client and w.start_date = p_week_start)
          or (r.program_week_id is null and not exists (select 1 from public.program_weeks w
                                 where w.client_id = p_client and w.start_date = p_week_start)));
  select count(*) into done from public.sessions s
   where s.client_id = p_client and s.finished_at is not null
     and s.started_at >= p_week_start and s.started_at < p_week_start + 7;
  -- dieta: comidas marcadas como hechas; si no usa el registro de comidas, su autovaloración del check-in (1-5)
  select count(*) * 7 into meals_total from public.meal_blocks where client_id = p_client;
  select count(*) into meals_eaten from public.meal_choices
   where client_id = p_client and eaten and date >= p_week_start and date < p_week_start + 7;
  select adherence into self_rating from public.checkins
   where client_id = p_client and date >= p_week_start and date < p_week_start + 7 order by date desc limit 1;
  training_pct := case when planned > 0 then least(100, round(100.0 * done / planned)) end;
  diet_pct := case when meals_total > 0 and meals_eaten > 0 then least(100, round(100.0 * meals_eaten / meals_total))
                   when self_rating is not null then self_rating * 20 end;
  sessions_done := done; sessions_planned := planned;
  return next;
end $$;

revoke execute on function public.get_my_nutrition(), public.shopping_list(uuid, date, int),
                           public.weekly_adherence(uuid, date) from anon;
grant execute on function public.get_my_nutrition(), public.shopping_list(uuid, date, int),
                          public.weekly_adherence(uuid, date) to authenticated;

-- ---------------------------------------------------------------------
-- 7) Catálogo inicial de alimentos (valores medios por 100 g, BEDCA/USDA aprox.)
-- ---------------------------------------------------------------------
insert into public.foods (name, category, kcal, protein, carbs, fat, unit_name, unit_g) values
  ('Avena en copos','Cereales',372,13.5,58.7,7.0,null,null),
  ('Pan integral','Panadería',247,9.0,41.0,3.4,'rebanada',35),
  ('Arroz blanco (crudo)','Cereales',354,6.7,79.0,0.6,null,null),
  ('Pasta (cruda)','Cereales',358,12.5,71.0,1.5,null,null),
  ('Patata','Verdura y fruta',80,2.0,17.0,0.1,null,null),
  ('Plátano','Verdura y fruta',94,1.2,20.0,0.3,'unidad',120),
  ('Manzana','Verdura y fruta',52,0.3,12.0,0.2,'unidad',180),
  ('Huevo','Huevos y lácteos',143,12.6,0.7,9.5,'huevo',60),
  ('Claras de huevo','Huevos y lácteos',52,10.9,0.7,0.2,null,null),
  ('Leche semidesnatada','Huevos y lácteos',46,3.3,4.8,1.6,'vaso',250),
  ('Yogur proteico natural','Huevos y lácteos',60,10.0,4.0,0.2,'unidad',150),
  ('Queso fresco batido 0%','Huevos y lácteos',46,8.0,3.5,0.1,null,null),
  ('Pechuga de pollo','Carne y pescado',110,23.0,0.0,1.8,null,null),
  ('Pavo (fiambre)','Carne y pescado',105,20.0,2.0,1.8,null,null),
  ('Ternera magra','Carne y pescado',131,21.0,0.0,5.0,null,null),
  ('Merluza','Carne y pescado',71,15.9,0.0,0.9,null,null),
  ('Salmón','Carne y pescado',208,20.0,0.0,13.0,null,null),
  ('Atún al natural (lata)','Conservas',112,25.0,0.0,1.0,'lata',56),
  ('Garbanzos cocidos','Conservas',139,7.2,17.0,2.6,null,null),
  ('Aceite de oliva virgen extra','Aceites y frutos secos',884,0.0,0.0,100.0,'cucharada',10),
  ('Almendras','Aceites y frutos secos',579,21.0,9.0,50.0,null,null),
  ('Crema de cacahuete','Aceites y frutos secos',588,25.0,12.0,50.0,'cucharada',16),
  ('Proteína whey','Suplementos',380,78.0,6.0,5.0,'cacito',30),
  ('Verduras variadas','Verdura y fruta',30,2.0,4.0,0.3,null,null)
on conflict (name) do nothing;
