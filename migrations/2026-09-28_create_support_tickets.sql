-- Reportes de soporte (botón "Enviar reporte" del header de iattend-vite).
-- Correr en el SQL editor de Supabase.
--
-- Hasta hoy el reporte solo se mandaba por correo y no quedaba registro. Ahora
-- el backend (POST /api/support/tickets) guarda cada uno aquí y además manda el
-- mismo correo. Admin → Notificaciones los lista y les cambia el estado.
--
-- Solo el backend (service role) lee y escribe: no hay policies para anon ni
-- authenticated, así que el frontend no puede leer reportes ajenos.

create table if not exists public.support_tickets (
  id             uuid primary key default gen_random_uuid(),
  topic          text not null check (topic in ('help', 'improvement', 'question')),
  body           text not null,
  -- Quién lo mandó. user_id sale de la sesión cuando la hay; correo y nombre se
  -- copian para que el reporte se lea aunque después cambie el perfil.
  user_id        uuid references public.profiles (user_id) on delete set null,
  user_email     text,
  user_name      text,
  invitation_id  uuid references public.invitations (id) on delete set null,
  event_name     text,
  status         text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  admin_note     text,
  email_sent     boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  resolved_at    timestamptz
);

create index if not exists support_tickets_status_created_idx
  on public.support_tickets (status, created_at desc);

create or replace function public.set_support_tickets_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_support_tickets_updated_at on public.support_tickets;
create trigger trg_support_tickets_updated_at
  before update on public.support_tickets
  for each row execute function public.set_support_tickets_updated_at();

grant all on public.support_tickets to service_role;
alter table public.support_tickets enable row level security;
