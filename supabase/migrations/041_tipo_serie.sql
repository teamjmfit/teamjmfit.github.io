-- 041: tipo de serie guardado en cada serie hecha (cluster, isométrico en segundos, AMRAP).
-- Las series de aproximación no se guardan. Sin esta columna la app guarda las series igual (sin el tipo).
alter table public.set_logs add column if not exists kind text;
alter table public.set_logs drop constraint if exists set_logs_kind_ok;
alter table public.set_logs add constraint set_logs_kind_ok check (kind is null or kind in ('cluster', 'iso', 'amrap'));
