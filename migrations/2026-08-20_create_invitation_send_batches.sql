-- Envío masivo de invitaciones (bulk shipment) — cola respaldada en base.
-- Ejecutar manualmente en el SQL editor de Supabase.
--
-- El lote es una entidad: POST /api/whats/bulk crea el batch + sus items y
-- responde 202 de inmediato (sin timeouts). Un worker en el backend procesa
-- los items 'queued' a ritmo controlado; si el backend se redeploya a media
-- tanda, al arrancar retoma los lotes 'processing' pendientes desde la base.
--
-- Créditos: el frontend RESERVA N créditos (un solo UPDATE) al crear el lote;
-- al completarse, el backend reembolsa los fallidos (credits += failed_count).

CREATE TABLE invitation_send_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id uuid NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  total int4 NOT NULL,
  sent_count int4 NOT NULL DEFAULT 0,
  failed_count int4 NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'processing', -- processing | completed
  credits_reserved int4 NOT NULL DEFAULT 0,  -- reservados por el frontend al crear
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX invitation_send_batches_invitation_id_idx
  ON invitation_send_batches (invitation_id, created_at DESC);

-- para que el worker retome pendientes al arrancar
CREATE INDEX invitation_send_batches_processing_idx
  ON invitation_send_batches (status)
  WHERE status = 'processing';

CREATE TABLE invitation_send_batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES invitation_send_batches(id) ON DELETE CASCADE,
  invitation_id uuid NOT NULL,
  guest_id int8 NOT NULL,             -- el principal del bloque
  guest_name text,
  guest_phone text,                   -- sin '+', igual que invitation_message_dispatches
  payload jsonb NOT NULL,             -- payload crudo de Graph API, lo arma el frontend
  status text NOT NULL DEFAULT 'queued', -- queued | sent | failed
  error_detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX invitation_send_batch_items_batch_id_status_idx
  ON invitation_send_batch_items (batch_id, status);

-- Patrón A: solo el backend escribe (Service Role bypassa RLS); el frontend
-- solo lee (la isla de progreso polea el batch).
ALTER TABLE invitation_send_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitation_send_batch_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read send batches"
  ON invitation_send_batches FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "read send batch items"
  ON invitation_send_batch_items FOR SELECT TO anon, authenticated USING (true);
