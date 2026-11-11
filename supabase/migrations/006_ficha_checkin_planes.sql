-- =====================================================================
-- 006 · Ficha del cliente, check-in completo (formulario de Harbiz),
--       varios planes de nutrición por cliente y progreso.
-- Aditiva: no borra datos. Se puede ejecutar más de una vez.
-- =====================================================================

-- 1) Ficha del cliente
alter table public.clients
  add column if not exists birth_date date,
  add column if not exists sex text check (sex is null or sex in ('male','female','other')),
  add column if not exists height_cm numeric(5,1),
  add column if not exists goal_weight numeric(5,1),
  add column if not exists weekly_target numeric(4,2),      -- kg por semana que se busca (negativo = bajar)
  add column if not exists activity text,
  add column if not exists injuries text,
  add column if not exists start_date date;

-- 2) Check-in: preguntas del formulario «VALORACION SEMANAL» (escala 1-10 salvo pasos y textos)
alter table public.checkins
  add column if not exists train_adh int  check (train_adh  between 1 and 10),
  add column if not exists diet_adh  int  check (diet_adh   between 1 and 10),
  add column if not exists steps     int  check (steps >= 0 and steps < 200000),
  add column if not exists hunger    int  check (hunger     between 1 and 10),
  add column if not exists satiety   int  check (satiety    between 1 and 10),
  add column if not exists fatigue   int  check (fatigue    between 1 and 10),   -- fatiga central
  add column if not exists fatigue_muscles text,                                 -- fatiga periférica
  add column if not exists pains     text,
  add column if not exists misses    text,
  add column if not exists energy10  int  check (energy10   between 1 and 10),
  add column if not exists sleep_h   numeric(3,1) check (sleep_h between 0 and 24),
  add column if not exists sleep_q   int  check (sleep_q    between 1 and 10),
  add column if not exists stress    int  check (stress     between 1 and 10),
  add column if not exists motivation int check (motivation between 1 and 10),
  add column if not exists source    text;                                       -- 'harbiz' si se importó

-- Varias fotos por check-in: frente, perfil, espalda y extras (extra1, extra2…)
alter table public.checkin_photos drop constraint if exists checkin_photos_pose_check;
alter table public.checkin_photos drop constraint if exists checkin_photos_pose_ok;
alter table public.checkin_photos add constraint checkin_photos_pose_ok check (pose ~ '^[a-z0-9_]{1,20}$');
create index if not exists checkin_photos_client on public.checkin_photos(client_id, checkin_id);

-- El entrenador puede borrar check-ins (las fotos asociadas se borran en cascada)
drop policy if exists p_checkins_coach_delete on public.checkins;
create policy p_checkins_coach_delete on public.checkins for delete using (public.is_coach());

