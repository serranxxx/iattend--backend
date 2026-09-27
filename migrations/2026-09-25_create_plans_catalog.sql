-- Catálogo de planes (free, paperless, lite, pro)
-- Correr en el SQL editor de Supabase (o psql con service role).
--
-- Reemplaza los números que vivían hardcodeados en los tres repos:
--   · `credits: plan === 'pro' ? 300 : 0` repetido en seis altas de invitación
--     del backend (controllers/supabase.js, invitation.js, ventas.js).
--   · `planCap = plan === 'pro' ? 3 : plan === 'lite' ? 1 : 0` en
--     iattend-vite SideEvents.jsx.
--   · Las listas de features de cada plan en iattend-vite (Payment/functions.js,
--     CheckoutPage) y en iattend-next (pricing, about/side-events,
--     about/envios-whatsapp).
--
-- Lectura: anon (igual que gift_brands). Escritura: solo service role, detrás de
-- validarAdmin en /api/admin/plans.
--
-- CÓMO FUNCIONA EL CAMBIO DE PLAN SIN ROMPER LO YA VENDIDO
-- Lo que incluye un plan se COPIA a la invitación al crearla
-- (invitations.credits_included / invitations.side_events_included). Editar el
-- catálogo solo afecta a invitaciones nuevas; las existentes conservan lo que
-- compraron. Por eso no hay fechas de corte en el código.
--
-- Esta migración siembra los valores VIGENTES (PRO 300 créditos / 3 side
-- events, Lite 1 side event) para que el deploy no cambie nada por sí solo.
-- El 1 de octubre se editan desde Admin → Planes:
--   PRO:  200 créditos, 2 side events
--   Lite: 0 side events, sin compra de side events sueltos

-- ----------------------------------------------------------------------- tabla ---

create table if not exists public.plans (
  -- Es el mismo valor que se guarda en invitations.plan. No se crean ni se
  -- borran planes desde el admin: el código depende de estos ids.
  id                    text primary key check (id in ('free', 'paperless', 'lite', 'pro')),
  name                  text not null,
  tagline               text,
  credits_included      integer not null default 0 check (credits_included >= 0),
  side_events_included  integer not null default 0 check (side_events_included >= 0),
  -- Si una invitación de este plan puede comprar side events sueltos.
  can_buy_side_events   boolean not null default false,
  -- [{ "icon": "side_events", "es": "{side_events} Side events", "en": "..." }]
  -- `icon` es una clave del mapa de iconos de cada frontend. El texto acepta
  -- los marcadores {credits} y {side_events}, que se sustituyen con los
  -- valores de esta misma fila: así el número del texto nunca se desfasa del
  -- número real.
  features              jsonb not null default '[]'::jsonb check (jsonb_typeof(features) = 'array'),
  -- Price de Stripe con el que se vende. El monto vive en Stripe; el backend lo
  -- junta en GET /api/plans.
  stripe_price_id       text,
  -- Se muestra en landing / checkout / selector de planes.
  is_public             boolean not null default true,
  sort_order            smallint not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  updated_by            uuid
);

create or replace function public.set_plans_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_plans_updated_at on public.plans;
create trigger trg_plans_updated_at
  before update on public.plans
  for each row
  execute function public.set_plans_updated_at();

-- ------------------------------------------------------------------------- RLS ---

alter table public.plans enable row level security;

drop policy if exists plans_lectura_publica on public.plans;
create policy plans_lectura_publica
  on public.plans
  for select
  to anon, authenticated
  using (true);

-- Postgres revisa el GRANT antes que las policies (ver invitation_versions).
grant select on public.plans to anon, authenticated;

-- --------------------------------------------------------------------- semilla ---

insert into public.plans
  (id, name, tagline, credits_included, side_events_included, can_buy_side_events, stripe_price_id, is_public, sort_order, features)
