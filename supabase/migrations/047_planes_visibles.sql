-- 047: planes nutricionales ocultos (borradores). El entrenador decide cuándo ve el cliente cada plan.
-- meal_plans.visible = false → el cliente no lo ve (ni sus comidas, ni en la lista de la compra) hasta que se publique.
alter table public.meal_plans add column if not exists visible boolean not null default true;

-- Quita del JSON de nutrición los planes ocultos y sus comidas
create or replace function public._hide_draft_plans(j jsonb, cid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when j is null or j ? 'blocked' or not exists (select 1 from public.meal_plans where client_id = cid and not visible) then j
    else jsonb_set(jsonb_set(j,
      '{plans}', coalesce((select jsonb_agg(x) from jsonb_array_elements(coalesce(j->'plans', '[]'::jsonb)) x
                            where not exists (select 1 from public.meal_plans mp where mp.id = (x->>'id')::uuid and not mp.visible)), '[]'::jsonb)),
      '{blocks}', coalesce((select jsonb_agg(x) from jsonb_array_elements(coalesce(j->'blocks', '[]'::jsonb)) x
                            where x->>'plan_id' is null or not exists (select 1 from public.meal_plans mp where mp.id = (x->>'plan_id')::uuid and not mp.visible)), '[]'::jsonb))
  end;
$$;
revoke all on function public._hide_draft_plans(jsonb, uuid) from public, anon, authenticated;

-- Lo que ve el cliente
create or replace function public.get_my_nutrition() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cid uuid := public.my_client_id();
begin
  if cid is not null and not public.client_access_ok(cid) then return jsonb_build_object('blocked', true); end if;
  return public._hide_draft_plans(public.get_my_nutrition_base(), cid);
end $$;
revoke all on function public.get_my_nutrition() from public, anon;
grant execute on function public.get_my_nutrition() to authenticated;

-- «Ver como el cliente» del entrenador: igual que lo ve el cliente
do $$ begin
  if not exists (select 1 from pg_proc where proname = 'get_client_nutrition_base' and pronamespace = 'public'::regnamespace) then
    alter function public.get_client_nutrition(uuid) rename to get_client_nutrition_base;
  end if;
end $$;
create or replace function public.get_client_nutrition(p_client uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_coach() then raise exception 'Solo el entrenador'; end if;
  return public._hide_draft_plans(public.get_client_nutrition_base(p_client), p_client);
end $$;
revoke all on function public.get_client_nutrition_base(uuid) from public, anon, authenticated;
revoke all on function public.get_client_nutrition(uuid) from public, anon;
grant execute on function public.get_client_nutrition(uuid) to authenticated;

-- Lista de la compra: el cliente no suma los planes ocultos
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
    where b.plan_id is null or not exists (select 1 from public.meal_plans mp where mp.id = b.plan_id and not mp.visible)
  )
  select coalesce(f.category, 'Otros'), coalesce(f.name, i.food_name), round(sum(public.item_grams(i.grams, i.units, f.unit_g)), 0),
         case when max(f.unit_g) > 0 then ceil(sum(public.item_grams(i.grams, i.units, f.unit_g)) / max(f.unit_g)) end, max(f.unit_name)
  from picked p
  join public.option_items i on i.option_id = p.option_id
  left join public.foods f on f.id = i.food_id
  group by 1, 2
  order by 1, 2;
$$;
