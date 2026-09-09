-- Reacciones del Save the Date (estilo historias de Instagram):
-- los invitados que reciben el link pueden mandar un emoji o un mensaje corto.
-- Correr en el SQL editor de Supabase.

create table if not exists public.save_the_date_reactions (
  id                uuid primary key default gen_random_uuid(),
  save_the_date_id  uuid not null references public.save_the_dates (id) on delete cascade,
  emoji             text,
  message           text,
  created_at        timestamptz not null default now(),
  -- al menos una de las dos cosas
  constraint std_reactions_content check (emoji is not null or message is not null),
  -- límites de cordura para una tabla pública sin auth
  constraint std_reactions_emoji_len check (emoji is null or char_length(emoji) <= 16),
  constraint std_reactions_message_len check (message is null or char_length(message) <= 300)
);

create index if not exists idx_std_reactions_std
  on public.save_the_date_reactions (save_the_date_id, created_at desc);

-- GRANT antes que las policies (gotcha 42501). La página pública es anónima:
-- SELECT para la animación inicial e INSERT para reaccionar. Sin UPDATE/DELETE.
grant select, insert on public.save_the_date_reactions to anon, authenticated;
grant all on public.save_the_date_reactions to service_role;

alter table public.save_the_date_reactions enable row level security;

drop policy if exists "std_reactions_select" on public.save_the_date_reactions;
create policy "std_reactions_select"
  on public.save_the_date_reactions for select
  using (true);

drop policy if exists "std_reactions_insert" on public.save_the_date_reactions;
create policy "std_reactions_insert"
  on public.save_the_date_reactions for insert
  with check (true);
