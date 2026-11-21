-- 039: «Píldoras y novedades» en el Inicio de los clientes (textos y archivos que publica el entrenador)
-- y «Ventajas» (descuentos de colaboradores, en public_texts.perks).
create table if not exists public.posts (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null default 'pildora' check (kind in ('pildora', 'novedad')),
  title       text not null check (length(title) between 1 and 200),
  body        text check (body is null or length(body) <= 20000),
  tag         text check (tag is null or length(tag) <= 40),
  link        text check (link is null or length(link) <= 1000),
  file_path   text check (file_path is null or length(file_path) <= 300),
  file_name   text check (file_name is null or length(file_name) <= 200),
  file_type   text check (file_type is null or length(file_type) <= 100),
  published   boolean not null default false,
  pinned      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists posts_created on public.posts(created_at desc);
alter table public.posts enable row level security;
drop policy if exists p_posts_read on public.posts;
create policy p_posts_read on public.posts for select to authenticated using (published or public.is_coach());
drop policy if exists p_posts_coach on public.posts;
create policy p_posts_coach on public.posts for all to authenticated using (public.is_coach()) with check (public.is_coach());
grant select, insert, update, delete on public.posts to authenticated;

-- Archivos de las publicaciones (privados: se ven con enlace temporal desde la app)
insert into storage.buckets (id, name, public, file_size_limit) values ('posts', 'posts', false, 20971520)
  on conflict (id) do nothing;
drop policy if exists p_posts_files_read on storage.objects;
create policy p_posts_files_read on storage.objects for select to authenticated using (bucket_id = 'posts');
drop policy if exists p_posts_files_coach on storage.objects;
create policy p_posts_files_coach on storage.objects for all to authenticated
  using (bucket_id = 'posts' and public.is_coach()) with check (bucket_id = 'posts' and public.is_coach());

-- Ventaja por usar la app (se puede cambiar desde la app: Inicio → Publicaciones → Ventajas)
insert into public.public_texts (key, value) values
  ('perks', '[{"title":"10 % en LifePro Güímar","text":"Premio por usar la app de TEAM JMFIT. Di el código al pagar.","code":"Jorgeft"}]')
on conflict (key) do nothing;

-- Primeras píldoras como BORRADOR (no las ve nadie hasta que el entrenador las publique)
insert into public.posts (kind, title, tag, body, published)
select * from (values
  ('pildora', 'Proteína: cuánta necesitas de verdad', 'Nutrición',
   E'Si entrenas fuerza y quieres ganar o mantener músculo, la evidencia apunta a **1,6 g de proteína por kilo de peso al día** como punto a partir del cual casi no se gana más. Hasta 2,2 g/kg es un margen seguro, sobre todo si estás en déficit.\n\nCómo aplicarlo:\n- Reparte la proteína en 3-5 comidas.\n- En cada comida, una buena fuente: carne, pescado, huevos, lácteos, legumbres o tofu.\n- No hace falta batido si llegas con comida; es solo una ayuda.\n\nLa constancia gana: llegar todos los días importa más que el momento exacto.', false),
  ('pildora', 'Dormir también es entrenar', 'Descanso',
   E'Dormir **7-9 horas** es lo recomendado para adultos. Cuando duermes poco sube el hambre, cuesta más controlar la dieta y rindes peor en el gimnasio.\n\nTres claves:\n- Horario parecido todos los días, también el finde.\n- Habitación oscura, fresca y sin pantallas la última media hora.\n- Cafeína, mejor antes de las 15:00.\n\nSi esta semana duermes mejor, verás la diferencia en tus pesos.', false),
  ('pildora', 'Cuántas series por músculo a la semana', 'Entreno',
   E'Para ganar músculo, la mayoría de estudios encuentra buenos resultados con **unas 10-20 series semanales por grupo muscular**, llevadas cerca del fallo (RIR 0-3).\n\nMás no siempre es mejor: si no te recuperas, el volumen extra no suma. Por eso ajustamos tu plan según cómo llegas a cada revisión.\n\nTu parte: apuntar bien pesos, repeticiones y RIR. Con eso afinamos.', false),
  ('pildora', 'Perder grasa sin perder músculo', 'Nutrición',
   E'Un ritmo de **0,5-1 % de tu peso por semana** es el punto dulce para perder grasa manteniendo el músculo y el rendimiento.\n\nIr más rápido suele salir caro: más hambre, peor entreno y más rebote.\n\nPor eso miramos la **media semanal** de tu peso y no el número de un día: el agua, la sal o el estrés lo mueven arriba y abajo. Paciencia y constancia.', false),
  ('pildora', 'Creatina: el suplemento con más evidencia', 'Suplementos',
   E'La **creatina monohidrato** es el suplemento más estudiado para fuerza y masa muscular, y es segura en personas sanas.\n\n- Dosis: 3-5 g al día, todos los días (también los de descanso).\n- No hace falta fase de carga ni tomarla a una hora concreta.\n- Puede subir 1-2 kg el peso al principio: es agua dentro del músculo, no grasa.\n\nSi tienes alguna enfermedad o tomas medicación, consúltalo antes con tu médico.', false)
) v(kind, title, tag, body, published)
where not exists (select 1 from public.posts);
