-- side_events_guests: misma regla de acceso, evaluada UNA vez por consulta.
--
-- Problema (visto el 2026-11-23 en Admin → Eventos → Pops): leer
-- side_events_guests tardaba 1.5–3 s por cada página de 1000 filas, y solo el
-- count(*) 3.2 s. Las políticas de 2026-11-11_side_events_rls.sql llaman
-- public.puede_gestionar_side_event(side_events_id) en CADA fila, y dos veces
-- (la permisiva y la restrictiva): cada llamada lee side_events y luego
-- can_manage_invitation / profiles. Con ~2,500 invitados son miles de
-- subconsultas por lectura. Le pega al admin, al editor del Pop (lista de
-- invitados) y a las listas del planner (useConfirmados).
--
-- Arreglo: public.side_events_que_gestiono() devuelve de una vez los ids de
-- side events que la sesión gestiona (misma regla:
-- puede_gestionar_side_event_fila; Administration = todos). En la política va
-- envuelta en (select …): Postgres la vuelve un InitPlan y la calcula una sola
-- vez por consulta, no por fila. La regla no cambia: solo cuándo se evalúa.
--
-- puede_gestionar_side_event(bigint) se queda (la pueden usar RPC u otras
-- políticas).

begin;

create or replace function public.side_events_que_gestiono()
returns bigint[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when auth.uid() is null then '{}'::bigint[]
    when public.es_admin_activo() then
      coalesce((select array_agg(s.id) from public.side_events s), '{}'::bigint[])
    else
      coalesce((
        select array_agg(s.id)
          from public.side_events s
         where public.puede_gestionar_side_event_fila(s.invitation_id, s.user_id, s.planner_id)
      ), '{}'::bigint[])
  end;
$$;

revoke all on function public.side_events_que_gestiono() from public;
grant execute on function public.side_events_que_gestiono() to authenticated;

drop policy if exists side_events_guests_gestion on public.side_events_guests;
drop policy if exists side_events_guests_solo_gestion on public.side_events_guests;

create policy side_events_guests_gestion on public.side_events_guests
  for all to authenticated
  using (side_events_id = any ((select public.side_events_que_gestiono())::bigint[]))
  with check (side_events_id = any ((select public.side_events_que_gestiono())::bigint[]));

create policy side_events_guests_solo_gestion on public.side_events_guests
  as restrictive for all to public
  using (side_events_id = any ((select public.side_events_que_gestiono())::bigint[]))
  with check (side_events_id = any ((select public.side_events_que_gestiono())::bigint[]));

-- Para filtrar por evento (editor del Pop, conteos) sin recorrer la tabla.
create index if not exists side_events_guests_side_events_id_idx
  on public.side_events_guests (side_events_id);

commit;

-- Comprobar (con la sesión de un admin en la app, o en el SQL editor):
--   explain analyze select id, side_events_id from public.side_events_guests;
-- Debe salir "InitPlan 1" una sola vez y no SubPlan por fila.
