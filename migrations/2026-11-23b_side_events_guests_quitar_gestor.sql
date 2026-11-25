-- Quita la política vieja side_events_guests_gestor (no estaba en las
-- migraciones; se creó a mano en producción).
--
-- Visto el 2026-11-23 con explain analyze como admin: después de
-- 2026-11-23_side_events_guests_rls_rapida.sql, leer side_events_guests
-- seguía tardando ~950 ms en la base porque esta política permisiva llama
-- can_manage_side_event(side_events_id) en CADA fila. Las permisivas se
-- combinan con OR y Postgres la evaluaba primero, así que la nuestra (que se
-- calcula una sola vez, InitPlan) ni se ejecutaba.
--
-- No cambia quién tiene acceso: la restrictiva side_events_guests_solo_gestion
-- (misma regla que side_events_guests_gestion) se aplica con AND sobre todas,
-- así que esta política no dejaba pasar a nadie que la nuestra no deje pasar.
-- can_manage_side_event(bigint) se queda por si otra cosa la usa.

drop policy if exists side_events_guests_gestor on public.side_events_guests;

-- Comprobar: en pg_policies de side_events_guests solo quedan
-- side_events_guests_gestion (permisiva) y side_events_guests_solo_gestion
-- (restrictiva), y el explain analyze ya no lleva can_manage_side_event en
-- el Filter.
