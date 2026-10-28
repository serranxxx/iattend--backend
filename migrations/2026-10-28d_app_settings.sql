-- Ajustes generales de la app que se prenden / apagan desde el admin.
-- Correr en el SQL editor de Supabase (o psql con service role).
--
-- Una fila por ajuste: `key` → `value` (jsonb). Primer ajuste:
--   editor_design_styles = { "enabled": false }
--     Bloque "Estilos completos" del panel Diseño del editor
--     (iattend-vite DesignPanel). Apagado por ahora; más adelante los
--     diseños se van a subir desde el admin.
--
-- Lectura: anon (el editor la lee directo, como `textures`). Escritura: solo
-- service role, detrás de validarAdmin en /api/admin/settings/:key.

create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

alter table public.app_settings enable row level security;

drop policy if exists app_settings_lectura_publica on public.app_settings;
create policy app_settings_lectura_publica
  on public.app_settings for select to anon, authenticated
  using (true);

-- GRANT antes que las policies (si no, 42501 con la anon key).
grant select on public.app_settings to anon, authenticated;

insert into public.app_settings (key, value)
values ('editor_design_styles', '{"enabled": false}'::jsonb)
on conflict (key) do nothing;
