-- El editor de side events / Pops ya guarda name, url_image y body por el
-- backend (router/sideEventGuardar.js, POST /api/side-events/:id/guardar),
-- que valida lo que se guarda (planes de Pops). Aquí se le quita a
-- authenticated el UPDATE directo de esas columnas, para que no se pueda
-- saltar la validación desde la consola del navegador.
--
-- Correr SOLO cuando el backend con la ruta y el front que la usa
-- (vite src/modules/SideEvents/guardarSideEvent.js) estén desplegados: antes,
-- el editor caería al UPDATE directo y no podría guardar.
--
-- Se quedan con UPDATE directo (no son contenido del Pop): type,
-- rsvp_deadline y legacy_link_enabled. Insertar un side event de boda
-- (con body) también sigue igual.

begin;

revoke update on public.side_events from authenticated;

do $$
declare
  v_update text;
begin
  select string_agg(quote_ident(column_name), ', ') into v_update
    from information_schema.columns
   where table_schema = 'public' and table_name = 'side_events'
     and column_name in ('type', 'rsvp_deadline', 'legacy_link_enabled');
  execute format('grant update (%s) on public.side_events to authenticated', v_update);
end;
$$;

commit;

-- Comprobar:
--   select column_name from information_schema.column_privileges
--    where table_schema = 'public' and table_name = 'side_events'
--      and grantee = 'authenticated' and privilege_type = 'UPDATE';
-- Debe dar solo type, rsvp_deadline y legacy_link_enabled.
