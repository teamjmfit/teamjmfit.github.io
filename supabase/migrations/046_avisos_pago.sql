-- 046: avisos de renovación del plan. La función «avisos» manda una notificación al móvil del cliente
-- 2 días antes, el día antes, el mismo día y, si vence, cada día (hasta 30 días). Queda apuntado cada aviso
-- (notificación, visto en la app o WhatsApp que manda el entrenador) para que el entrenador lo vea en Cobros.
create table if not exists public.pay_notices (
  id uuid primary key default gen_random_uuid(),
  billing_client_id uuid not null references public.billing_clients(id) on delete cascade,
  day date not null,
  channel text not null check (channel in ('push', 'app', 'whatsapp')),
  kind text check (length(kind) <= 40),
  created_at timestamptz not null default now(),
  unique (billing_client_id, day, channel)
);
create index if not exists pay_notices_bc on public.pay_notices (billing_client_id, day desc);
alter table public.pay_notices enable row level security;
drop policy if exists p_pay_notices_coach on public.pay_notices;
create policy p_pay_notices_coach on public.pay_notices for all to authenticated using (public.is_coach()) with check (public.is_coach());

-- El cliente apunta que ha visto el aviso en su app (una vez al día)
create or replace function public.log_pay_notice(p_kind text) returns void
language plpgsql security definer set search_path = public as $$
declare cid uuid := public.my_client_id(); bc uuid;
begin
  if cid is null then return; end if;
  select id into bc from public.billing_clients where client_id = cid limit 1;
  if bc is null then return; end if;
  insert into public.pay_notices (billing_client_id, day, channel, kind)
    values (bc, (now() at time zone 'Atlantic/Canary')::date, 'app', left(p_kind, 40))
    on conflict (billing_client_id, day, channel) do nothing;
end $$;
revoke all on function public.log_pay_notice(text) from public, anon;
grant execute on function public.log_pay_notice(text) to authenticated;
