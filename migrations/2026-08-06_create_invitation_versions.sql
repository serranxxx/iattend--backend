-- Historial persistido de publicaciones de invitación (respaldo por versión).
-- Ejecutar manualmente en el SQL editor de Supabase.
--
-- No hay trigger sobre invitations: el versionado solo se dispara desde el
-- flujo explícito de "Publicar cambios" (ver publish_invitation), nunca como
-- efecto secundario de cualquier UPDATE a invitations.data — hay otras rutas
-- de escritura (p.ej. descuento de créditos, persistGenerals) que no deben
-- generar una versión.
--
-- Esquema/convenciones verificados contra la instancia real de Supabase
-- (no solo contra lo documentado): invitations.id es uuid, invitations.data
-- es jsonb, invitations.user_id es uuid → auth.users. invitation_translations
-- es el análogo más cercano (FK + jsonb + timestamptz) y ya sigue el patrón
-- moderno created_at/updated_at timestamptz, a diferencia del invitations
-- legacy (timestamp sin timezone) — invitation_versions sigue el patrón
-- moderno.

CREATE TABLE invitation_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id uuid NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX invitation_versions_invitation_id_created_at_idx
  ON invitation_versions (invitation_id, created_at DESC);

-- Append-only: sin policies de UPDATE/DELETE para nadie, ni siquiera el dueño.
-- Todo el acceso (lectura y escritura) pasa por las funciones de abajo
-- (SECURITY DEFINER), así que RLS/grants directos sobre la tabla no importan
-- para el flujo normal — esto solo cierra la puerta a que alguien la toque
-- por fuera de esas dos funciones.
ALTER TABLE invitation_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON invitation_versions FROM anon, authenticated;

-- Publica cambios: UPDATE a invitations.data + INSERT a invitation_versions
-- en una sola transacción (una función = una transacción implícita, así que
-- no puede quedar una invitación publicada sin su versión correspondiente).
--
-- SECURITY DEFINER porque la función necesita escribir en invitation_versions
-- (que no tiene ninguna policy que lo permita) — por eso el chequeo de dueño
-- se hace a mano adentro. Si quien llama es el backend con la service-role
-- key (ruta admin "Escribir"), auth.role() es 'service_role' y se salta ese
-- chequeo, igual que ya pasa hoy con el UPDATE directo a invitations desde
-- ese mismo flujo.
CREATE OR REPLACE FUNCTION publish_invitation(
  p_invitation_id uuid,
  p_data jsonb
)
RETURNS invitation_versions AS $$
DECLARE
  v_version invitation_versions;
BEGIN
  IF auth.role() <> 'service_role' AND NOT EXISTS (
    SELECT 1 FROM invitations WHERE id = p_invitation_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not authorized to publish invitation %', p_invitation_id;
  END IF;

  UPDATE invitations
  SET data = p_data, updated_at = now()
  WHERE id = p_invitation_id;

  INSERT INTO invitation_versions (invitation_id, data)
  VALUES (p_invitation_id, p_data)
  RETURNING * INTO v_version;

  RETURN v_version;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION publish_invitation(uuid, jsonb) TO anon, authenticated;

-- Lista versiones de una invitación, más recientes primero, paginado.
-- total_count viaja en cada fila (window function) para que el panel de
-- historial pueda armar la paginación sin una segunda consulta.
CREATE OR REPLACE FUNCTION get_invitation_versions(
  p_invitation_id uuid,
  p_limit int DEFAULT 20,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  invitation_id uuid,
  data jsonb,
  created_at timestamptz,
  total_count bigint
) AS $$
BEGIN
  IF auth.role() <> 'service_role' AND NOT EXISTS (
    SELECT 1 FROM invitations WHERE id = p_invitation_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not authorized to read versions of invitation %', p_invitation_id;
  END IF;

  RETURN QUERY
  SELECT v.id, v.invitation_id, v.data, v.created_at,
         COUNT(*) OVER() AS total_count
  FROM invitation_versions v
  WHERE v.invitation_id = p_invitation_id
  ORDER BY v.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION get_invitation_versions(uuid, int, int) TO anon, authenticated;