values
  ('free', 'Free', 'Save the Date gratis.', 0, 0, false, null, false, 0,
   '[
     {"icon": "invitation", "es": "Save the Date", "en": "Save the Date"}
   ]'::jsonb),

  ('paperless', 'Paperless', 'La invitación digital esencial, simple y sin límites.', 0, 0, false, 'price_1SkRvtAAdNlITNVbj8BA6F2Q', true, 1,
   '[
     {"icon": "invitation",  "es": "Invitación Paperless", "en": "Paperless invitation"},
     {"icon": "design",      "es": "Diseño libre",         "en": "Free design"},
     {"icon": "edits",       "es": "Ediciones ilimitadas", "en": "Unlimited edits"},
     {"icon": "public",      "es": "Evento público",       "en": "Public event"},
     {"icon": "rsvp",        "es": "Confirmación manual",  "en": "Manual confirmation"}
   ]'::jsonb),

  ('lite', 'Lite', 'Invitación digital con control de invitados.', 0, 1, true, 'price_1Tl9jyAAdNlITNVbm0hq6omU', true, 2,
   '[
     {"icon": "invitation",  "es": "Invitación Paperless",     "en": "Paperless invitation"},
     {"icon": "design",      "es": "Diseño libre",             "en": "Free design"},
     {"icon": "edits",       "es": "Ediciones ilimitadas",     "en": "Unlimited edits"},
     {"icon": "private",     "es": "Evento público o privado", "en": "Public or private event"},
     {"icon": "guests",      "es": "Lista de asistencia",      "en": "Guest list"},
     {"icon": "tables",      "es": "Mapa de mesas",            "en": "Seating chart"},
     {"icon": "side_events", "es": "{side_events} Side events", "en": "{side_events} Side events"}
   ]'::jsonb),

  ('pro', 'PRO', 'La experiencia completa: invita, gestiona y automatiza.', 300, 3, true, 'price_1Tl9fQAAdNlITNVb953oCZLs', true, 3,
   '[
     {"icon": "invitation",  "es": "Invitación Paperless",     "en": "Paperless invitation"},
     {"icon": "design",      "es": "Diseño libre",             "en": "Free design"},
     {"icon": "edits",       "es": "Ediciones ilimitadas",     "en": "Unlimited edits"},
     {"icon": "private",     "es": "Evento público o privado", "en": "Public or private event"},
     {"icon": "guests",      "es": "Lista de asistencia",      "en": "Guest list"},
     {"icon": "tables",      "es": "Mapa de mesas",            "en": "Seating chart"},
     {"icon": "whatsapp",    "es": "Envíos automáticos · {credits} créditos", "en": "Automatic sends · {credits} credits"},
     {"icon": "passes",      "es": "Pases digitales",          "en": "Digital passes"},
     {"icon": "side_events", "es": "{side_events} Side events", "en": "{side_events} Side events"},
     {"icon": "photo_wall",  "es": "Photo Wall",               "en": "Photo Wall"},
     {"icon": "lia",         "es": "Lia · asistente IA",       "en": "Lia · AI assistant"}
   ]'::jsonb)
on conflict (id) do nothing;

-- ------------------------------------------------- snapshot en cada invitación ---

-- Lo que el plan incluía el día que se creó (o se activó) la invitación.
-- `credits` sigue siendo el saldo vivo; `credits_included` es cuánto vino con
-- el plan, para que analítica pueda separar incluidos de comprados.
-- `side_events_included` es el tope de side events: sube 1 con cada side event
-- suelto comprado.
alter table public.invitations
  add column if not exists credits_included integer not null default 0,
  add column if not exists side_events_included integer not null default 0;

-- Backfill con las reglas vigentes hasta hoy. `greatest` con el conteo real
-- para que ninguna invitación quede con menos cupo del que ya usa (hay una
-- free con un side event creado antes de que free existiera como plan).
with conteo as (
  select invitation_id, count(*)::int as usados
  from public.side_events
  group by invitation_id
)
update public.invitations i
set
  credits_included = case when lower(i.plan) = 'pro' then 300 else 0 end,
  side_events_included = greatest(
    case lower(i.plan) when 'pro' then 3 when 'lite' then 1 else 0 end,
    coalesce(c.usados, 0)
  )
from (select id from public.invitations) todas
left join conteo c on c.invitation_id = todas.id
where i.id = todas.id;
