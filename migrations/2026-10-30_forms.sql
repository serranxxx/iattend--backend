-- "Mis formularios" (handoff "Formularios propios en Eventos Flash"): el
-- organizador arma sus formularios desde cero, quedan en su cuenta y los usa
-- en cualquier Flash. Reemplaza las plantillas del registro (2026-10-29c).
--
-- items es una lista plana: { id, kind: 'section', title } o
-- { id, type, label, required, help?, options?, max? }. Los id de pregunta
-- son permanentes (las respuestas se guardan por id).
--
-- El Flash guarda en side_events.body.form { formId, snapshot, reglas }: el
-- snapshot congela las preguntas; es lo que pinta iattend-events y valida el
-- backend (router/sideEventForm.js). Las respuestas siguen en
-- side_event_form_responses.
--
-- La app (iattend-vite) lee y escribe directo con la sesión del organizador:
-- RLS por dueño. Sin GRANT para authenticated, Postgres responde 42501 antes
-- de mirar las policies.

create table if not exists public.forms (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null default 'Formulario sin título',
  description text not null default '',
  items       jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists forms_user_idx on public.forms (user_id, updated_at desc);

alter table public.forms enable row level security;

drop policy if exists forms_dueno_select on public.forms;
drop policy if exists forms_dueno_insert on public.forms;
drop policy if exists forms_dueno_update on public.forms;
drop policy if exists forms_dueno_delete on public.forms;
create policy forms_dueno_select on public.forms for select to authenticated using (user_id = auth.uid());
create policy forms_dueno_insert on public.forms for insert to authenticated with check (user_id = auth.uid());
create policy forms_dueno_update on public.forms for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy forms_dueno_delete on public.forms for delete to authenticated using (user_id = auth.uid());

revoke all on public.forms from anon;
grant select, insert, update, delete on public.forms to authenticated;
