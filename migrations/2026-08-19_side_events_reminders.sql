-- Recordatorios manuales de WhatsApp para SIDE EVENTS (extensión de la Fase 1).
-- Ejecutar manualmente en el SQL editor de Supabase.
--
-- Decisiones confirmadas por Alberto:
--  - Se reusa invitation_reminder_dispatches (no tabla espejo): se agrega
--    side_event_id nullable. El webhook no necesita cambios.
--  - Cada side event tiene su propia fecha límite (side_events.rsvp_deadline).
--  - El límite de 1 recordatorio/día es POR side event: los contadores viven
--    en side_events_guests (un invitado en 3 side events tiene 3 filas ahí,
--    una por evento, así que el límite queda por evento de forma natural).

-- 1. Fecha límite de confirmación propia por side event
ALTER TABLE side_events ADD COLUMN rsvp_deadline date;

-- 2. Contadores de recordatorio en side_events_guests (espejo de guests)
ALTER TABLE side_events_guests ADD COLUMN reminder_count int4 NOT NULL DEFAULT 0;
ALTER TABLE side_events_guests ADD COLUMN last_reminder_at timestamptz;

-- 3. invitation_reminder_dispatches: soporte para side events.
--    Cuando side_event_id NO es null, guest_id contiene el id de
--    side_events_guests (mismo patrón de espacio de ids mixto que ya usa
--    invitation_message_dispatches con los envíos de side events), por lo que
--    el FK duro a guests deja de ser válido y se elimina.
ALTER TABLE invitation_reminder_dispatches
  DROP CONSTRAINT invitation_reminder_dispatches_guest_id_fkey;

ALTER TABLE invitation_reminder_dispatches
  ADD COLUMN side_event_id int8 REFERENCES side_events(id) ON DELETE CASCADE;

CREATE INDEX invitation_reminder_dispatches_side_event_id_idx
  ON invitation_reminder_dispatches (side_event_id, created_at DESC)
  WHERE side_event_id IS NOT NULL;
