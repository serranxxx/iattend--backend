-- Registro de asistentes de un Evento Flash (handoff "Pop Event — Registro
-- de asistentes, paso a paso", opción 2a, adaptado a side events).
--
-- El organizador arma el formulario en el editor (plantilla + ajustes) y se
-- guarda en side_events.body.form. Cada invitado confirmado lo responde paso a
-- paso desde la página del evento; con "Por persona" también registra a sus
-- acompañantes confirmados (o les deja un link para que lo hagan después).
--
-- Son datos personales y sensibles (LFPDPPP): TODO pasa por el backend
-- (router/sideEventForm.js, service role) con el código del invitado o el
-- token de su link; estas tablas no tienen policies para anon/authenticated.
-- consent_at / consent_version guardan cuándo y qué aviso aceptó.

create table if not exists public.side_event_form_responses (
  id              uuid primary key default gen_random_uuid(),
  side_event_id   bigint not null references public.side_events(id) on delete cascade,
  -- La persona registrada (titular o acompañante: ambos son filas de side_events_guests).
  guest_id        bigint not null references public.side_events_guests(id) on delete cascade,
  answers         jsonb not null default '{}'::jsonb,
  consent_at      timestamptz,
  consent_version text,
  status          text not null default 'completo' check (status in ('completo', 'pendiente')),
  -- "Se registra después con su propio link".
  link_token      text unique,
  folio           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (side_event_id, guest_id)
);

create index if not exists side_event_form_responses_evento_idx
  on public.side_event_form_responses (side_event_id, updated_at desc);

alter table public.side_event_form_responses enable row level security;
revoke all on public.side_event_form_responses from anon, authenticated;
