-- Pop en línea (handoff "Pop · Evento en línea"): enlace de Zoom / Meet /
-- YouTube y material que solo ven los confirmados.
-- Correr en el SQL editor de Supabase.
--
-- 1. side_events.acceso: lo privado del modo en línea —
--    { url, meetingId, passcode, onlyConfirmed, material: [...] }—.
--    Va en su propia columna y NO en body, porque la página del invitado
--    recibe el body completo (RPC side_event_publico) antes de confirmar.
--    side_event_publico devuelve columnas fijas, así que esta no sale.
--    La lee y la escribe el organizador con su sesión (RLS de side_events,
--    2026-11-11_side_events_rls.sql); el invitado la pide al backend
--    (GET /api/side-events/:clave/acceso).
alter table public.side_events
  add column if not exists acceso jsonb;

-- Las columnas que authenticated puede escribir son por columna (ver la
-- migración de RLS): se agrega esta.
grant update (acceso) on public.side_events to authenticated;

-- 2. Material: bucket PRIVADO pop-material (flash-<id>/…). Sin policies para
--    anon ni authenticated: el backend firma la subida (createSignedUploadUrl)
--    después de revisar dueño y espacio, y entrega links firmados para
--    descargar solo a quien puede ver el acceso.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pop-material', 'pop-material', false, 20971520,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-powerpoint',
    'image/png', 'image/jpeg', 'image/webp'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 3. El material cuenta para el espacio de Subidos del Pop (10/20/30 MB).
create or replace function public.pop_storage_usage(p_side_event_id bigint)
returns bigint
language sql
stable
security definer
set search_path = public, storage
as $$
  select coalesce(sum((o.metadata->>'size')::bigint), 0)
  from storage.objects o
  where (
      o.bucket_id = 'user_images'
      and o.name like 'flash-' || p_side_event_id::text || '/%'
      and o.name not like 'flash-' || p_side_event_id::text || '/audio/%'
    ) or (
      o.bucket_id = 'pop-material'
      and o.name like 'flash-' || p_side_event_id::text || '/%'
    );
$$;

grant execute on function public.pop_storage_usage(bigint) to anon, authenticated;

notify pgrst, 'reload schema';
