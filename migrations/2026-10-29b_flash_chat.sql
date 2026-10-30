-- Chat de asistentes de un Evento Flash (handoff "Pop Event — Chat de
-- asistentes, opción 1a · Hoja", adaptado a side events).
--
-- Solo los invitados que confirmaron leen y escriben; se identifican con su
-- código de invitado (side_events_guests.password), así que TODO pasa por el
-- backend (router/sideEventChat.js, service role): estas tablas no tienen
-- policies para anon ni authenticated y nadie las lee con la anon key.
-- El tiempo real es un aviso sin contenido por broadcast (canal
-- side_chat_<id>): la página vuelve a pedir los mensajes con su código.
--
-- Quien escribe con un código es el titular de ese pase (sus acompañantes
-- salen como mini-avatares). El organizador modera desde el editor (borra
-- mensajes: deleted_at) y fija un mensaje en side_events.body.chat.pinned.

create table if not exists public.side_event_messages (
  id            uuid primary key default gen_random_uuid(),
  side_event_id bigint not null references public.side_events(id) on delete cascade,
  guest_id      bigint not null references public.side_events_guests(id) on delete cascade,
  text          text not null check (char_length(text) between 1 and 500),
  created_at    timestamptz not null default now(),
  -- Borrado por el organizador (moderación): deja de mostrarse.
  deleted_at    timestamptz
);

create index if not exists side_event_messages_evento_idx
  on public.side_event_messages (side_event_id, created_at desc)
  where deleted_at is null;

create table if not exists public.side_event_reactions (
  message_id uuid   not null references public.side_event_messages(id) on delete cascade,
  guest_id   bigint not null references public.side_events_guests(id) on delete cascade,
  emoji      text   not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, guest_id, emoji)
);

-- Cerradas: solo la service role (el backend).
alter table public.side_event_messages enable row level security;
alter table public.side_event_reactions enable row level security;
revoke all on public.side_event_messages from anon, authenticated;
revoke all on public.side_event_reactions from anon, authenticated;
