-- Catálogo de marcas de la mesa de regalos (tiendas y bancos)
-- Correr en el SQL editor de Supabase (o psql con service role).
--
-- Reemplaza tres fuentes de verdad que vivían hardcodeadas en el código:
--   1. Los arrays `banks` y `stores` de iattend-vite
--      src/modules/Invitation/Build/BuildSections/BuildGifts.jsx (líneas 11-27).
--   2. El mapa ALIAS_TO_KEY + BRAND_META de iattend-events
--      src/components/Invitation/Gifts/Wallet/classifyGiftCard.ts.
--   3. Los gradientes por marca de iattend-events
--      src/components/Invitation/Gifts/Wallet/wallet.module.css (líneas 148-207).
--
-- Las tarjetas de cada invitación NO se tocan: siguen viviendo en el JSONB
-- invitations.data.gifts.cards con la forma { kind, brand, url, bank, name,
-- number }. Esta tabla es el catálogo que las resuelve a logo y estilo.
--
-- Lectura: anon (la consumen BuildGifts y iattend-events directo con la anon
-- key, como `textures`). Escritura: solo service role, detrás de validarAdmin
-- en /api/admin/gift-brands.

-- ---------------------------------------------------------------- normalización ---

-- Espejo en SQL del `normalize()` de classifyGiftCard.ts: minúsculas, sin
-- acentos, espacios colapsados, trim. Se usa para casar el string libre que
-- quedó guardado en las tarjetas contra el catálogo.
-- translate() en vez de unaccent() para no depender de la extensión.
create or replace function public.gift_brand_key(raw text)
returns text
language sql
immutable
as $$
  select nullif(
    regexp_replace(
      btrim(lower(translate(
        coalesce(raw, ''),
        'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
        'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC'
      ))),
      '\s+', ' ', 'g'
    ),
  '');
$$;

-- ----------------------------------------------------------------------- tabla ---

create table if not exists public.gift_brands (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('store', 'bank')),
  -- Nombre canónico. Es EXACTAMENTE el string que se guarda en
  -- cards[].brand (store) o cards[].bank (bank), así que cambiarlo
  -- desvincula las tarjetas ya guardadas. El CRUD lo bloquea si hay uso.
  name        text not null,
  -- gift_brand_key(name). Clave de matcheo primaria.
  slug        text not null unique,
  -- Variantes normalizadas que también resuelven a esta marca
  -- (equivalente al ALIAS_TO_KEY que estaba en classifyGiftCard.ts).
  aliases     text[] not null default '{}',
  logo_url    text,
  -- Estilo de la tarjeta en el wallet del invitado: valor CSS completo de
  -- background y color de texto. Sin esto, toda marca creada desde el CRUD
  -- saldría sin diseño porque no tendría clase en wallet.module.css.
  background  text,
  text_color  text,
  sort_order  smallint not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid
);

create index if not exists gift_brands_kind_activas_idx
  on public.gift_brands (kind, sort_order)
  where is_active;

-- Búsqueda por alias
create index if not exists gift_brands_aliases_idx
  on public.gift_brands using gin (aliases);

-- updated_at automático
create or replace function public.set_gift_brands_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_gift_brands_updated_at on public.gift_brands;
create trigger trg_gift_brands_updated_at
  before update on public.gift_brands
  for each row
  execute function public.set_gift_brands_updated_at();

-- ------------------------------------------------------------------------- RLS ---

alter table public.gift_brands enable row level security;

drop policy if exists gift_brands_lectura_publica on public.gift_brands;
create policy gift_brands_lectura_publica
  on public.gift_brands
  for select
  to anon, authenticated
  using (is_active);

-- Postgres revisa el GRANT ANTES que las policies: sin esto la lectura desde
-- el front con la anon key falla con 42501 "permission denied for table",
-- aunque la policy exista. Ya pasó con invitation_versions.
grant select on public.gift_brands to anon, authenticated;
grant execute on function public.gift_brand_key(text) to anon, authenticated;

-- ------------------------------------------------------------------ uso por marca ---

