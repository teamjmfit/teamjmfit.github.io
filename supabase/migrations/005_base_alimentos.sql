-- =====================================================================
-- 005 · Base de alimentos (sincronizada con Google Sheets) y planes por comidas
-- Aditiva: no borra datos. Se puede ejecutar más de una vez.
-- =====================================================================

-- 1) Alimentos: fibra, tipo, supermercado, activo
alter table public.foods
  add column if not exists fiber numeric(5,1) not null default 0,
  add column if not exists kind text not null default 'Genérico',      -- Genérico / Marca / Suplemento
  add column if not exists store text not null default 'Genérico',     -- Mercadona, Lidl, Hiperdino…
  add column if not exists active boolean not null default true,
  add column if not exists source text,
  add column if not exists updated_at timestamptz not null default now();

-- 2) Cantidad en unidades (2 huevos, 4 lonchas). Si se cambia "g por medida" en la hoja,
--    los gramos del plan se recalculan solos.
alter table public.option_items
  add column if not exists units numeric(6,2) check (units is null or units > 0);

-- Gramos efectivos de un alimento del plan
create or replace function public.item_grams(p_grams numeric, p_units numeric, p_unit_g numeric)
returns numeric language sql immutable as $$
  select case when p_units is not null and p_unit_g > 0 then p_units * p_unit_g else p_grams end;
$$;

-- 3) Macros por opción (ahora con fibra y unidades)
drop view if exists public.option_macros;
create view public.option_macros with (security_invoker = on) as
with m as (
  select o.id as option_id, o.block_id, o.client_id, o.label, o.position,
         round(sum(public.item_grams(i.grams, i.units, f.unit_g) * f.kcal    / 100), 0) as kcal,
         round(sum(public.item_grams(i.grams, i.units, f.unit_g) * f.protein / 100), 1) as protein,
         round(sum(public.item_grams(i.grams, i.units, f.unit_g) * f.carbs   / 100), 1) as carbs,
         round(sum(public.item_grams(i.grams, i.units, f.unit_g) * f.fat     / 100), 1) as fat,
         round(sum(public.item_grams(i.grams, i.units, f.unit_g) * f.fiber   / 100), 1) as fiber
  from public.meal_options o
  join public.option_items i on i.option_id = o.id
  join public.foods f on f.id = i.food_id
  group by o.id
), ref as (
  select distinct on (block_id) block_id, kcal as ref_kcal from m order by block_id, position, label
)
select m.*, round(100.0 * (m.kcal - ref.ref_kcal) / nullif(ref.ref_kcal, 0), 1) as kcal_dev_pct
from m join ref using (block_id);
grant select on public.option_macros to authenticated;
revoke all on public.option_macros from anon;

