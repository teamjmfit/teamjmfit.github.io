-- 027: referidos. Cada cliente (también los que ya existen) tiene un código; el amigo deja sus datos en unete.html
-- y Jorge lo sigue en un embudo hasta que es cliente y se aplica el premio. Los premios los escribe Jorge (public_texts).

-- Textos que el entrenador escribe y los clientes (y la página pública) leen
create table if not exists public.public_texts (key text primary key, value text, updated_at timestamptz not null default now());
alter table public.public_texts enable row level security;
drop policy if exists p_ptexts_read on public.public_texts;
create policy p_ptexts_read on public.public_texts for select to authenticated using (true);
drop policy if exists p_ptexts_coach on public.public_texts;
create policy p_ptexts_coach on public.public_texts for all to authenticated using (public.is_coach()) with check (public.is_coach());
grant select, insert, update, delete on public.public_texts to authenticated;
insert into public.public_texts (key, value) values
  ('referral_reward_referrer', 'Un descuento en tu próxima cuota por cada amigo que se una.'),
  ('referral_reward_friend', 'Un regalo de bienvenida al empezar.')
on conflict (key) do nothing;

create table if not exists public.referral_codes (
  client_id uuid primary key references public.clients(id) on delete cascade,
  code text not null unique check (code ~ '^[A-Z0-9-]{4,20}$'),
  created_at timestamptz not null default now()
);
alter table public.referral_codes enable row level security;
drop policy if exists p_refcode_coach on public.referral_codes;
create policy p_refcode_coach on public.referral_codes for all to authenticated using (public.is_coach()) with check (public.is_coach());
drop policy if exists p_refcode_own on public.referral_codes;
create policy p_refcode_own on public.referral_codes for select to authenticated using (client_id = public.my_client_id());
grant select on public.referral_codes to authenticated;
grant insert, update, delete on public.referral_codes to authenticated;   -- solo el entrenador, por la política

-- Código: nombre sin tildes (máx. 8 letras) + guion + 3 caracteres, único
create or replace function public._new_ref_code(p_name text) returns text
language plpgsql volatile set search_path = public as $$
declare base text; c text; i int := 0;
begin
  base := upper(regexp_replace(translate(split_part(coalesce(trim(p_name), 'AMIGO'), ' ', 1), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN'), '[^A-Za-z0-9]', '', 'g'));
  base := left(nullif(base, ''), 8); base := coalesce(base, 'AMIGO');
  loop
    c := base || '-' || substr(translate(upper(md5(random()::text || clock_timestamp()::text)), '01', ''), 1, 3);
    exit when length(c) >= length(base) + 4 and not exists (select 1 from public.referral_codes where code = c);
    i := i + 1; if i > 20 then c := base || '-' || upper(substr(md5(random()::text), 1, 4)); exit; end if;
  end loop;
  return c;
end $$;
create or replace function public._client_ref_code() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(new.is_template, false) then
    insert into public.referral_codes (client_id, code) values (new.id, public._new_ref_code(new.name)) on conflict (client_id) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists clients_ref_code on public.clients;
create trigger clients_ref_code after insert on public.clients for each row execute function public._client_ref_code();
-- los clientes que ya existen
insert into public.referral_codes (client_id, code)
select c.id, public._new_ref_code(c.name) from public.clients c
 where not coalesce(c.is_template, false) and not exists (select 1 from public.referral_codes r where r.client_id = c.id);

alter table public.clients add column if not exists referred_by uuid references public.clients(id) on delete set null;

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_client_id uuid references public.clients(id) on delete set null,
  code text,
  name text not null check (char_length(name) between 2 and 80),
  contact text not null check (char_length(contact) between 5 and 120),
  goal text check (char_length(goal) <= 80),
  consent boolean not null,
  status text not null default 'nuevo' check (status in ('nuevo', 'contactado', 'prueba', 'cliente', 'perdido')),
  reward_status text check (reward_status in ('pendiente', 'aplicado')),
  converted_client_id uuid references public.clients(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists referrals_referrer on public.referrals (referrer_client_id, created_at desc);
alter table public.referrals enable row level security;
drop policy if exists p_ref_coach on public.referrals;
create policy p_ref_coach on public.referrals for all to authenticated using (public.is_coach()) with check (public.is_coach());
grant select, insert, update, delete on public.referrals to authenticated;   -- solo el entrenador, por la política
revoke all on public.referrals from anon;

-- Al pasar a «cliente», queda un premio pendiente para quien lo trajo
create or replace function public._referral_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.status = 'cliente' and coalesce(old.status, '') <> 'cliente' and new.reward_status is null and new.referrer_client_id is not null then
    new.reward_status := 'pendiente';
  end if;
  return new;
end $$;
drop trigger if exists referrals_touch on public.referrals;
create trigger referrals_touch before update on public.referrals for each row execute function public._referral_touch();

-- Página pública: nombre de pila de quien invita y el premio del amigo (sin ningún otro dato)
create or replace function public.referral_public(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', split_part(c.name, ' ', 1),
                            'reward', (select value from public.public_texts where key = 'referral_reward_friend'))
  from public.referral_codes r join public.clients c on c.id = r.client_id
  where r.code = upper(trim(p_code)) and c.active is not false;
$$;

-- Alta desde la página pública. Con límites para frenar abusos; los datos que no acaban en cliente se borran a los 6 meses.
create or replace function public.submit_referral(p_code text, p_name text, p_contact text, p_goal text, p_consent boolean, p_hp text default null)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare rc public.referral_codes; n int;
begin
  if coalesce(p_hp, '') <> '' then return true; end if;                    -- campo trampa para bots
  if not coalesce(p_consent, false) then raise exception 'Hace falta aceptar la privacidad'; end if;
  if char_length(trim(coalesce(p_name, ''))) < 2 or char_length(trim(coalesce(p_contact, ''))) < 5 then raise exception 'Faltan datos'; end if;
  select * into rc from public.referral_codes where code = upper(trim(coalesce(p_code, '')));
  select count(*) into n from public.referrals where created_at > now() - interval '1 day' and (code is not distinct from rc.code or lower(contact) = lower(trim(p_contact)));
  if n >= 10 then raise exception 'Demasiadas solicitudes, inténtalo mañana'; end if;
  delete from public.referrals where status <> 'cliente' and created_at < now() - interval '6 months';
  insert into public.referrals (referrer_client_id, code, name, contact, goal, consent)
  values (rc.client_id, rc.code, left(trim(p_name), 80), left(trim(p_contact), 120), left(nullif(trim(coalesce(p_goal, '')), ''), 80), true);
  return true;
end $$;

-- El cliente ve sus referidos: solo nombre de pila, estado y premio
create or replace function public.my_referrals() returns table (first_name text, status text, reward_status text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select split_part(r.name, ' ', 1), r.status, r.reward_status, r.created_at
  from public.referrals r where r.referrer_client_id = public.my_client_id() order by r.created_at desc;
$$;

revoke all on function public.referral_public(text), public.submit_referral(text, text, text, text, boolean, text) from public;
grant execute on function public.referral_public(text), public.submit_referral(text, text, text, text, boolean, text) to anon, authenticated;
revoke all on function public.my_referrals() from public, anon;
grant execute on function public.my_referrals() to authenticated;
revoke all on function public._new_ref_code(text) from public, anon, authenticated;
