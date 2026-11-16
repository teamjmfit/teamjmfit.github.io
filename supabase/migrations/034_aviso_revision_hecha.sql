-- 034: cuando el entrenador revisa un check-in (lo marca «Revisado» o le responde), aviso al móvil del cliente.
-- La función «avisos» (trabajo «reviewed») comprueba el check-in y no repite el mismo aviso (push_log).
create or replace function public._push_reviewed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.coach_seen is true and old.coach_seen is not true)
     or (new.coach_reply is not null and new.coach_reply <> '' and new.coach_reply is distinct from old.coach_reply) then
    begin
      perform net.http_post(
        url := 'https://ctbliwwthavmamcoekmr.supabase.co/functions/v1/avisos',
        headers := '{"Content-Type":"application/json"}'::jsonb,
        body := jsonb_build_object('job', 'reviewed', 'id', new.id));
    exception when others then null;
    end;
  end if;
  return new;
end $$;
drop trigger if exists t_push_reviewed on public.checkins;
create trigger t_push_reviewed after update of coach_seen, coach_reply on public.checkins
  for each row execute function public._push_reviewed();
