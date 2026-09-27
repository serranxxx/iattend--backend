-- Catálogo de planes, tercera parte: en qué pantallas se muestra cada plan.
-- Correr en el SQL editor de Supabase DESPUÉS de 2026-09-25b_plans_catalog_superficies.sql.
--
-- Antes las pantallas decidían por su cuenta qué planes ofrecer (la landing y
-- el checkout tenían "pro" y "lite" escritos en el código). Ahora cada plan
-- lo dice con tres interruptores, editables en Admin → Planes:
--   · show_landing   → tarjeta en iattend-next /about/pricing
--   · show_checkout  → selector de /checkout en iattend-vite
--   · show_app       → selector de planes dentro de la app (alta de invitación
--                      y el modal para contratar desde una invitación free)
--
-- Un plan oculto en todas sigue funcionando para las invitaciones que ya lo
-- tienen; solo deja de venderse. `is_public` queda como resumen: true si se
-- muestra en al menos una.

alter table public.plans
  add column if not exists show_landing  boolean not null default false,
  add column if not exists show_checkout boolean not null default false,
  add column if not exists show_app      boolean not null default false;

-- Lo mismo que hoy se ve en cada pantalla.
update public.plans set show_landing = true,  show_checkout = true,  show_app = true  where id in ('pro', 'lite');
update public.plans set show_landing = false, show_checkout = false, show_app = true  where id = 'paperless';
update public.plans set show_landing = false, show_checkout = false, show_app = false where id = 'free';

update public.plans set is_public = (show_landing or show_checkout or show_app);
