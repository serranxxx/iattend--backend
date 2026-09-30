-- Notas y eventos personales del dashboard de planners (iattend-vite,
-- components/PlannerDashboard). Correr en el SQL editor de Supabase.
--
-- Antes vivían en localStorage del navegador: no se veían en otro dispositivo.
-- El frontend lee y escribe directo con la sesión de Supabase; cada planner
-- solo ve lo suyo (planner_id = auth.uid()) y solo puede ligar una nota a un
-- evento que gestiona (can_manage_invitation, de 2026-09-24_planner_role.sql).

-- 1. Notas ---------------------------------------------------------------
create table if not exists public.planner_notes (
  id             uuid primary key default gen_random_uuid(),
  planner_id     uuid not null references public.profiles (user_id) on delete cascade,
  -- Evento al que se refiere; si se borra el evento, se van sus notas.
  invitation_id  uuid references public.invitations (id) on delete cascade,
  text           text not null check (char_length(btrim(text)) between 1 and 500),
  done           boolean not null default false,
  done_at        timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists planner_notes_planner_created_idx
  on public.planner_notes (planner_id, created_at desc);

create or replace function public.set_planner_notes_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.done_at = case when new.done then coalesce(new.done_at, now()) else null end;
  return new;
end;
$$;

drop trigger if exists planner_notes_updated_at on public.planner_notes;
create trigger planner_notes_updated_at
  before update on public.planner_notes
  for each row execute function public.set_planner_notes_updated_at();

-- 2. Eventos personales de la agenda ---------------------------------------
-- No están ligados a una invitación: pruebas de pastel, visitas, citas…
-- `time` es hora de pared, sin zona (misma convención que los side events).
create table if not exists public.planner_agenda_events (
  id          uuid primary key default gen_random_uuid(),
  planner_id  uuid not null references public.profiles (user_id) on delete cascade,
  title       text not null check (char_length(btrim(title)) between 1 and 120),
  date        date not null,
  time        time,
  place       text check (place is null or char_length(place) <= 200),
  created_at  timestamptz not null default now()
);

create index if not exists planner_agenda_events_planner_date_idx
  on public.planner_agenda_events (planner_id, date);

-- 3. RLS: cada planner solo lo suyo -----------------------------------------
alter table public.planner_notes enable row level security;
alter table public.planner_agenda_events enable row level security;

drop policy if exists planner_notes_own on public.planner_notes;
create policy planner_notes_own on public.planner_notes
  for all to authenticated
  using (planner_id = auth.uid())
  with check (
    planner_id = auth.uid()
    and (invitation_id is null or public.can_manage_invitation(invitation_id))
  );

drop policy if exists planner_agenda_events_own on public.planner_agenda_events;
create policy planner_agenda_events_own on public.planner_agenda_events
  for all to authenticated
  using (planner_id = auth.uid())
  with check (planner_id = auth.uid());

-- Sin GRANT, Postgres rechaza antes de mirar las policies (42501).
grant select, insert, update, delete on public.planner_notes to authenticated;
grant select, insert, update, delete on public.planner_agenda_events to authenticated;
