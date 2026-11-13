-- 028: sin bloqueo automático por pago. Desde el vencimiento el cliente solo recibe un aviso diario;
-- el acceso lo corta el entrenador a mano (clients.access_blocked). El análisis semanal es solo del entrenador.

alter table public.clients add column if not exists access_blocked boolean not null default false;

create or replace function public.client_billing(p_client uuid)
returns table (days_over int, grace_left int, blocked boolean, claim_pending boolean)
language sql stable security definer set search_path = public as $$
  select case when c.pay_due is null or c.billing_off or not coalesce(c.remind_payment, true) then null else (current_date - c.pay_due)::int end,
         null::int,
         c.access_blocked,
         exists (select 1 from public.payment_claims k where k.client_id = c.id and k.status = 'pendiente' and k.created_at > now() - interval '48 hours')
  from public.clients c
  where c.id = p_client and (public.is_coach() or c.id = public.my_client_id());
$$;

create or replace function public.client_access_ok(p_client uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_coach() or not coalesce((select c.access_blocked from public.clients c where c.id = p_client), false);
$$;

-- Confirmar un «Ya he pagado» ya no da días de acceso (no hay bloqueo automático): solo lo marca
create or replace function public.resolve_payment_claim(p_claim uuid, p_ok boolean, p_days int default 0)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_coach() then raise exception 'Solo el entrenador'; end if;
  update public.payment_claims set status = case when p_ok then 'confirmado' else 'rechazado' end, resolved_at = now() where id = p_claim;
end $$;

-- El análisis semanal lo ve solo el entrenador (el cliente ve sus mejoras, calculadas en su móvil)
drop policy if exists p_ckan_own on public.checkin_analysis;
