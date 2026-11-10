-- =====================================================================
--  TEAM JMFIT · Base de datos (Supabase)
--  Pega TODO este archivo en Supabase → SQL Editor → New query → Run.
--  Antes de ejecutarlo, cambia el correo de la línea marcada con >>>
--  por el correo con el que TÚ (el entrenador) vas a entrar en la app.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Tablas ----------------------------------------------------

create table if not exists public.coach_emails (
  email text primary key
);

-- >>> CAMBIA ESTE CORREO POR EL TUYO (puedes añadir más entrenadores):
insert into public.coach_emails(email) values ('CAMBIA_ESTO@tuemail.com')
  on conflict do nothing;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text,
  role text not null default 'client' check (role in ('coach','client')),
  created_at timestamptz not null default now()
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  name text not null,
  email text not null unique,
  phone text,
  goal text,
  service text,
  sheet_name text,                            -- nombre tal y como aparece en tu hoja de cobros
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.exercises (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  muscle text,
  equipment text,
  media_url text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.routines (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  day int check (day between 1 and 7),       -- 1 = lunes … 7 = domingo, null = libre
  position int not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.routine_items (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null references public.routines(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  exercise_id uuid references public.exercises(id) on delete set null,
  exercise_name text not null,
  media_url text,
  position int not null default 0,
  sets int not null default 3,
  reps text not null default '10',
  load text,
  rest_sec int not null default 90,
  notes text
);

create table if not exists public.nutrition_plans (
  client_id uuid primary key references public.clients(id) on delete cascade,
  kcal int, protein int, carbs int, fat int, water text,
  meals text,
  notes text,
  updated_at timestamptz not null default now()
);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  routine_id uuid references public.routines(id) on delete set null,
  routine_name text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  rpe int,
  notes text,
  volume numeric default 0,
  coach_seen boolean not null default false
);

create table if not exists public.set_logs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  exercise_name text not null,
  set_no int not null,
  weight numeric,
  reps int,
  created_at timestamptz not null default now()
);

create table if not exists public.checkins (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  date date not null default current_date,
  weight numeric, waist numeric, hip numeric, chest numeric, arm numeric, thigh numeric,
  energy int, sleep int, adherence int,
  notes text,
  photo_path text,
  coach_reply text,
  coach_seen boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  author text not null check (author in ('coach','client')),
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.settings (
  key text primary key,
  value text
);

create index if not exists routines_client on public.routines(client_id);
create index if not exists items_routine on public.routine_items(routine_id);
create index if not exists sessions_client on public.sessions(client_id, started_at desc);
create index if not exists setlogs_session on public.set_logs(session_id);
create index if not exists setlogs_client on public.set_logs(client_id, exercise_name);
create index if not exists checkins_client on public.checkins(client_id, date desc);
create index if not exists messages_client on public.messages(client_id, created_at);

-- ---------- Funciones de apoyo ----------------------------------------

create or replace function public.is_coach() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'coach');
$$;

create or replace function public.my_client_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.clients where user_id = auth.uid() limit 1;
$$;

-- Al registrarse alguien: crea su perfil y lo enlaza con su ficha de cliente
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, email, name, role)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    case when exists (select 1 from public.coach_emails c where lower(c.email) = lower(new.email))
         then 'coach' else 'client' end
  )
  on conflict (id) do nothing;
  update public.clients set user_id = new.id
   where lower(email) = lower(new.email) and user_id is null;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Si das de alta al cliente DESPUÉS de que se registre, se enlaza igual
create or replace function public.link_client_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.email := lower(trim(new.email));
  if new.user_id is null then
    select id into new.user_id from public.profiles where lower(email) = new.email limit 1;
  end if;
  return new;
end $$;

drop trigger if exists clients_link_user on public.clients;
create trigger clients_link_user before insert or update of email on public.clients
  for each row execute function public.link_client_user();

-- ---------- Seguridad (cada cliente solo ve lo suyo) -------------------

alter table public.coach_emails   enable row level security;
alter table public.profiles       enable row level security;
alter table public.clients        enable row level security;
alter table public.exercises      enable row level security;
alter table public.routines       enable row level security;
alter table public.routine_items  enable row level security;
alter table public.nutrition_plans enable row level security;
alter table public.sessions       enable row level security;
alter table public.set_logs       enable row level security;
alter table public.checkins       enable row level security;
alter table public.messages       enable row level security;
alter table public.settings       enable row level security;

-- profiles
drop policy if exists p_profiles_read on public.profiles;
create policy p_profiles_read on public.profiles for select
  using (id = auth.uid() or public.is_coach());
drop policy if exists p_profiles_update on public.profiles;
create policy p_profiles_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid() and role = (select role from public.profiles where id = auth.uid()));

-- clients
drop policy if exists p_clients_coach on public.clients;
create policy p_clients_coach on public.clients for all
  using (public.is_coach()) with check (public.is_coach());
drop policy if exists p_clients_self on public.clients;
create policy p_clients_self on public.clients for select
  using (user_id = auth.uid());

