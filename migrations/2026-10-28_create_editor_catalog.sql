-- Catálogo del panel lateral del editor (iattend-vite, /dashboard/build):
-- categorías y recursos de los paneles Elementos y Fotos.
-- Correr en el SQL editor de Supabase (o psql con service role).
--
-- Reemplaza fuentes que vivían en código o en carpetas sueltas:
--   1. LAYER_ICONS (16 íconos de lucide) en iattend-vite layerItems.js y en
--      iattend-events SectionLayer.tsx.
--   2. imagesItinerary (/assets/itinerary/*.png) en iattend-vite menuImages.js.
--   3. Las "Ideas" de StorageImages: carpetas Covers / Quote / Dresscode del
--      bucket `assets`, sin orden ni nombres.
--
-- NADA DE ESTO TOCA LAS INVITACIONES. invitations.data no se lee ni se
-- escribe aquí. Al soltar un recurso, la invitación guarda una COPIA (la URL
-- del archivo en decorations[sección], igual que hoy los stickers), no el id
-- del catálogo: ocultar o borrar algo del catálogo no cambia ninguna
-- invitación. Los archivos que ya existen (`assets`, /assets/itinerary/) no se
-- mueven ni se borran: la semilla solo apunta a sus URLs actuales.
--
-- Lectura: anon, solo lo visible (el editor lo lee directo con la anon key,
-- como `textures` y `gift_brands`). Escritura: solo service role, detrás de
-- validarAdmin en /api/admin/editor-catalog.

-- --------------------------------------------------------------- categorías ---

create table if not exists public.editor_categories (
  id           uuid primary key default gen_random_uuid(),
  -- Panel del riel donde sale: Elementos (recursos para arrastrar) o Fotos
  -- (ideas por sección).
  panel        text not null check (panel in ('elements', 'photos')),
  -- Subgrupo (Fotos: Dresscode → Black Tie / Cocktail / Formal). Null = raíz.
  parent_id    uuid references public.editor_categories(id) on delete cascade,
  slug         text not null,
  name_es      text not null,
  name_en      text,
  -- Cómo se dibuja y se inserta: icon = SVG pintable (grid de 5),
  -- shape = forma paramétrica en código (grid de 5), image = PNG / foto
  -- (grid de 3).
  kind         text not null check (kind in ('icon', 'shape', 'image')),
  -- Fotos: sección de la invitación que la preselecciona (cover, quote,
  -- dresscode…). Null = no se preselecciona.
  section_key  text,
  -- Badge "Nuevo" hasta esta fecha; null = sin badge.
  new_until    timestamptz,
  sort_order   smallint not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  unique (panel, slug)
);

create index if not exists editor_categories_activas_idx
  on public.editor_categories (panel, sort_order)
  where is_active;

-- ------------------------------------------------------------------ recursos ---

create table if not exists public.editor_assets (
  id           uuid primary key default gen_random_uuid(),
  category_id  uuid not null references public.editor_categories(id) on delete cascade,
  name         text not null,
  -- Palabras para el buscador ("flores, copas, iglesia…"), en minúsculas.
  tags         text[] not null default '{}',
  -- Archivo: bucket `editor-assets`, o una URL que ya existía (bucket
  -- `assets`, /assets/itinerary/… servido por iattend-events). Para
  -- kind = 'shape' va vacío y `variant` dice la forma.
  url          text,
  variant      text,
  -- SVG de un solo color: la pieza lo pinta con el color elegido (mask).
  tintable     boolean not null default false,
  -- Medidas al soltarlo: ancho en % de la sección y proporción alto / ancho.
  default_w    smallint not null default 14,
  aspect       real not null default 1,
  sort_order   smallint not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  check (url is not null or variant is not null)
);

create index if not exists editor_assets_categoria_idx
  on public.editor_assets (category_id, sort_order)
  where is_active;

create index if not exists editor_assets_tags_idx
  on public.editor_assets using gin (tags);

-- updated_at automático (las dos tablas)
create or replace function public.set_editor_catalog_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_editor_categories_updated_at on public.editor_categories;
create trigger trg_editor_categories_updated_at
  before update on public.editor_categories
  for each row execute function public.set_editor_catalog_updated_at();

drop trigger if exists trg_editor_assets_updated_at on public.editor_assets;
create trigger trg_editor_assets_updated_at
  before update on public.editor_assets
  for each row execute function public.set_editor_catalog_updated_at();

-- ----------------------------------------------------------------------- RLS ---

alter table public.editor_categories enable row level security;
alter table public.editor_assets enable row level security;

drop policy if exists editor_categories_lectura_publica on public.editor_categories;
create policy editor_categories_lectura_publica
  on public.editor_categories for select to anon, authenticated
  using (is_active);

drop policy if exists editor_assets_lectura_publica on public.editor_assets;
create policy editor_assets_lectura_publica
  on public.editor_assets for select to anon, authenticated
  using (is_active);

-- Postgres revisa el GRANT antes que las policies: sin esto la anon key da
-- "permission denied" (42501) aunque la policy exista (invitation_versions).
grant select on public.editor_categories to anon, authenticated;
grant select on public.editor_assets to anon, authenticated;

-- ------------------------------------------------------------- uso del recurso ---
-- ¿Alguna invitación o side event usa esta URL? El CRUD lo pregunta antes de
-- borrar: si está en uso, solo se oculta y el archivo se queda en Storage.
-- Busca en el texto del JSON: lento pero exacto, y solo corre al borrar.

create or replace function public.editor_asset_usage(asset_url text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*)::int from public.invitations i where i.data::text like '%' || asset_url || '%')
  -- side_events no tiene `data`: su contenido va en `body` (jsonb) y `url_image`.
  + (select count(*)::int from public.side_events s
       where coalesce(s.body::text, '') || ' ' || coalesce(s.url_image, '') like '%' || asset_url || '%');
$$;

revoke all on function public.editor_asset_usage(text) from public, anon, authenticated;
grant execute on function public.editor_asset_usage(text) to service_role;

-- ------------------------------------------------------------------- bucket ---
-- Público para lectura (la pieza lo pinta en la invitación del invitado).
-- Sin policies de escritura: solo el backend (service role) sube y borra.

insert into storage.buckets (id, name, public)
values ('editor-assets', 'editor-assets', true)
on conflict (id) do nothing;

-- ------------------------------------------------------------------ semilla ---
-- Categorías iniciales. Los recursos los siembra el script
-- 2026-10-28_sembrar_editor_catalog.js (sube los SVG de los íconos y apunta a
-- las ilustraciones y fotos que ya existen). Solo si la tabla está vacía.

insert into public.editor_categories (panel, slug, name_es, name_en, kind, section_key, sort_order)
select * from (values
  ('elements', 'iconos',         'Íconos',         'Icons',         'icon',  null::text, 1),
  ('elements', 'formas',         'Formas',         'Shapes',        'shape', null,       2),
  ('elements', 'ilustraciones',  'Ilustraciones',  'Illustrations', 'image', null,       3),
  ('photos',   'portada',        'Portada',        'Cover',         'image', 'cover',    1),
  ('photos',   'cita',           'Cita',           'Quote',         'image', 'quote',    2),
  ('photos',   'dresscode',      'Dresscode',      'Dress code',    'image', 'dresscode', 3)
) as v(panel, slug, name_es, name_en, kind, section_key, sort_order)
where not exists (select 1 from public.editor_categories);

-- Formas: viven en código (relleno, borde, esquinas); aquí solo su orden.
insert into public.editor_assets (category_id, name, variant, default_w, aspect, sort_order)
select c.id, v.name, v.variant, v.w, v.ar, v.sort_order
from public.editor_categories c
cross join (values
  ('Cuadrado',   'square',   26, 1::real,   1),
  ('Círculo',    'circle',   26, 1,         2),
  ('Rectángulo', 'rect',     40, 0.6,       3),
  ('Triángulo',  'triangle', 26, 0.9,       4),
  ('Estrella',   'star',     26, 1,         5)
) as v(name, variant, w, ar, sort_order)
where c.panel = 'elements' and c.slug = 'formas'
  and not exists (select 1 from public.editor_assets a where a.category_id = c.id);
