-- Registro de recordatorios manuales de WhatsApp (template `reminder`), Fase 1.
-- Ejecutar manualmente en el SQL editor de Supabase.
--
-- Tabla propia, separada de invitation_message_dispatches a propósito: la RPC
-- get_failed_dispatches evalúa el último intento por invitado, y si los
-- recordatorios compartieran tabla, un recordatorio fallido se reportaría como
-- invitación inicial fallida (y Lia daría información incorrecta al organizador).
--
-- Convención de columnas alineada con la tabla hermana real (verificado en
-- controllers/whatsapp.js y controllers/whatsappWebhook.js): el identificador
-- de Meta se llama meta_message_id (no wa_message_id) y existe una columna
-- status ('processing'|'sent'|'delivered'|'read'|'failed') que el webhook
-- actualiza por UPDATE ciego. Se agregan además failed_at/error_code/error_title,
-- que las tablas hermanas no tienen pobladas hoy — aquí se escriben desde el inicio.

CREATE TABLE invitation_reminder_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id uuid NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  guest_id int8 NOT NULL REFERENCES guests(id) ON DELETE CASCADE, -- el invitado principal del grupo
  guest_name text,
  guest_phone text,                        -- sin '+', igual que invitation_message_dispatches.guest_phone
  meta_message_id text UNIQUE,             -- id del mensaje en Meta; clave del lookup del webhook
  template_name text NOT NULL DEFAULT 'reminder',
  reminder_number int4 NOT NULL DEFAULT 1, -- nº de recordatorio de ese invitado (1 = primero)
  trigger_source text NOT NULL DEFAULT 'manual', -- 'manual' | 'lia_auto' (Fase 2)
  credit_charged boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'processing', -- processing | sent | delivered | read | failed
  recipient_id text,                       -- wa_id que reporta Meta en los statuses
  sent_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  error_code text,
  error_title text,
  raw_send_response jsonb,                 -- respuesta cruda del POST a Graph API
  raw_webhook jsonb,                       -- último status crudo recibido en el webhook
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX invitation_reminder_dispatches_invitation_id_idx
  ON invitation_reminder_dispatches (invitation_id, created_at DESC);

CREATE INDEX invitation_reminder_dispatches_guest_id_idx
  ON invitation_reminder_dispatches (guest_id, created_at DESC);

-- Patrón A (igual que invitation_message_dispatches): solo el backend escribe,
-- con la Service Role Key (que bypassa RLS). El frontend con anon key solo
-- puede leer — no hay policies de INSERT/UPDATE/DELETE para anon/authenticated.
ALTER TABLE invitation_reminder_dispatches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read reminder dispatches"
  ON invitation_reminder_dispatches
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- guests.reminder_count existe desde antes pero puede ser NULL en registros
-- viejos. Default 0 para que los invitados nuevos nazcan con contador válido;
-- el backfill deja los existentes consistentes. (El código igual trata NULL
-- como 0 al leer.)
ALTER TABLE guests ALTER COLUMN reminder_count SET DEFAULT 0;
UPDATE guests SET reminder_count = 0 WHERE reminder_count IS NULL;