-- exercises: todos los usuarios con sesión leen, solo el entrenador edita
drop policy if exists p_ex_read on public.exercises;
create policy p_ex_read on public.exercises for select using (auth.uid() is not null);
drop policy if exists p_ex_coach on public.exercises;
create policy p_ex_coach on public.exercises for all
  using (public.is_coach()) with check (public.is_coach());

-- Plantilla para tablas con client_id: entrenador todo, cliente lo suyo
do $$
declare t text;
begin
  -- solo lectura para el cliente
  foreach t in array array['routines','routine_items','nutrition_plans'] loop
    execute format('drop policy if exists p_%1$s_coach on public.%1$s', t);
    execute format('create policy p_%1$s_coach on public.%1$s for all using (public.is_coach()) with check (public.is_coach())', t);
    execute format('drop policy if exists p_%1$s_self on public.%1$s', t);
    execute format('create policy p_%1$s_self on public.%1$s for select using (client_id = public.my_client_id())', t);
  end loop;
  -- lectura y escritura para el cliente
  foreach t in array array['sessions','set_logs','checkins'] loop
    execute format('drop policy if exists p_%1$s_coach on public.%1$s', t);
    execute format('create policy p_%1$s_coach on public.%1$s for all using (public.is_coach()) with check (public.is_coach())', t);
    execute format('drop policy if exists p_%1$s_self on public.%1$s', t);
    execute format('create policy p_%1$s_self on public.%1$s for all using (client_id = public.my_client_id()) with check (client_id = public.my_client_id())', t);
  end loop;
end $$;

-- messages: el cliente lee los suyos y solo escribe como cliente
drop policy if exists p_msg_coach on public.messages;
create policy p_msg_coach on public.messages for all
  using (public.is_coach()) with check (public.is_coach());
drop policy if exists p_msg_self_read on public.messages;
create policy p_msg_self_read on public.messages for select
  using (client_id = public.my_client_id());
drop policy if exists p_msg_self_write on public.messages;
create policy p_msg_self_write on public.messages for insert
  with check (client_id = public.my_client_id() and author = 'client');

-- settings y coach_emails: solo el entrenador
drop policy if exists p_settings_coach on public.settings;
create policy p_settings_coach on public.settings for all
  using (public.is_coach()) with check (public.is_coach());
drop policy if exists p_coach_emails on public.coach_emails;
create policy p_coach_emails on public.coach_emails for select using (public.is_coach());

-- ---------- Fotos de progreso (Storage) --------------------------------

insert into storage.buckets (id, name, public) values ('checkins', 'checkins', false)
  on conflict (id) do nothing;

drop policy if exists p_photos_coach on storage.objects;
create policy p_photos_coach on storage.objects for all
  using (bucket_id = 'checkins' and public.is_coach())
  with check (bucket_id = 'checkins' and public.is_coach());
drop policy if exists p_photos_self on storage.objects;
create policy p_photos_self on storage.objects for all
  using (bucket_id = 'checkins' and (storage.foldername(name))[1] = public.my_client_id()::text)
  with check (bucket_id = 'checkins' and (storage.foldername(name))[1] = public.my_client_id()::text);

-- ---------- Catálogo inicial de ejercicios ------------------------------

insert into public.exercises (name, muscle, equipment)
select * from (values
  ('Sentadilla trasera','Piernas','Barra'),
  ('Sentadilla goblet','Piernas','Mancuerna'),
  ('Prensa de piernas','Piernas','Máquina'),
  ('Zancadas','Piernas','Mancuernas'),
  ('Sentadilla búlgara','Piernas','Mancuernas'),
  ('Extensión de cuádriceps','Piernas','Máquina'),
  ('Curl femoral tumbado','Piernas','Máquina'),
  ('Peso muerto rumano','Isquios / Glúteo','Barra'),
  ('Peso muerto convencional','Espalda / Piernas','Barra'),
  ('Hip thrust','Glúteo','Barra'),
  ('Patada de glúteo en polea','Glúteo','Polea'),
  ('Abducción de cadera','Glúteo','Máquina'),
  ('Elevación de gemelos de pie','Gemelos','Máquina'),
  ('Press de banca','Pecho','Barra'),
  ('Press inclinado con mancuernas','Pecho','Mancuernas'),
  ('Aperturas en polea','Pecho','Polea'),
  ('Fondos en paralelas','Pecho / Tríceps','Peso corporal'),
  ('Flexiones','Pecho','Peso corporal'),
  ('Dominadas','Espalda','Peso corporal'),
  ('Jalón al pecho','Espalda','Polea'),
  ('Remo con barra','Espalda','Barra'),
  ('Remo con mancuerna','Espalda','Mancuerna'),
  ('Remo en polea baja','Espalda','Polea'),
  ('Pullover en polea','Espalda','Polea'),
  ('Press militar','Hombro','Barra'),
  ('Press de hombro con mancuernas','Hombro','Mancuernas'),
  ('Elevaciones laterales','Hombro','Mancuernas'),
  ('Face pull','Hombro posterior','Polea'),
  ('Pájaros','Hombro posterior','Mancuernas'),
  ('Curl de bíceps con barra','Bíceps','Barra'),
  ('Curl martillo','Bíceps','Mancuernas'),
  ('Curl en banco inclinado','Bíceps','Mancuernas'),
  ('Extensión de tríceps en polea','Tríceps','Polea'),
  ('Press francés','Tríceps','Barra Z'),
  ('Plancha','Core','Peso corporal'),
  ('Rueda abdominal','Core','Rueda'),
  ('Elevación de piernas colgado','Core','Peso corporal'),
  ('Pallof press','Core','Polea'),
  ('Cinta (caminar inclinado)','Cardio','Cinta'),
  ('Bicicleta estática','Cardio','Bicicleta')
) as v(name, muscle, equipment)
where not exists (select 1 from public.exercises);

