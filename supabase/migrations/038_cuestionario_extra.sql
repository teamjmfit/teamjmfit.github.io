-- 038: preguntas añadidas por el entrenador al cuestionario semanal (Revisiones → Cuestionario semanal).
-- Las respuestas se guardan junto con el texto de la pregunta: [{ id, label, type, value }].
-- El cuestionario en sí (textos, preguntas ocultas y añadidas) se guarda en public_texts.checkin_form (ya existe).
alter table public.checkins add column if not exists extra jsonb;
alter table public.checkins drop constraint if exists checkins_extra_ok;
alter table public.checkins add constraint checkins_extra_ok
  check (extra is null or (jsonb_typeof(extra) = 'array' and jsonb_array_length(extra) <= 40 and pg_column_size(extra) <= 20000));
