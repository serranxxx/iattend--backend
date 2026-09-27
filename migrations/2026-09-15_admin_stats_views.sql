-- Dashboard de productos (Admin → Eventos → Analítica)
-- Correr en el SQL editor de Supabase (o psql con service role).
--
-- Son vistas de solo lectura: no crean tablas ni tocan datos. Se pueden borrar y
-- volver a crear sin riesgo.
--
-- Por qué vistas y no agregación en el navegador: hoy son 6.7k invitados y 3.1k
-- envíos; traerlos al cliente para contarlos baja varios MB por carga y empeora
-- cada mes. Agregado en Postgres, el dashboard baja kilobytes.
--
-- NOTA sobre invitaciones de prueba: la lista de correos internos vive en el
-- frontend (src/pages/Admin/adminConstants.js). Estas vistas NO filtran nada y
-- exponen `user_email` para que el filtro siga teniendo un solo dueño.

-- ---------------------------------------------------------------------------
-- 1. Una fila por invitación, con todos sus productos ya contados.
--    55-80 filas: el dashboard puede agrupar esto en el cliente sin costo, y
--    además sirve para el detalle por evento.
-- ---------------------------------------------------------------------------
create or replace view public.admin_evento_stats as
select
    i.id,
    i.name,
    i.user_email,
    i.plan,
    i.type,
    i.label,
    i.event_date,
    i.created_at,
    i.credits,
    i.tickets,
    i.active,
    i.started,
    i.rsvp_deadline,

    -- Invitados y su embudo de respuesta
    coalesce(g.total, 0)                         as invitados_total,
    coalesce(g.confirmados, 0)                   as invitados_confirmados,
    coalesce(g.rechazados, 0)                    as invitados_rechazados,
    coalesce(g.sin_responder, 0)                 as invitados_sin_responder,
    coalesce(g.con_mesa, 0)                      as invitados_con_mesa,
    g.primera_alta,
    g.ultima_respuesta,

    -- Mesas
    coalesce(m.total, 0)                         as mesas_total,
    coalesce(m.capacidad, 0)                     as mesas_capacidad,

    -- Side events
    coalesce(se.total, 0)                        as side_events_total,
    coalesce(se.con_nombre, 0)                   as side_events_con_nombre,

    -- Envíos de invitación por WhatsApp
    coalesce(d.total, 0)                         as envios_total,
    coalesce(d.leidos, 0)                        as envios_leidos,
    coalesce(d.entregados, 0)                    as envios_entregados,
    coalesce(d.fallidos, 0)                      as envios_fallidos,

    -- Productos con adopción incipiente: interesa el sí/no, no la cantidad
    coalesce(std.total, 0)                       as save_the_dates,
    coalesce(ph.total, 0)                        as fotos_total,
    coalesce(fb.total, 0)                        as feedback_total,
    fb.rating_promedio,

    -- Cuánto se editó la invitación antes y después de publicar
    coalesce(v.total, 0)                         as versiones_total
from public.invitations i

left join lateral (
    select
        count(*)                                                        as total,
        count(*) filter (where state in ('confirmado', 'asistente'))     as confirmados,
        count(*) filter (where state = 'rechazado')                      as rechazados,
        count(*) filter (where state in ('creado', 'esperando'))         as sin_responder,
        count(*) filter (where "table" is not null)                      as con_mesa,
        min(created_at)                                                  as primera_alta,
        max(last_update_date)                                            as ultima_respuesta
    from public.guests
    where invitation_id = i.id
) g on true

left join lateral (
    select count(*) as total, coalesce(sum(size), 0) as capacidad
    from public.tables
    where invitation_id = i.id
) m on true

left join lateral (
    select count(*) as total, count(*) filter (where name is not null) as con_nombre
    from public.side_events
    where invitation_id = i.id
) se on true

left join lateral (
    select
        count(*)                                     as total,
        count(*) filter (where status = 'read')      as leidos,
        count(*) filter (where status = 'delivered') as entregados,
        count(*) filter (where status = 'failed')    as fallidos
    from public.invitation_message_dispatches
    where invitation_id = i.id
) d on true

left join lateral (
    select count(*) as total from public.save_the_dates where invitation_id = i.id
) std on true

-- Ojo: event_photos enlaza por `event_id`, no por `invitation_id` como el resto.
left join lateral (
    select count(*) as total from public.event_photos where event_id = i.id
) ph on true