-- ---------- Refuerzo de seguridad (aplicado el 10/11/2026) -------------
-- Solo pueden registrarse los correos dados de alta por el entrenador
create or replace function public.guard_signup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.coach_emails where lower(email) = lower(new.email))
     and not exists (select 1 from public.clients where lower(email) = lower(new.email) and active) then
    raise exception 'JMFIT_NOT_INVITED';
  end if;
  return new;
end $$;
drop trigger if exists guard_signup on auth.users;
create trigger guard_signup before insert on auth.users
  for each row execute function public.guard_signup();
-- Cliente en pausa = sin acceso
create or replace function public.my_client_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.clients where user_id = auth.uid() and active limit 1;
$$;
drop policy if exists p_clients_self on public.clients;
create policy p_clients_self on public.clients for select using (user_id = auth.uid() and active);
-- Sin sesión no se puede leer ni escribir nada
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
revoke execute on all functions in schema public from anon;


-- ---------- Enlaces de invitación (aplicado en producción el 10/11/2026) ----
create table if not exists public.invites (
  code       text primary key default ('jm-' || substr(md5(random()::text || clock_timestamp()::text), 1, 12)),
  label      text,
  max_uses   integer,
  uses       integer not null default 0,
  expires_at timestamptz,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.invites enable row level security;
drop policy if exists p_invites_coach on public.invites;
create policy p_invites_coach on public.invites for all using (public.is_coach()) with check (public.is_coach());

create or replace function public.invite_ok(c text) returns boolean
language sql stable security definer set search_path = public as $$
  select c is not null and exists (select 1 from public.invites i where i.code = c and i.active
    and (i.expires_at is null or i.expires_at > now()) and (i.max_uses is null or i.uses < i.max_uses));
$$;

-- Registro permitido solo a: entrenador, cliente activo ya dado de alta, o código de invitación válido
create or replace function public.guard_signup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.coach_emails where lower(email) = lower(new.email)) then return new; end if;
  if exists (select 1 from public.clients where lower(email) = lower(new.email)) then
    if exists (select 1 from public.clients where lower(email) = lower(new.email) and active) then return new; end if;
    raise exception 'JMFIT_PAUSED';
  end if;
  if public.invite_ok(new.raw_user_meta_data->>'invite') then return new; end if;
  raise exception 'JMFIT_NOT_INVITED';
end $$;

-- Crea el perfil y, si viene con invitación, la ficha de cliente (y suma un uso al enlace)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  inv text := new.raw_user_meta_data->>'invite';
  nm  text := coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), split_part(new.email, '@', 1));
  is_coach boolean := exists (select 1 from public.coach_emails c where lower(c.email) = lower(new.email));
begin
  insert into public.profiles(id, email, name, role)
  values (new.id, new.email, nm, case when is_coach then 'coach' else 'client' end)
  on conflict (id) do nothing;
  update public.clients set user_id = new.id where lower(email) = lower(new.email) and user_id is null;
  if not is_coach and not exists (select 1 from public.clients where lower(email) = lower(new.email))
     and public.invite_ok(inv) then
    insert into public.clients(user_id, name, email, notes, active)
    values (new.id, nm, lower(new.email), 'Alta por enlace de invitación (' || inv || ') el ' || to_char(now(), 'DD/MM/YYYY') || '.', true);
    update public.invites set uses = uses + 1 where code = inv;
  end if;
  return new;
end $$;

-- ---------- Métricas diarias (peso, pasos, sueño) ---------------------------
create table if not exists public.daily_metrics (
  client_id  uuid not null references public.clients(id) on delete cascade,
  date       date not null default current_date,
  weight     numeric,
  steps      integer,
  sleep_h    numeric,
  created_at timestamptz not null default now(),
  primary key (client_id, date)
);
alter table public.daily_metrics enable row level security;
drop policy if exists p_dm_coach on public.daily_metrics;
create policy p_dm_coach on public.daily_metrics for all using (public.is_coach()) with check (public.is_coach());
drop policy if exists p_dm_self on public.daily_metrics;
create policy p_dm_self on public.daily_metrics for all using (client_id = public.my_client_id()) with check (client_id = public.my_client_id());

revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon;