-- 3) Varios planes de nutrición por cliente (p. ej. «Día de entreno» y «Día de descanso»)
create table if not exists public.meal_plans (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null default 'Plan',
  position int not null default 0,
  kcal int, protein int, carbs int, fat int,                 -- objetivo propio (si está vacío, el general)
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists meal_plans_client on public.meal_plans(client_id, position);
alter table public.meal_plans enable row level security;
drop policy if exists p_meal_plans_coach on public.meal_plans;
create policy p_meal_plans_coach on public.meal_plans for all using (public.is_coach()) with check (public.is_coach());
revoke all on public.meal_plans from anon;
grant select, insert, update, delete on public.meal_plans to authenticated;

alter table public.meal_blocks add column if not exists plan_id uuid references public.meal_plans(id) on delete cascade;
create index if not exists meal_blocks_plan on public.meal_blocks(plan_id, position);

-- Pasar lo que ya hay: comidas con prefijo «X · Nombre» se separan en planes; el resto, a un plan «Plan»
do $$
declare c record; pre text; pid uuid; n int;
begin
  for c in select distinct client_id from public.meal_blocks where plan_id is null loop
    n := coalesce((select max(position) + 1 from public.meal_plans where client_id = c.client_id), 0);
    for pre in
      select p from (
        select distinct case when name ~ '^.{1,30} · ' then split_part(name, ' · ', 1) else '' end as p,
               min(position) over (partition by case when name ~ '^.{1,30} · ' then split_part(name, ' · ', 1) else '' end) as o
        from public.meal_blocks where client_id = c.client_id and plan_id is null
      ) x order by o
    loop
      insert into public.meal_plans (client_id, name, position)
      values (c.client_id, case when pre = '' then 'Plan' when pre = 'Entreno' then 'Día de entreno'
                                when pre = 'Descanso' then 'Día de descanso' else pre end, n)
      returning id into pid;
      n := n + 1;
      update public.meal_blocks set plan_id = pid,
             name = case when pre = '' then name else substr(name, length(pre) + 4) end
       where client_id = c.client_id and plan_id is null
         and (case when name ~ '^.{1,30} · ' then split_part(name, ' · ', 1) else '' end) = pre;
    end loop;
  end loop;
end $$;

-- Copiar plan: ahora copia también los planes
create or replace function public.copy_meal_plan(p_from uuid, p_to uuid)
returns int language plpgsql security definer set search_path = public as $$
declare pl public.meal_plans; b public.meal_blocks; o public.meal_options; npl uuid; nb uuid; nopt uuid; n int := 0;
begin
  if not public.is_coach() then raise exception 'Solo el entrenador'; end if;
  if p_from = p_to then return 0; end if;
  delete from public.meal_blocks where client_id = p_to;
  delete from public.meal_plans where client_id = p_to;
  for pl in select * from public.meal_plans where client_id = p_from order by position loop
    insert into public.meal_plans (client_id, name, position, kcal, protein, carbs, fat, notes)
    values (p_to, pl.name, pl.position, pl.kcal, pl.protein, pl.carbs, pl.fat, pl.notes) returning id into npl;
    for b in select * from public.meal_blocks where plan_id = pl.id order by position loop
      insert into public.meal_blocks (client_id, plan_id, name, position, time_hint, notes)
      values (p_to, npl, b.name, b.position, b.time_hint, b.notes) returning id into nb;
      n := n + 1;
      for o in select * from public.meal_options where block_id = b.id order by position, label loop
        insert into public.meal_options (block_id, client_id, label, name, position, notes)
        values (nb, p_to, o.label, o.name, o.position, o.notes) returning id into nopt;
        insert into public.option_items (option_id, client_id, food_id, food_name, grams, units, position)
        select nopt, p_to, food_id, food_name, grams, units, position from public.option_items where option_id = o.id;
      end loop;
    end loop;
  end loop;
  return n;
end $$;
revoke execute on function public.copy_meal_plan(uuid, uuid) from public, anon;
grant execute on function public.copy_meal_plan(uuid, uuid) to authenticated;

-- Dieta del cliente con sus planes
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
    'water', p.water, 'notes', p.notes, 'legacy_meals', p.meals, 'updated_at', p.updated_at,
    'plans', coalesce((
      select jsonb_agg(jsonb_build_object('id', mp.id, 'name', mp.name, 'notes', mp.notes,
             'targets', case when show and mp.kcal is not null then jsonb_build_object('kcal', mp.kcal, 'protein', mp.protein, 'carbs', mp.carbs, 'fat', mp.fat) end)
             order by mp.position)
      from public.meal_plans mp where mp.client_id = cid), '[]'::jsonb),
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'plan_id', b.plan_id, 'name', b.name, 'time_hint', b.time_hint, 'notes', b.notes,
        'options', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', o.id, 'label', o.label, 'name', o.name, 'notes', o.notes,
            'macros', case when show then (select to_jsonb(om) - 'option_id' - 'block_id' - 'client_id' - 'label' - 'position'
                                           from public.option_macros om where om.option_id = o.id) end,
            'items', coalesce((select jsonb_agg(jsonb_build_object(
                                           'food', coalesce(f.name, i.food_name),
                                           'grams', round(public.item_grams(i.grams, i.units, f.unit_g), 0),
                                           'unit', f.unit_name,
                                           'units', coalesce(i.units, case when f.unit_g > 0 then round(i.grams / f.unit_g, 1) end),
                                           'kcal', case when show then round(public.item_grams(i.grams, i.units, f.unit_g) * f.kcal / 100) end)
                                         order by i.position)
                               from public.option_items i left join public.foods f on f.id = i.food_id
                               where i.option_id = o.id), '[]'::jsonb)
          ) order by o.position, o.label)
          from public.meal_options o where o.block_id = b.id), '[]'::jsonb)
      ) order by b.position)
      from public.meal_blocks b where b.client_id = cid), '[]'::jsonb)
  );
end $$;
