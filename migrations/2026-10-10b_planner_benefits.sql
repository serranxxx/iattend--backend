-- Beneficios de wedding planners y eventos que crean para sus clientes.
--
-- planner_benefits: lo que Admin → Usuarios le asigna a un planner.
--   free_events  → eventos PRO que puede crear sin pagar (botón "evento gratis"
--                  en /invitations). Se descuenta uno por evento creado.
--   discount_pct → descuento en toda compra suya (cupón de Stripe que el
--                  backend agrega en el checkout).
-- planner_events: historial de cada evento que un planner crea para un
--   cliente, gratis o pagado. El pagado nace 'pendiente' con el formulario en
--   `payload` y el webhook de Stripe lo completa creando la invitación.
--
-- Solo los lee y escribe el backend (service role): RLS sin policies.

create table if not exists public.planner_benefits (
  planner_id   uuid primary key references auth.users(id) on delete cascade,
  free_events  integer not null default 0 check (free_events >= 0),
  discount_pct integer not null default 0 check (discount_pct between 0 and 90),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id) on delete set null
);

alter table public.planner_benefits enable row level security;

create table if not exists public.planner_events (
  id                uuid primary key default gen_random_uuid(),
  planner_id        uuid not null references auth.users(id) on delete cascade,
  invitation_id     uuid references public.invitations(id) on delete set null,
  tipo              text not null check (tipo in ('gratis', 'compra')),
  estado            text not null default 'completado' check (estado in ('pendiente', 'completado', 'fallido')),
  plan              text not null,
  descuento_pct     integer not null default 0,
  monto             numeric,
  stripe_session_id text,
  payload           jsonb,
  error             text,
  created_at        timestamptz not null default now(),
  completed_at      timestamptz
);

create index if not exists planner_events_planner_idx on public.planner_events (planner_id, created_at desc);

alter table public.planner_events enable row level security;

-- Descontar un evento gratis sin carreras: dos altas simultáneas no pueden
-- gastar el mismo. Devuelve false si ya no le quedan.
create or replace function public.consumir_evento_gratis(p_planner_id uuid)
returns boolean
language sql
as $$
  with usado as (
    update public.planner_benefits
       set free_events = free_events - 1, updated_at = now()
     where planner_id = p_planner_id and free_events > 0
    returning 1
  )
  select exists (select 1 from usado);
$$;

-- Devolverlo si el alta falla después de descontarlo.
create or replace function public.devolver_evento_gratis(p_planner_id uuid)
returns void
language sql
as $$
  update public.planner_benefits
     set free_events = free_events + 1, updated_at = now()
   where planner_id = p_planner_id;
$$;

revoke all on function public.consumir_evento_gratis(uuid) from public, anon, authenticated;
revoke all on function public.devolver_evento_gratis(uuid) from public, anon, authenticated;
