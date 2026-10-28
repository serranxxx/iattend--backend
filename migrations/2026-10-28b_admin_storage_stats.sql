-- Storage de Supabase para Admin → Analítica → Storage.
-- Correr en el SQL editor de Supabase (o psql con service role).
--
-- Solo LEE storage.objects (no toca archivos ni invitaciones). Devuelve el uso
-- agregado por bucket, carpeta de primer nivel, tipo de archivo y mes de
-- subida; el backend (GET /api/admin/storage) lo cruza con las invitaciones:
--   user_images/{invitation_id}/…          fotos (y video/, audio/ adentro)
--   user_images/inv-{invitation_id}/…      stickers PNG del editor
--   user_images/flash-{side_event_id}/…    Eventos Flash
--   assets/…, editor-assets/…              catálogo de i attend
-- El tamaño sale de metadata->>'size' (bytes).

create or replace function public.admin_storage_stats()
returns table (
  bucket_id text,
  folder    text,
  kind      text,
  month     date,
  files     bigint,
  bytes     bigint
)
language sql
stable
security definer
set search_path = public, storage
as $$
  select
    o.bucket_id,
    split_part(o.name, '/', 1) as folder,
    case
      when o.name ~* '\.(mp4|webm|mov|m4v)$' then 'video'
      when o.name ~* '\.(mp3|wav|m4a|aac|ogg)$' then 'audio'
      when o.name ~* '\.(png|jpe?g|webp|gif|svg|avif|heic)$' then 'image'
      else 'other'
    end as kind,
    date_trunc('month', o.created_at)::date as month,
    count(*) as files,
    coalesce(sum((o.metadata->>'size')::bigint), 0) as bytes
  from storage.objects o
  -- Marcadores de carpeta vacía que crea el dashboard.
  where o.name not like '%.emptyFolderPlaceholder'
  group by 1, 2, 3, 4;
$$;

-- Solo el backend (service role) la llama, detrás de validarAdmin.
revoke all on function public.admin_storage_stats() from public, anon, authenticated;
grant execute on function public.admin_storage_stats() to service_role;
