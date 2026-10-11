-- Eventos Flash: un side event que no cuelga de ninguna invitación
-- (invitation_id vacío, que la columna ya permite). Lo compra o crea gratis un
-- wedding planner; puede quedar para él o asignárselo a un cliente, igual que
-- las invitaciones (user_id vacío = "para enviar después").
--   Producto de Stripe: "Flash event", lookup key `flash_event`.
--   Trae 30 créditos de WhatsApp propios (side_events.credits).
-- Backend: helpers/flashEvent.js y controllers/planner.js. Editor:
-- iattend-vite /dashboard/side?flash=<id>.

alter table public.side_events
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists user_email text,
  add column if not exists planner_id uuid references auth.users(id) on delete set null,
  add column if not exists credits integer not null default 0,
  add column if not exists credits_included integer not null default 0,
  add column if not exists is_test boolean not null default false;

create index if not exists side_events_planner_idx on public.side_events (planner_id) where invitation_id is null;
create index if not exists side_events_user_idx on public.side_events (user_id) where invitation_id is null;

-- Eventos Flash gratis que Admin → Usuarios le asigna a un planner (aparte
-- de los eventos PRO gratis).
alter table public.planner_benefits
  add column if not exists free_flash_events integer not null default 0 check (free_flash_events >= 0);

-- Historial de altas del planner: ahora también registra Eventos Flash.
alter table public.planner_events
  add column if not exists kind text not null default 'invitation' check (kind in ('invitation', 'flash')),
  add column if not exists side_event_id bigint references public.side_events(id) on delete set null;

create or replace function public.consumir_evento_flash_gratis(p_planner_id uuid)
returns boolean
language sql
as $$
  with usado as (
    update public.planner_benefits
       set free_flash_events = free_flash_events - 1, updated_at = now()
     where planner_id = p_planner_id and free_flash_events > 0
    returning 1
  )
  select exists (select 1 from usado);
$$;

create or replace function public.devolver_evento_flash_gratis(p_planner_id uuid)
returns void
language sql
as $$
  update public.planner_benefits
     set free_flash_events = free_flash_events + 1, updated_at = now()
   where planner_id = p_planner_id;
$$;

revoke all on function public.consumir_evento_flash_gratis(uuid) from public, anon, authenticated;
revoke all on function public.devolver_evento_flash_gratis(uuid) from public, anon, authenticated;