-- Cuántas invitaciones usan cada marca, recorriendo el JSONB de las tarjetas.
-- Espejo de get_font_usage(): lo consume /api/admin/gift-brands para bloquear
-- la desactivación de una marca en uso.
create or replace function public.get_gift_brand_usage()
returns table (
  brand_key        text,
  invitation_count bigint,
  invitation_ids   uuid[]
)
language sql
stable
as $$
  with tarjetas as (
    select
      i.id as invitation_id,
      public.gift_brand_key(
        case when c->>'kind' = 'store' then c->>'brand' else c->>'bank' end
      ) as brand_key
    from public.invitations i
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(i.data->'gifts'->'cards') = 'array'
        then i.data->'gifts'->'cards'
        else '[]'::jsonb
      end
    ) as c
  )
  select
    t.brand_key,
    count(distinct t.invitation_id) as invitation_count,
    array_agg(distinct t.invitation_id) as invitation_ids
  from tarjetas t
  where t.brand_key is not null
  group by t.brand_key;
$$;

grant execute on function public.get_gift_brand_usage() to service_role;

-- --------------------------------------------------------------------- semilla ---

-- Los 12 valores que estaban hardcodeados, con el mismo nombre canónico que ya
-- tienen las tarjetas guardadas (ojo: 'Palacio de hierro' con h minúscula, tal
-- como lo escribía el array `stores` de BuildGifts) y los mismos gradientes de
-- wallet.module.css, para que nada cambie visualmente.
--
-- logo_url queda en null: lo llena el script de subida
-- migrations/2026-09-18_subir_logos_gift_brands.js, que mueve los PNG de
-- iattend-events/public/assets/banks a Storage.

insert into public.gift_brands (kind, name, slug, aliases, background, text_color, sort_order) values
  ('store', 'Amazon',            'amazon',            '{}',
   '#171D27', '#FFFFFF', 1),

  ('store', 'Liverpool',         'liverpool',         '{"el puerto de liverpool"}',
   'linear-gradient(180deg, #EE0087 0%, #E60183 51.44%, #C90071 100%)', '#FFFFFF', 2),

  ('store', 'Palacio de hierro', 'palacio de hierro', '{"el palacio de hierro","palacio"}',
   'linear-gradient(100deg, #E5A730 0.59%, #D8AA35 97.08%)', '#252525', 3),

  ('store', 'Sears',             'sears',             '{}',
   'linear-gradient(90deg, #C21B1D 0%, #991010 100%)', '#FFFFFF', 4),

  ('bank',  'Banamex',           'banamex',           '{"citibanamex"}',
   'linear-gradient(0deg, #1A4A7B 0%, #0099D5 100%)', '#DADDE2', 1),

  ('bank',  'Banorte',           'banorte',           '{}',
   'radial-gradient(50% 50% at 50% 50%, #484649 0%, #3F3D40 100%)', '#FFFFFF', 2),

  ('bank',  'BBVA',              'bbva',              '{}',
   'linear-gradient(262deg, #02326D 2.39%, #1D528E 43.11%, #02326D 98.21%)', '#FFFFFF', 3),

  ('bank',  'Crelan',            'crelan',            '{}',
   'linear-gradient(278deg, #68AD06 1.34%, #81BE19 50.29%, #7DBB1D 99.24%)', '#FFFFFF', 4),

  ('bank',  'HSBC',              'hsbc',              '{}',
   'linear-gradient(270deg, #D8D8D8 0%, #b8b6b6 100%)', '#000000', 5),

  -- 'nu mexico' y 'banco nu' salen de valores sucios que ya están en producción
  -- y que hoy caen a `default` (tarjeta sin logo).
  ('bank',  'Nu',                'nu',                '{"nubank","nu bank","banco nu","nu mexico"}',
   'linear-gradient(270deg, #9F2DEB 0%, #710BB4 100%)', '#FFFFFF', 6),

  ('bank',  'Santander',         'santander',         '{}',
   'linear-gradient(270deg, #E60203 0%, #E70101 100%)', '#DADDE2', 7),

  ('bank',  'Scotiabank',        'scotiabank',        '{}',
   'linear-gradient(270deg, #AD1E0D 0%, #C1250F 100%)', '#FFFFFF', 8)

on conflict (slug) do nothing;
