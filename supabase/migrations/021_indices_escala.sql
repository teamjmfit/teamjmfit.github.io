-- 021: índices que faltaban para las lecturas por fecha del semáforo de clientes (la 018 ya cubre series y entrenos).
-- Solo crea índices: no cambia datos ni permisos.
create index if not exists daily_metrics_date on public.daily_metrics (date desc);
create index if not exists pweeks_start on public.program_weeks (start_date desc);
create index if not exists wfb_created on public.workout_feedback (created_at desc);
analyze public.set_logs; analyze public.sessions; analyze public.daily_metrics;
