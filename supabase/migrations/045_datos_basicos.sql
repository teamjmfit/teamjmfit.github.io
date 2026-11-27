-- 045: el cliente puede rellenar sus datos básicos (fecha de nacimiento, sexo y altura) desde su perfil
-- o al entrar en la app. El peso va a sus métricas diarias (eso ya lo podía apuntar). Lo ve el entrenador en su ficha.
create or replace function public.set_my_basics(p_birth date, p_sex text, p_height numeric) returns void
language plpgsql security definer set search_path = public as $$
declare cid uuid := public.my_client_id();
begin
  if cid is null then raise exception 'Tu cuenta no está vinculada a un cliente'; end if;
  if p_sex is not null and p_sex not in ('male', 'female', 'other') then raise exception 'Sexo no válido'; end if;
  if p_height is not null and (p_height < 100 or p_height > 250) then raise exception 'La altura va en centímetros (entre 100 y 250)'; end if;
  if p_birth is not null and (p_birth < date '1920-01-01' or p_birth > current_date - interval '8 years') then raise exception 'Revisa la fecha de nacimiento'; end if;
  update public.clients set birth_date = coalesce(p_birth, birth_date), sex = coalesce(p_sex, sex), height_cm = coalesce(p_height, height_cm) where id = cid;
end $$;
revoke all on function public.set_my_basics(date, text, numeric) from public, anon;
grant execute on function public.set_my_basics(date, text, numeric) to authenticated;
