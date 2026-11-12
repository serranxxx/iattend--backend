-- Importar invitados desde Excel en un solo paso (invitados + acompañantes).
-- Correr en el SQL editor de Supabase.
--
-- Antes eran dos RPC (bulk_create_guests y bulk_set_guest_companions): si
-- fallaba la segunda, los invitados ya estaban guardados, el organizador veía
-- "error" y al reintentar se duplicaba la lista. Una función de plpgsql corre
-- en una sola transacción: o entra todo o nada.
--
-- p_rows: [{ name, phone_number, tag, type, tier, side, notes, meal,
--            special_needs (solo guests), password, companion_index }]
-- companion_index = posición (0-based) en este mismo arreglo de la persona a
-- la que acompaña. Mismas columnas y valores que bulk_create_guests
-- (2026-07-09_bulk_create_guests.sql).
--
-- Solo la llama el backend (service role): se le quita el permiso a anon y
-- authenticated. De paso, lo mismo a las dos RPC viejas, que hoy cualquiera
-- con la anon key podía llamar para meter invitados a cualquier evento.

create or replace function public.importar_invitados(
  p_invitation_id uuid,
  p_side_events_id bigint,
  p_rows jsonb
)
returns table(idx int, id bigint)
language plpgsql
as $$
declare
  ids bigint[] := '{}';
  nuevo bigint;
  r record;
begin
  if p_invitation_id is null and p_side_events_id is null then
    raise exception 'importar_invitados: falta el evento';
  end if;

  for r in
    select (t.ord - 1)::int as i, t.fila
    from jsonb_array_elements(p_rows) with ordinality as t(fila, ord)
    order by t.ord
  loop
    if p_side_events_id is null then
      insert into guests (
        invitation_id, name, phone_number, tag, type, tier, side,
        notes, meal, special_needs, password, state, last_action, last_action_by, ticket
      ) values (
        p_invitation_id,
        r.fila->>'name', r.fila->>'phone_number', r.fila->>'tag',
        (r.fila->>'type')::guest_type, r.fila->>'tier', r.fila->>'side',
        r.fila->>'notes', r.fila->>'meal', r.fila->>'special_needs', r.fila->>'password',
        'creado'::guest_state, 'creado', 'admin'::action_actor, true
      )
      returning guests.id into nuevo;
    else
      insert into side_events_guests (
        side_events_id, name, phone_number, tag, type, tier, side,
        notes, meal, password, state, last_action, last_action_by, ticket
      ) values (
        p_side_events_id,
        r.fila->>'name', r.fila->>'phone_number', r.fila->>'tag',
        (r.fila->>'type')::guest_type, r.fila->>'tier', r.fila->>'side',
        r.fila->>'notes', r.fila->>'meal', r.fila->>'password',
        'creado', 'creado', true, true
      )
      returning side_events_guests.id into nuevo;
    end if;
    ids := ids || nuevo;
  end loop;

  -- Acompañantes: B.companion_id = A.id y A.has_companion = true.
  if p_side_events_id is null then
    update guests g
      set companion_id = ids[(f.fila->>'companion_index')::int + 1]
      from jsonb_array_elements(p_rows) with ordinality as f(fila, ord)
      where g.id = ids[f.ord]
        and f.fila ? 'companion_index'
        and jsonb_typeof(f.fila->'companion_index') = 'number';
    update guests g
      set has_companion = true
      where g.id in (
        select ids[(f.fila->>'companion_index')::int + 1]
        from jsonb_array_elements(p_rows) as f(fila)
        where jsonb_typeof(f.fila->'companion_index') = 'number'
      );
  else
    update side_events_guests g
      set companion_id = ids[(f.fila->>'companion_index')::int + 1]
      from jsonb_array_elements(p_rows) with ordinality as f(fila, ord)
      where g.id = ids[f.ord]
        and f.fila ? 'companion_index'
        and jsonb_typeof(f.fila->'companion_index') = 'number';
    update side_events_guests g
      set has_companion = true
      where g.id in (
        select ids[(f.fila->>'companion_index')::int + 1]
        from jsonb_array_elements(p_rows) as f(fila)
        where jsonb_typeof(f.fila->'companion_index') = 'number'
      );
  end if;

  return query select (u.ord - 1)::int, u.gid from unnest(ids) with ordinality as u(gid, ord);
end;
$$;

revoke execute on function public.importar_invitados(uuid, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.importar_invitados(uuid, bigint, jsonb) to service_role;

revoke execute on function public.bulk_create_guests(uuid, bigint, text, jsonb) from public, anon, authenticated;
grant execute on function public.bulk_create_guests(uuid, bigint, text, jsonb) to service_role;
revoke execute on function public.bulk_set_guest_companions(text, jsonb) from public, anon, authenticated;
grant execute on function public.bulk_set_guest_companions(text, jsonb) to service_role;

-- PostgREST recarga el esquema para ver la función nueva.
notify pgrst, 'reload schema';
