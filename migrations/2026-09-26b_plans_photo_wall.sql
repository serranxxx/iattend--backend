-- Catálogo de planes, cuarta parte: el Photo Wall como algo que el plan
-- incluye o no. Correr en el SQL editor de Supabase DESPUÉS de
-- 2026-09-26_plans_catalog_visibilidad.sql.
--
-- Hasta hoy el dashboard lo bloqueaba con `plan === 'lite'`. Ahora sigue el
-- mismo esquema que créditos y side events: el plan dice si lo incluye
-- (`plans.photo_wall_included`, editable en Admin → Planes) y ese valor se
-- copia a la invitación al crearla o activarla
-- (`invitations.photo_wall_included`). Apagarlo en el catálogo no se lo quita a
-- quien ya lo compró.

alter table public.plans
  add column if not exists photo_wall_included boolean not null default false;

update public.plans set photo_wall_included = (id = 'pro');

alter table public.invitations
  add column if not exists photo_wall_included boolean not null default false;

-- Reglas vigentes hasta hoy: solo PRO lo tenía. Hay invitaciones con plan
-- NULL: lower(NULL) = 'pro' da NULL y la columna es NOT NULL, de ahí el
-- coalesce.
update public.invitations set photo_wall_included = coalesce(lower(plan) = 'pro', false);
