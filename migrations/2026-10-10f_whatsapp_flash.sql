-- Envíos por WhatsApp de los Eventos Flash (side events sin invitación, ver
-- 2026-10-10d_eventos_flash.sql). Las tablas de envío exigían invitation_id;
-- un Flash no tiene, así que el envío queda ligado a su side_event_id. Cada
-- fila necesita al menos uno de los dos.
--   invitation_message_dispatches   → se le agrega side_event_id (no lo tenía)
--   invitation_reminder_dispatches  ┐
--   invitation_send_batches         ├ ya tenían side_event_id
--   invitation_send_batch_items     ┘
-- Backend: controllers/whatsapp.js y services/whatsappBulkWorker.js (los
-- créditos de un Flash salen de side_events.credits, no de invitations).

alter table public.invitation_message_dispatches
  add column if not exists side_event_id bigint references public.side_events(id) on delete set null;

create index if not exists invitation_message_dispatches_side_event_idx
  on public.invitation_message_dispatches (side_event_id)
  where side_event_id is not null;

alter table public.invitation_message_dispatches  alter column invitation_id drop not null;
alter table public.invitation_reminder_dispatches alter column invitation_id drop not null;
alter table public.invitation_send_batches        alter column invitation_id drop not null;
alter table public.invitation_send_batch_items    alter column invitation_id drop not null;

alter table public.invitation_message_dispatches
  drop constraint if exists invitation_message_dispatches_destino_chk,
  add constraint invitation_message_dispatches_destino_chk check (invitation_id is not null or side_event_id is not null);

alter table public.invitation_reminder_dispatches
  drop constraint if exists invitation_reminder_dispatches_destino_chk,
  add constraint invitation_reminder_dispatches_destino_chk check (invitation_id is not null or side_event_id is not null);

alter table public.invitation_send_batches
  drop constraint if exists invitation_send_batches_destino_chk,
  add constraint invitation_send_batches_destino_chk check (invitation_id is not null or side_event_id is not null);

alter table public.invitation_send_batch_items
  drop constraint if exists invitation_send_batch_items_destino_chk,
  add constraint invitation_send_batch_items_destino_chk check (invitation_id is not null or side_event_id is not null);
