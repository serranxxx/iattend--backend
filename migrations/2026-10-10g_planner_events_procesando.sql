-- Arreglos antes de producción de planners y Eventos Flash.
--
-- 1) planner_events.estado 'procesando': el webhook de Stripe reclama la fila
--    de un solo golpe (UPDATE ... WHERE estado IN ('pendiente','fallido')) antes
--    de crear el evento, así un aviso duplicado de Stripe no lo crea dos veces
--    (controllers/planner.js → finalizarEventoPlanner).
--
-- 2) Créditos de los Eventos Flash (side_events.credits) sin leer-y-escribir:
--    increment_side_event_credits  → backend (compras y reembolsos del worker)
--    consume_side_event_credits    → editor del Flash (solo resta, nunca baja
--                                    de 0; por eso puede llamarlo el front)
--
-- El backend funciona aunque esta migración todavía no esté: si no encuentra
-- el estado o las funciones, cae al comportamiento anterior.

alter table public.planner_events drop constraint if exists planner_events_estado_check;
alter table public.planner_events
  add constraint planner_events_estado_check check (estado in ('pendiente', 'procesando', 'completado', 'fallido'));

create or replace function public.increment_side_event_credits(p_side_event_id bigint, p_amount integer)
returns integer
language sql
as $$
  update public.side_events
     set credits = greatest(coalesce(credits, 0) + p_amount, 0)
   where id = p_side_event_id and invitation_id is null
  returning credits;
$$;

revoke all on function public.increment_side_event_credits(bigint, integer) from public, anon, authenticated;

create or replace function public.consume_side_event_credits(p_side_event_id bigint, p_amount integer)
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.side_events
     set credits = greatest(coalesce(credits, 0) - abs(p_amount), 0)
   where id = p_side_event_id and invitation_id is null
  returning credits;
$$;

revoke all on function public.consume_side_event_credits(bigint, integer) from public;
grant execute on function public.consume_side_event_credits(bigint, integer) to anon, authenticated;