-- 4) Sincronizar la hoja de alimentos (solo entrenador). Recibe las filas de la hoja.
--    Alta o actualización por nombre; los que ya no están en la hoja quedan inactivos (no se borran,
--    para no romper planes).
create or replace function public.sync_foods(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; n_new int := 0; n_upd int := 0; n_off int := 0; names text[] := '{}'; nm text; old public.foods;
begin
  if not public.is_coach() then raise exception 'Solo el entrenador'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 3000 then raise exception 'Datos no válidos'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    nm := left(btrim(r->>'name'), 120);
    if nm is null or nm = '' or (r->>'kcal') is null then continue; end if;
    names := names || nm;
    select * into old from public.foods where lower(name) = lower(nm) limit 1;
    if not found then
      insert into public.foods (name, kind, store, category, kcal, protein, carbs, fat, fiber, unit_name, unit_g, active, source, updated_at)
      values (nm, coalesce(nullif(r->>'kind',''), 'Genérico'), coalesce(nullif(r->>'store',''), 'Genérico'),
              coalesce(nullif(r->>'category',''), 'Otros'),
              (r->>'kcal')::numeric, coalesce((r->>'protein')::numeric, 0), coalesce((r->>'carbs')::numeric, 0),
              coalesce((r->>'fat')::numeric, 0), coalesce((r->>'fiber')::numeric, 0),
              nullif(r->>'unit_name',''), nullif(r->>'unit_g','')::numeric,
              coalesce((r->>'active')::boolean, true), nullif(r->>'source',''), now());
      n_new := n_new + 1;
    else
      update public.foods set
        name = nm,
        kind = coalesce(nullif(r->>'kind',''), 'Genérico'), store = coalesce(nullif(r->>'store',''), 'Genérico'),
        category = coalesce(nullif(r->>'category',''), 'Otros'),
        kcal = (r->>'kcal')::numeric, protein = coalesce((r->>'protein')::numeric, 0),
        carbs = coalesce((r->>'carbs')::numeric, 0), fat = coalesce((r->>'fat')::numeric, 0),
        fiber = coalesce((r->>'fiber')::numeric, 0),
        unit_name = nullif(r->>'unit_name',''), unit_g = nullif(r->>'unit_g','')::numeric,
        active = coalesce((r->>'active')::boolean, true), source = nullif(r->>'source',''), updated_at = now()
      where id = old.id
        and (old.name, old.kind, old.store, old.category, old.kcal, old.protein, old.carbs, old.fat, old.fiber,
             coalesce(old.unit_name,''), coalesce(old.unit_g,0), old.active, coalesce(old.source,''))
            is distinct from
            (nm, coalesce(nullif(r->>'kind',''), 'Genérico'), coalesce(nullif(r->>'store',''), 'Genérico'),
             coalesce(nullif(r->>'category',''), 'Otros'), (r->>'kcal')::numeric(6,1),
             coalesce((r->>'protein')::numeric, 0)::numeric(5,1), coalesce((r->>'carbs')::numeric, 0)::numeric(5,1),
             coalesce((r->>'fat')::numeric, 0)::numeric(5,1), coalesce((r->>'fiber')::numeric, 0)::numeric(5,1),
             coalesce(r->>'unit_name',''), coalesce(nullif(r->>'unit_g','')::numeric(6,1), 0),
             coalesce((r->>'active')::boolean, true), coalesce(r->>'source',''));
      if found then n_upd := n_upd + 1; end if;
    end if;
  end loop;
  update public.foods set active = false, updated_at = now()
   where active and not (lower(name) = any (select lower(x) from unnest(names) x));
  get diagnostics n_off = row_count;
  return jsonb_build_object('nuevos', n_new, 'actualizados', n_upd, 'desactivados', n_off, 'total', array_length(names, 1));
end $$;
revoke execute on function public.sync_foods(jsonb) from public, anon;
grant execute on function public.sync_foods(jsonb) to authenticated;

-- 5) Dieta del cliente: cantidades en unidades y macros por alimento (si el entrenador los muestra)
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
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'name', b.name, 'time_hint', b.time_hint, 'notes', b.notes,
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

-- 6) Lista de la compra con los gramos efectivos
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
  select coalesce(f.category, 'Otros'), coalesce(f.name, i.food_name), round(sum(public.item_grams(i.grams, i.units, f.unit_g)), 0),
         case when max(f.unit_g) > 0 then ceil(sum(public.item_grams(i.grams, i.units, f.unit_g)) / max(f.unit_g)) end, max(f.unit_name)
  from picked p
  join public.option_items i on i.option_id = p.option_id
  left join public.foods f on f.id = i.food_id
  group by 1, 2
  order by 1, 2;
$$;

-- 7) Copiar el plan por comidas de un cliente a otro (solo entrenador; sustituye el del destino)
create or replace function public.copy_meal_plan(p_from uuid, p_to uuid)
returns int language plpgsql security definer set search_path = public as $$
declare b public.meal_blocks; o public.meal_options; nb uuid; nopt uuid; n int := 0;
begin
  if not public.is_coach() then raise exception 'Solo el entrenador'; end if;
  if p_from = p_to then return 0; end if;
  delete from public.meal_blocks where client_id = p_to;
  for b in select * from public.meal_blocks where client_id = p_from order by position loop
    insert into public.meal_blocks (client_id, name, position, time_hint, notes)
    values (p_to, b.name, b.position, b.time_hint, b.notes) returning id into nb;
    n := n + 1;
    for o in select * from public.meal_options where block_id = b.id order by position, label loop
      insert into public.meal_options (block_id, client_id, label, name, position, notes)
      values (nb, p_to, o.label, o.name, o.position, o.notes) returning id into nopt;
      insert into public.option_items (option_id, client_id, food_id, food_name, grams, units, position)
      select nopt, p_to, food_id, food_name, grams, units, position from public.option_items where option_id = o.id;
    end loop;
  end loop;
  return n;
end $$;
revoke execute on function public.copy_meal_plan(uuid, uuid) from public, anon;
grant execute on function public.copy_meal_plan(uuid, uuid) to authenticated;

create index if not exists foods_active_name on public.foods(active, name);
