-- =====================================================================
-- 007 · Copia de seguridad automática
-- Una función que devuelve todos los datos de la app y que solo responde a quien
-- tenga la clave de copia (la usa el script de Google que guarda la copia en tu Drive).
-- La clave no se guarda: solo su huella (sha256). Aditiva; se puede ejecutar más de una vez.
-- =====================================================================

create table if not exists public.backup_keys (
  hash bytea primary key,
  created_at timestamptz not null default now()
);
alter table public.backup_keys enable row level security;   -- sin políticas: nadie la lee desde la app
revoke all on public.backup_keys from anon, authenticated;

create or replace function public.backup_dump(p_key text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare t text; v jsonb; out jsonb := jsonb_build_object('generated_at', now());
begin
  if p_key is null or length(p_key) < 40
     or not exists (select 1 from public.backup_keys where hash = sha256(convert_to(p_key, 'UTF8'))) then
    raise exception 'Clave de copia no válida';
  end if;
  foreach t in array array['clients','checkins','checkin_photos','daily_metrics','nutrition_plans','meal_plans',
    'meal_blocks','meal_options','option_items','meal_choices','foods','programs','program_weeks','routines',
    'routine_items','sessions','set_logs','messages','exercises','profiles'] loop
    if to_regclass('public.' || t) is not null then
      execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x', t) into v;
      out := out || jsonb_build_object(t, v);
    end if;
  end loop;
  -- ajustes sin claves ni tokens
  select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) into v from public.settings s where s.key !~* '(token|secret|key|pass)';
  -- la app deja de avisar de «haz copia» porque ya se ha hecho
  insert into public.settings (key, value) values ('last_backup', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
  on conflict (key) do update set value = excluded.value;
  return out || jsonb_build_object('settings', v);
end $$;
revoke execute on function public.backup_dump(text) from public;
grant execute on function public.backup_dump(text) to anon, authenticated;

-- Crea la clave de copia (solo si aún no hay ninguna) y la muestra UNA vez.
do $$
declare k text;
begin
  if not exists (select 1 from public.backup_keys) then
    k := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    insert into public.backup_keys (hash) values (sha256(convert_to(k, 'UTF8')));
    perform set_config('jm.new_backup_key', k, false);
  end if;
end $$;
select coalesce(nullif(current_setting('jm.new_backup_key', true), ''), '(ya existía una clave: no se muestra otra vez)') as clave_copia;