left join lateral (
    select count(*) as total, avg(rating) as rating_promedio
    from public.event_feedback
    where invitation_id = i.id and status = 'submitted'
) fb on true

left join lateral (
    select count(*) as total from public.invitation_versions where invitation_id = i.id
) v on true;


-- ---------------------------------------------------------------------------
-- 2. Envíos de invitación, agregados por mes.
--    El embudo (sent → delivered → read → failed) más las latencias entre
--    etapas, que es lo que dice si el problema es de entrega o de lectura.
--
--    `error_code` se expone aunque hoy llegue siempre nulo: el día que el
--    webhook lo registre, la vista ya lo está contando.
-- ---------------------------------------------------------------------------
create or replace view public.admin_envios_stats as
select
    date_trunc('month', d.created_at)::date                             as mes,
    count(*)                                                            as total,
    count(*) filter (where d.status = 'read')                           as leidos,
    count(*) filter (where d.status = 'delivered')                      as entregados,
    count(*) filter (where d.status = 'sent')                           as enviados,
    count(*) filter (where d.status = 'processing')                     as en_proceso,
    count(*) filter (where d.status = 'failed')                         as fallidos,
    count(*) filter (where d.status = 'failed' and d.error_code is not null) as fallidos_con_causa,
    count(distinct d.invitation_id)                                     as eventos,

    -- Latencias en segundos; la mediana aguanta mejor los outliers que el promedio
    percentile_cont(0.5) within group (
        order by extract(epoch from (d.delivered_at - d.sent_at))
    ) filter (where d.delivered_at is not null and d.sent_at is not null)  as seg_a_entrega,
    percentile_cont(0.5) within group (
        order by extract(epoch from (d.read_at - d.delivered_at))
    ) filter (where d.read_at is not null and d.delivered_at is not null)  as seg_a_lectura
from public.invitation_message_dispatches d
group by 1
order by 1;


-- ---------------------------------------------------------------------------
-- 3. Causas de fallo. Hoy devuelve una sola fila con error_code nulo porque el
--    webhook no las registra — es un hueco conocido, no un bug de la vista.
-- ---------------------------------------------------------------------------
create or replace view public.admin_envios_fallos as
select
    coalesce(error_code::text, 'sin causa registrada') as error_code,
    coalesce(error_title, '—')                         as error_title,
    count(*)                                           as total,
    count(distinct invitation_id)                      as eventos
from public.invitation_message_dispatches
where status = 'failed'
group by 1, 2
order by 3 desc;


-- ---------------------------------------------------------------------------
-- 4. Recordatorios: sirven para saber si insistir funciona. Se agrupa por
--    número de recordatorio para ver si el 2º y 3º siguen teniendo efecto.
-- ---------------------------------------------------------------------------
create or replace view public.admin_recordatorios_stats as
select
    reminder_number,
    trigger_source,
    count(*)                                        as total,
    count(*) filter (where status = 'read')         as leidos,
    count(*) filter (where status = 'delivered')    as entregados,
    count(*) filter (where status = 'failed')       as fallidos,
    count(*) filter (where credit_charged)          as con_credito_cobrado,
    count(distinct invitation_id)                   as eventos
from public.invitation_reminder_dispatches
group by 1, 2
order by 1, 2;


-- ---------------------------------------------------------------------------
-- 5. Buzón: cuántos mensajes entran y cuántos siguen sin leer, por mes.
-- ---------------------------------------------------------------------------
create or replace view public.admin_buzon_stats as
select
    date_trunc('month', created_at)::date    as mes,
    count(*)                                 as recibidos,
    count(*) filter (where not read)         as sin_leer,
    count(distinct from_phone)               as remitentes
from public.whatsapp_incoming_messages
group by 1
order by 1;


-- Estas vistas se leen desde el backend con service role, detrás de
-- validarAdmin (mismo criterio que admin_gastos_fijos): no se exponen a la
-- anon key. Si algún día se leyeran directo desde el front, habría que dar
-- GRANT SELECT a `anon` — Postgres revisa el GRANT antes que las policies.
--
-- Comprobación rápida:
--   select count(*) from public.admin_evento_stats;
--   select * from public.admin_envios_stats order by mes desc limit 6;
--   select * from public.admin_envios_fallos;
