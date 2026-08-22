-- Envío masivo para SIDE EVENTS: extensión de invitation_send_batches.
-- Ejecutar manualmente en el SQL editor de Supabase (después de
-- 2026-08-20_create_invitation_send_batches.sql, que ya está aplicada).
--
-- Cuando side_event_id NO es null, los guest_id de los items son ids de
-- side_events_guests (mismo patrón de ids mixto que invitation_message_dispatches)
-- y el worker marca como 'esperando' en side_events_guests en vez de guests.

ALTER TABLE invitation_send_batches
  ADD COLUMN side_event_id int8 REFERENCES side_events(id) ON DELETE CASCADE;

ALTER TABLE invitation_send_batch_items
  ADD COLUMN side_event_id int8 REFERENCES side_events(id) ON DELETE CASCADE;
