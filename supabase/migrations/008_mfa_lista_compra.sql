-- =====================================================================
-- 008 · Verificación en dos pasos para el entrenador + lista de la compra
-- Aditiva; se puede ejecutar más de una vez.
-- =====================================================================

-- 1) Si el entrenador tiene activada la verificación en dos pasos, sus permisos de entrenador
--    solo valen en una sesión verificada con el código (aal2). Sin factor activado, todo sigue igual.
--    Si alguna vez pierdes el móvil: Supabase → Authentication → Users → tu usuario → borrar el factor MFA.
create or replace function public.is_coach() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'coach')
     and (coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
          or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified'));
$$;

-- 2) Dieta del cliente: cada alimento lleva su categoría (para agrupar la lista de la compra)
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
                                           'unit', f.unit_name, 'category', coalesce(f.category, 'Otros'),
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
