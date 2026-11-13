-- 025: vencimientos del plan. Del día del vencimiento (pay_due) al +3: avisos diarios en la app del cliente.
-- Desde el día 4 sin pago: el cliente deja de ver rutinas, calendario y nutrición hasta que se registre el cobro
-- (nueva fecha en la hoja de cobros), el entrenador le dé días o el cliente pulse «Ya he pagado» (48 h mientras se revisa).
-- Siempre puede: ver su perfil, privacidad, descargar sus datos, pedir el borrado y escribir al entrenador.

alter table public.clients add column if not exists grace_days int not null default 0;     -- días extra que da Jorge
alter table public.clients add column if not exists access_until date;                     -- desbloqueado a mano hasta esa fecha
alter table public.clients add column if not exists billing_off boolean not null default false;  -- sin avisos ni bloqueo

create table if not exists public.payment_claims (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  note text check (char_length(note) <= 300),
  status text not null default 'pendiente' check (status in ('pendiente', 'confirmado', 'rechazado')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists payment_claims_client on public.payment_claims (client_id, created_at desc);
alter table public.payment_claims enable row level security;
drop policy if exists p_claims_coach on public.payment_claims;
create policy p_claims_coach on public.payment_claims for all to authenticated using (public.is_coach()) with check (public.is_coach());
drop policy if exists p_claims_own_read on public.payment_claims;
create policy p_claims_own_read on public.payment_claims for select to authenticated using (client_id = public.my_client_id());
drop policy if exists p_claims_own_insert on public.payment_claims;
create policy p_claims_own_insert on public.payment_claims for insert to authenticated
  with check (client_id = public.my_client_id() and status = 'pendiente' and resolved_at is null);
grant select, insert on public.payment_claims to authenticated;
grant update, delete on public.payment_claims to authenticated;   -- solo el entrenador, por la política

-- Días desde el vencimiento (negativo = aún no ha vencido) y si el cliente puede usar la app
create or replace function public.client_billing(p_client uuid)
returns table (days_over int, grace_left int, blocked boolean, claim_pending boolean)
language sql stable security definer set search_path = public as $$
  select d.over,
         greatest(0, 3 + c.grace_days - d.over),
         not (c.billing_off or not coalesce(c.remind_payment, true) or c.pay_due is null or d.over <= 3 + c.grace_days
              or (c.access_until is not null and c.access_until >= current_date) or cl.pend),
         cl.pend
  from public.clients c
  cross join lateral (select (current_date - c.pay_due)::int as over) d
  cross join lateral (select exists (select 1 from public.payment_claims k where k.client_id = c.id and k.status = 'pendiente'
                                     and k.created_at > now() - interval '48 hours') as pend) cl
  where c.id = p_client and (public.is_coach() or c.id = public.my_client_id());
$$;
grant execute on function public.client_billing(uuid) to authenticated;

create or replace function public.client_access_ok(p_client uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_coach() or coalesce((select not b.blocked from public.client_billing(p_client) b), true);
$$;
grant execute on function public.client_access_ok(uuid) to authenticated;

-- Bloqueo real en el servidor: políticas RESTRICTIVAS (se suman a las que ya hay; el entrenador no se ve afectado)
do $$ declare t text; begin
  foreach t in array array['routines', 'routine_items', 'program_weeks', 'programs', 'calendar_events', 'nutrition_plans', 'meal_blocks'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists p_billing_gate on public.%I', t);
      execute format('create policy p_billing_gate on public.%I as restrictive for select to authenticated using (public.client_access_ok(client_id))', t);
    end if;
  end loop;
end $$;

-- La nutrición del cliente llega por get_my_nutrition() (security definer): se envuelve para aplicar el mismo bloqueo
do $$ begin
  if to_regprocedure('public.get_my_nutrition_base()') is null then
    alter function public.get_my_nutrition() rename to get_my_nutrition_base;
  end if;
end $$;
create or replace function public.get_my_nutrition() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cid uuid := public.my_client_id();
begin
  if cid is not null and not public.client_access_ok(cid) then return jsonb_build_object('blocked', true); end if;
  return public.get_my_nutrition_base();
end $$;
revoke all on function public.get_my_nutrition_base() from public, anon, authenticated;
revoke all on function public.get_my_nutrition() from public, anon;
grant execute on function public.get_my_nutrition() to authenticated;

-- El entrenador ve los avisos de «Ya he pagado» y decide
create or replace function public.resolve_payment_claim(p_claim uuid, p_ok boolean, p_days int default 0)
returns void language plpgsql security definer set search_path = public as $$
declare k public.payment_claims;
begin
  if not public.is_coach() then raise exception 'Solo el entrenador'; end if;
  update public.payment_claims set status = case when p_ok then 'confirmado' else 'rechazado' end, resolved_at = now()
   where id = p_claim returning * into k;
  if p_ok and coalesce(p_days, 0) > 0 then
    update public.clients set access_until = greatest(coalesce(access_until, current_date), current_date + p_days) where id = k.client_id;
  end if;
end $$;
grant execute on function public.resolve_payment_claim(uuid, boolean, int) to authenticated;
