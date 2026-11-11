-- Archivos de un Pop (bucket user_images, carpeta `flash-<side_event_id>/…`):
-- solo quien gestiona ese Pop sube, reemplaza o borra.
--
-- Va aparte de 2026-11-11_side_events_rls.sql porque toca storage.objects
-- (si el rol del SQL editor no puede crear políticas ahí, lo demás ya quedó).
-- Necesita public.puede_gestionar_side_event de esa migración.
--
-- Con la anon key se puede listar el bucket (es público: las URLs ya lo son);
-- no se pudo ver sin acceso a la base si cualquier cuenta puede escribir en
-- carpetas ajenas. ANTES DE CORRER:
--   select policyname, permissive, roles, cmd, qual, with_check
--     from pg_policies where schemaname = 'storage' and tablename = 'objects';
--
-- Son RESTRICTIVAS y solo miran `flash-<número>/…` de user_images: no cambian
-- nada de las demás carpetas (invitaciones por uuid, inv-<uuid>, Textures,
-- GiftBrands, Onboarding…) ni de los otros buckets, y se suman (AND) a las
-- políticas que ya existen. Leer no se restringe (bucket público).
-- El backend usa la service role y no le afecta.

begin;

create or replace function public.puede_carpeta_pop(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when split_part(p_name, '/', 1) ~ '^flash-[0-9]+$'
      then public.puede_gestionar_side_event(substring(split_part(p_name, '/', 1) from 7)::bigint)
    else true
  end;
$$;

revoke all on function public.puede_carpeta_pop(text) from public;
grant execute on function public.puede_carpeta_pop(text) to anon, authenticated;

drop policy if exists user_images_pop_insert on storage.objects;
drop policy if exists user_images_pop_update on storage.objects;
drop policy if exists user_images_pop_delete on storage.objects;

create policy user_images_pop_insert on storage.objects
  as restrictive for insert to public
  with check (bucket_id <> 'user_images' or public.puede_carpeta_pop(name));

create policy user_images_pop_update on storage.objects
  as restrictive for update to public
  using (bucket_id <> 'user_images' or public.puede_carpeta_pop(name))
  with check (bucket_id <> 'user_images' or public.puede_carpeta_pop(name));

create policy user_images_pop_delete on storage.objects
  as restrictive for delete to public
  using (bucket_id <> 'user_images' or public.puede_carpeta_pop(name));

commit;
