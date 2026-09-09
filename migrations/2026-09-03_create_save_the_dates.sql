-- Save the Date (quinto producto) — tabla nueva
-- Correr en el SQL editor de Supabase (o psql con service role).
-- Esquema aprobado en el handoff §3.1: una fila por evento (UNIQUE invitation_id),
-- con copia de la estructura `cover` de invitations.data y la fecha del countdown
-- como columna propia (fuente de verdad, §0.4).

create table if not exists public.save_the_dates (
  id            uuid primary key default gen_random_uuid(),
  invitation_id uuid not null references public.invitations (id) on delete cascade,
  cover         jsonb not null default '{}'::jsonb,
  event_date    timestamptz,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint save_the_dates_invitation_unique unique (invitation_id)
);

-- updated_at automático
create or replace function public.set_save_the_dates_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_save_the_dates_updated_at on public.save_the_dates;
create trigger trg_save_the_dates_updated_at
  before update on public.save_the_dates
  for each row execute function public.set_save_the_dates_updated_at();

-- GRANT antes que las policies: Postgres revisa GRANT primero y sin esto el
-- frontend con anon key falla con "permission denied for table" (42501),
-- igual que pasó con invitation_versions.
grant select, insert, update on public.save_the_dates to anon, authenticated;
grant all on public.save_the_dates to service_role;

-- RLS: mismo modelo que el resto de tablas que el frontend toca directo con
-- la anon key (guests, side_events). La página pública solo necesita SELECT;
-- el editor de iattend-vite necesita INSERT/UPDATE. Sin DELETE para anon.
alter table public.save_the_dates enable row level security;

drop policy if exists "save_the_dates_select" on public.save_the_dates;
create policy "save_the_dates_select"
  on public.save_the_dates for select
  using (true);

drop policy if exists "save_the_dates_insert" on public.save_the_dates;
create policy "save_the_dates_insert"
  on public.save_the_dates for insert
  with check (true);

drop policy if exists "save_the_dates_update" on public.save_the_dates;
create policy "save_the_dates_update"
  on public.save_the_dates for update
  using (true)
  with check (true);
