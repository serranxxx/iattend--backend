-- Carga masiva de invitados vía Excel + Gemini (Fase 3 de Lia)
-- Ejecutar manualmente en el SQL editor de Supabase.
-- Columnas verificadas contra el esquema real de `guests` y
-- `side_events_guests` (query directa de solo lectura), no solo contra
-- lo documentado en CLAUDE.md — `side_events_guests` sí tiene side,
-- notes, meal, companion_id (bigint, igual que guests), has_companion y
-- ticket; lo único que no tiene es special_needs.

CREATE OR REPLACE FUNCTION bulk_create_guests(
  p_invitation_id uuid,
  p_side_events_id bigint,
  p_target_table text,
  p_rows jsonb
)
RETURNS TABLE(id bigint, name text) AS $$
BEGIN
  IF p_target_table = 'guests' THEN
    RETURN QUERY
    INSERT INTO guests (
      invitation_id, name, phone_number, tag, type, tier, side,
      notes, meal, special_needs, password, state, last_action, last_action_by, ticket
    )
    SELECT
      p_invitation_id, r.name, r.phone_number, r.tag,
      r.type::guest_type, r.tier, r.side, r.notes, r.meal,
      r.special_needs, r.password, 'creado'::guest_state, 'creado', 'admin'::action_actor, true
    FROM jsonb_to_recordset(p_rows) AS r(
      name text, phone_number text, tag text, type text, tier text,
      side text, notes text, meal text, special_needs text, password text
    )
    RETURNING guests.id, guests.name;

  ELSIF p_target_table = 'side_events_guests' THEN
    RETURN QUERY
    INSERT INTO side_events_guests (
      side_events_id, name, phone_number, tag, type, tier, side,
      notes, meal, password, state, last_action, last_action_by, ticket
    )
    SELECT
      p_side_events_id, r.name, r.phone_number, r.tag,
      r.type::guest_type, r.tier, r.side, r.notes, r.meal,
      r.password, 'creado', 'creado', true, true
    FROM jsonb_to_recordset(p_rows) AS r(
      name text, phone_number text, tag text, type text, tier text,
      side text, notes text, meal text, password text
    )
    RETURNING side_events_guests.id, side_events_guests.name;

  ELSE
    RAISE EXCEPTION 'invalid p_target_table: %', p_target_table;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- p_pairs: [{ "guest_id": 123, "companion_id": 456 }, ...]
-- guest_id = el acompañante (B), companion_id = el invitado principal (A) al que acompaña.
-- Resultado: B.companion_id = A.id, A.has_companion = true.
CREATE OR REPLACE FUNCTION bulk_set_guest_companions(
  p_target_table text,
  p_pairs jsonb
)
RETURNS void AS $$
BEGIN
  IF p_target_table = 'guests' THEN
    UPDATE guests g
    SET companion_id = p.companion_id
    FROM jsonb_to_recordset(p_pairs) AS p(guest_id bigint, companion_id bigint)
    WHERE g.id = p.guest_id;

    UPDATE guests g
    SET has_companion = true
    FROM jsonb_to_recordset(p_pairs) AS p(guest_id bigint, companion_id bigint)
    WHERE g.id = p.companion_id;

  ELSIF p_target_table = 'side_events_guests' THEN
    UPDATE side_events_guests g
    SET companion_id = p.companion_id
    FROM jsonb_to_recordset(p_pairs) AS p(guest_id bigint, companion_id bigint)
    WHERE g.id = p.guest_id;

    UPDATE side_events_guests g
    SET has_companion = true
    FROM jsonb_to_recordset(p_pairs) AS p(guest_id bigint, companion_id bigint)
    WHERE g.id = p.companion_id;

  ELSE
    RAISE EXCEPTION 'invalid p_target_table: %', p_target_table;
  END IF;
END;
$$ LANGUAGE plpgsql;
