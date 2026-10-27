-- Recordatorios (comunicados) para invitados — Guest management → Recordatorios.
-- Correr en el SQL editor de Supabase.
--
-- 1. reminder_templates: el "banco de recordatorios". Cada fila es una
--    plantilla de WhatsApp ya aprobada en Meta. Se edita en iattend-vite,
--    Admin → Configuración → Recordatorios (/api/admin/reminder-templates).
--    La app la lee directo con la anon key (solo las activas).
-- 2. Envío masivo: se reusa la cola de invitation_send_batches con
--    kind = 'reminder'. El worker registra cada envío en
--    invitation_reminder_dispatches y NO toca guests.state.
-- 3. "Solicitar recordatorio" se guarda en support_tickets con el tema
--    'reminder_request' (Admin → Buzón → Reportes).
--
-- Variables: body_variables[i] es la fuente del {{i+1}} del cuerpo, y
-- button_variable la del {{1}} del botón URL. El catálogo de fuentes vive en
-- controllers/reminderTemplates.js (VARIABLES) y en iattend-vite
-- src/modules/GuestManagement/Reminders/reminderVariables.js. Ver
-- iattend-vite docs/recordatorios.md.

-- ------------------------------------------------------ reminder_templates ---

create table if not exists public.reminder_templates (
  id               uuid primary key default gen_random_uuid(),
  -- Llave interna estable (la usan los atajos de la app, p. ej. el botón
  -- "Enviar recordatorio" de Seguimiento abre 'confirma-asistencia').
  slug             text not null unique check (slug ~ '^[a-z0-9_-]+$'),
  -- Nombre exacto de la plantilla en Meta (WhatsApp Manager) y su idioma.
  meta_name        text not null,
  language_code    text not null default 'es_MX',
  -- Lo que ve el organizador en el banco.
  name             text not null,
  description      text,
  -- Copia del cuerpo aprobado en Meta, con sus {{1}}, {{2}}… Solo sirve
  -- para la vista previa: lo que sale es la plantilla de Meta.
  body             text not null,
  body_variables   text[] not null default '{}',
  -- Botón URL (opcional): texto del botón, URL tal como está en Meta
  -- (p. ej. https://iattend.events/{{1}}) y la fuente de su {{1}}.
  button_label     text,
  button_url       text,
  button_variable  text,
  -- Sugerencia de Lia al elegir el recordatorio:
  -- { segment, rules: [{ field, op, value }], comb, title, reason }
  suggestion       jsonb not null default '{}'::jsonb,
  sort_order       smallint not null default 0,
  -- Nace apagada: se prende cuando Meta ya la aprobó.
  is_active        boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  updated_by       uuid
);

create index if not exists reminder_templates_activos_idx
  on public.reminder_templates (sort_order)
  where is_active;

create or replace function public.set_reminder_templates_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_reminder_templates_updated_at on public.reminder_templates;
create trigger trg_reminder_templates_updated_at
  before update on public.reminder_templates
  for each row
  execute function public.set_reminder_templates_updated_at();

alter table public.reminder_templates enable row level security;

drop policy if exists reminder_templates_lectura_publica on public.reminder_templates;
create policy reminder_templates_lectura_publica
  on public.reminder_templates
  for select
  to anon, authenticated
  using (is_active);

-- Postgres revisa el GRANT antes que las policies (ver invitation_versions).
grant select on public.reminder_templates to anon, authenticated;
grant all on public.reminder_templates to service_role;

-- Semilla: la plantilla `reminder` que ya usa el botón de recordatorio de
-- Esperando respuesta (mismos 3 parámetros y botón), activa; y el ejemplo de
-- cambio de cuenta bancaria, apagado hasta confirmar su nombre en Meta.
insert into public.reminder_templates
  (slug, meta_name, language_code, name, description, body, body_variables,
   button_label, button_url, button_variable, suggestion, sort_order, is_active)
values
  ('confirma-asistencia', 'reminder', 'es_MX',
   'Confirma tu asistencia',
   'Para quienes recibieron la invitación y aún no responden.',
   'Hola {{1}}, te recordamos confirmar tu asistencia a {{2}} antes del {{3}}.',
   array['guest_name', 'event_title', 'rsvp_deadline'],
   'Ver invitación', 'https://iattend.events/{{1}}', 'invitation_path',
   '{"segment":"leyeron","rules":[],"comb":"and","title":"Leyeron y no contestaron","reason":"Son los más fáciles de convertir: ya vieron la invitación."}'::jsonb,
   1, true),
  ('cambio-cuenta-bancaria', 'cambio_cuenta_bancaria', 'es_MX',
   'Cambio de cuenta bancaria',
   'Avisa que la cuenta para regalos en efectivo cambió.',
   E'Hola {{1}}, te informamos un cambio en la invitación de {{2}}.\n\nLa cuenta bancaria publicada anteriormente fue cancelada. Si realizaste una transferencia a esa cuenta, es posible que haya sido rechazada y el monto devuelto a tu cuenta.\n\nLos datos de la nueva cuenta ya están actualizados en la invitación.',
   array['guest_name', 'event_title'],
   'Ver invitación', 'https://iattend.events/{{1}}', 'invitation_path',
   '{"segment":"todos","rules":[{"field":"state","op":"no","value":"rechazado"}],"comb":"and","title":"Todos menos quienes no asistirán","reason":"Le llega a quien todavía puede hacer una transferencia."}'::jsonb,
   2, false)
on conflict (slug) do nothing;

-- -------------------------------------------- envío masivo de recordatorios ---

alter table public.invitation_send_batches
  add column if not exists kind text not null default 'invitation'
    check (kind in ('invitation', 'reminder')),
  add column if not exists reminder_template_id uuid
    references public.reminder_templates (id) on delete set null;

alter table public.invitation_reminder_dispatches
  add column if not exists reminder_template_id uuid
    references public.reminder_templates (id) on delete set null,
  add column if not exists batch_id uuid
    references public.invitation_send_batches (id) on delete set null;

create index if not exists invitation_reminder_dispatches_template_idx
  on public.invitation_reminder_dispatches (invitation_id, reminder_template_id, created_at desc);

-- -------------------------------------------- solicitudes de recordatorio ---

alter table public.support_tickets drop constraint if exists support_tickets_topic_check;
alter table public.support_tickets
  add constraint support_tickets_topic_check
  check (topic in ('help', 'improvement', 'question', 'reminder_request'));
