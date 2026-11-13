-- TEAM JMFIT · 019 · Consentimiento de datos de salud y derechos del cliente (RGPD)
--   - consents: registro (solo se añade) de cada aceptación o retirada, con versión del texto y tutor si es menor.
--   - clients: última versión aceptada, si acepta fotos y solicitudes pendientes (borrado / retirada).
--   - accept_consent / withdraw_consent / request_data_deletion: las llama el propio cliente.
--   - clear_data_request: el entrenador marca la solicitud como atendida.
--   Aditiva: no cambia datos existentes.
begin;

create table if not exists public.consents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid,
  version text not null check (length(version) <= 40),
  action text not null default 'accept' check (action in ('accept', 'withdraw')),
  health boolean not null default false,
  photos boolean not null default false,
  guardian_name text check (length(guardian_name) <= 120),
  guardian_relation text check (length(guardian_relation) <= 40),
  created_at timestamptz not null default now()
);
create index if not exists consents_client on public.consents (client_id, created_at desc);
alter table public.consents enable row level security;
drop policy if exists p_consents_coach on public.consents;
create policy p_consents_coach on public.consents for select using (public.is_coach());
drop policy if exists p_consents_self on public.consents;
create policy p_consents_self on public.consents for select using (client_id = public.my_client_id());
-- sin políticas de escritura: solo se escribe con las funciones de abajo

alter table public.clients add column if not exists consent_version text check (length(consent_version) <= 40);
alter table public.clients add column if not exists consent_at timestamptz;
alter table public.clients add column if not exists consent_photos boolean not null default true;
alter table public.clients add column if not exists data_request text check (data_request in ('delete', 'withdraw'));
alter table public.clients add column if not exists data_request_at timestamptz;

create or replace function public.accept_consent(p_version text, p_photos boolean, p_guardian_name text default null, p_guardian_relation text default null)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare cid uuid := public.my_client_id(); bd date; age int; gn text := nullif(trim(coalesce(p_guardian_name, '')), ''); ts timestamptz := now();
begin
  if cid is null then raise exception 'Tu cuenta no está vinculada a un cliente'; end if;
  if coalesce(trim(p_version), '') = '' then raise exception 'Falta la versión del texto'; end if;
  select birth_date into bd from public.clients where id = cid;
  age := case when bd is null then null else extract(year from age(current_date, bd))::int end;
  if age is not null and age < 14 and gn is null then raise exception 'Hace falta el nombre del padre, madre o tutor legal'; end if;
  insert into public.consents (client_id, user_id, version, action, health, photos, guardian_name, guardian_relation)
    values (cid, auth.uid(), left(p_version, 40), 'accept', true, coalesce(p_photos, false), left(gn, 120), left(nullif(trim(coalesce(p_guardian_relation, '')), ''), 40));
  update public.clients set consent_version = left(p_version, 40), consent_at = ts, consent_photos = coalesce(p_photos, false),
    data_request = case when data_request = 'withdraw' then null else data_request end,
    data_request_at = case when data_request = 'withdraw' then null else data_request_at end
   where id = cid;
  return ts;
end $$;

create or replace function public.withdraw_consent()
returns void language plpgsql security definer set search_path = public as $$
declare cid uuid := public.my_client_id(); v text;
begin
  if cid is null then raise exception 'Tu cuenta no está vinculada a un cliente'; end if;
  select consent_version into v from public.clients where id = cid;
  insert into public.consents (client_id, user_id, version, action) values (cid, auth.uid(), coalesce(v, '-'), 'withdraw');
  update public.clients set consent_version = null, consent_at = null, data_request = 'withdraw', data_request_at = now() where id = cid;
end $$;

create or replace function public.request_data_deletion()
returns void language plpgsql security definer set search_path = public as $$
declare cid uuid := public.my_client_id();
begin
  if cid is null then raise exception 'Tu cuenta no está vinculada a un cliente'; end if;
  update public.clients set data_request = 'delete', data_request_at = now() where id = cid;
end $$;

create or replace function public.clear_data_request(p_client uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_coach() then raise exception 'Solo el entrenador'; end if;
  update public.clients set data_request = null, data_request_at = null where id = p_client;
end $$;

revoke all on function public.accept_consent(text, boolean, text, text) from public, anon;
revoke all on function public.withdraw_consent() from public, anon;
revoke all on function public.request_data_deletion() from public, anon;
revoke all on function public.clear_data_request(uuid) from public, anon;
grant execute on function public.accept_consent(text, boolean, text, text) to authenticated;
grant execute on function public.withdraw_consent() to authenticated;
grant execute on function public.request_data_deletion() to authenticated;
grant execute on function public.clear_data_request(uuid) to authenticated;

commit;
