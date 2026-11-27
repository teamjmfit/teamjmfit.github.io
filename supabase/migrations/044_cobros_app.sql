-- 044: los cobros viven en la app (antes, en el Excel «Gestión de Cobros»).
-- Tarifas oficiales, ficha de cobro de cada cliente (plan, precio pactado, método, alta, pausa…) y registro de pagos.
-- Todo es solo del entrenador. La app calcula vencimientos, estados y resúmenes como hacían las fórmulas del Excel,
-- y copia la próxima renovación en clients.pay_due / pay_plan / pay_amount para los avisos del cliente.

create table if not exists public.tariffs (
  id uuid primary key default gen_random_uuid(),
  plan text not null unique check (length(plan) between 1 and 80),
  service text check (service in ('Entreno', 'Nutrición', 'Mixto')),
  price numeric not null check (price >= 0),
  months int not null default 1 check (months between 1 and 36),
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.billing_clients (
  id uuid primary key default gen_random_uuid(),
  client_id uuid unique references public.clients(id) on delete set null,   -- su cuenta en la app (si la tiene)
  name text not null check (length(name) between 1 and 120),
  plan text check (length(plan) <= 80),               -- plan actual (como en Tarifas)
  paused boolean not null default false,              -- «Inactivo / Pausa»
  price_custom numeric check (price_custom >= 0),     -- precio pactado (vacío = tarifa oficial)
  method text check (length(method) <= 30),
  start_date date,
  split_pending numeric check (split_pending >= 0),   -- pendiente fraccionado
  phone text check (length(phone) <= 30),
  email text check (length(email) <= 160),
  notes text check (length(notes) <= 1000),
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  billing_client_id uuid not null references public.billing_clients(id) on delete cascade,
  paid_on date not null,
  plan text check (length(plan) <= 80),
  service text check (length(service) <= 30),
  amount numeric not null default 0 check (amount >= 0),
  method text check (length(method) <= 30),
  covers_until date,                                  -- vencimiento cubierto (fecha + meses del plan)
  notes text check (length(notes) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists payments_bc on public.payments (billing_client_id, paid_on desc);
create index if not exists payments_day on public.payments (paid_on desc);

alter table public.tariffs enable row level security;
alter table public.billing_clients enable row level security;
alter table public.payments enable row level security;
drop policy if exists p_tariffs_coach on public.tariffs;
create policy p_tariffs_coach on public.tariffs for all to authenticated using (public.is_coach()) with check (public.is_coach());
drop policy if exists p_bclients_coach on public.billing_clients;
create policy p_bclients_coach on public.billing_clients for all to authenticated using (public.is_coach()) with check (public.is_coach());
drop policy if exists p_payments_coach on public.payments;
create policy p_payments_coach on public.payments for all to authenticated using (public.is_coach()) with check (public.is_coach());
