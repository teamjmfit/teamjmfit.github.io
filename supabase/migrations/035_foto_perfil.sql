-- 035: foto de perfil del cliente (pestaña Perfil). Se sube al almacenamiento de fotos de siempre («checkins»),
-- dentro de su carpeta (<id del cliente>/…), y aquí solo se guarda la ruta. El enlace para verla es firmado y caduca.
alter table public.clients add column if not exists avatar_path text check (avatar_path is null or length(avatar_path) <= 300);

create or replace function public.set_my_avatar(p_path text) returns void
language plpgsql security definer set search_path = public as $$
declare cid uuid := public.my_client_id();
begin
  if cid is null then raise exception 'sin cliente'; end if;
  if p_path is not null and p_path not like cid::text || '/%' then raise exception 'ruta no válida'; end if;
  update public.clients set avatar_path = p_path where id = cid;
end $$;
revoke all on function public.set_my_avatar(text) from public, anon;
grant execute on function public.set_my_avatar(text) to authenticated;
