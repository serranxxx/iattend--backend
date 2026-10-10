-- Invitaciones de prueba marcadas en la propia invitación.
--
-- Hasta ahora una invitación era "de prueba" solo por su dueño (profiles.role
-- sales/test/Administration/mkt). Los wedding planners van a tener una
-- invitación de prueba en su cuenta, pero ellos son clientes reales: el dueño
-- ya no alcanza para distinguirla. La regla queda:
--   de prueba = dueño con rol de casa  OR  invitations.is_test
-- La aplican el admin de iattend-vite (adminConstants.js → crearFiltroDePrueba)
-- y el catálogo del backend (controllers/adminInvitaciones.js).
--
-- Correr ANTES de desplegar el backend: el catálogo filtra por esta columna.

alter table public.invitations
  add column if not exists is_test boolean not null default false;

comment on column public.invitations.is_test is
  'Invitación de prueba aunque su dueño sea cliente real (ej. la invitación test de un planner). No cuenta en estadísticas.';
