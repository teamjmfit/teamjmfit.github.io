-- 033: pantalla de bienvenida para clientes nuevos. Sale solo mientras clients.onboarded_at está vacío.
-- Los clientes que ya existen se marcan como vistos (no les sale); los nuevos la ven al entrar por primera vez.
alter table public.clients add column if not exists onboarded_at timestamptz;
update public.clients set onboarded_at = coalesce(consent_at, created_at, now()) where onboarded_at is null;

-- El cliente la marca como vista al pulsar «Empezar mi cambio»
create or replace function public.mark_onboarded() returns void
language sql security definer set search_path = public as $$
  update public.clients set onboarded_at = now() where id = public.my_client_id() and onboarded_at is null;
$$;
revoke all on function public.mark_onboarded() from public, anon;
grant execute on function public.mark_onboarded() to authenticated;
