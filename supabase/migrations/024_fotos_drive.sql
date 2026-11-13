-- 024: fotos de check-in archivadas en el Google Drive del entrenador (apps-script/ArchivarFotos.gs).
-- Tras archivarla, la foto se borra de Supabase Storage y la fila guarda el id del archivo de Drive.
alter table public.checkin_photos add column if not exists drive_file_id text;
alter table public.checkin_photos add column if not exists archived_at timestamptz;
create index if not exists checkin_photos_pending on public.checkin_photos (created_at) where archived_at is null;
