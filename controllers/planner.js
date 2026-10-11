const { response } = require('express');
const Stripe = require('stripe');
const supabase = require('../config/supabase');
const { getPlan } = require('../config/plans');
const { resolveInstallmentLookupKey, installmentsOptions } = require('../config/stripe.installments');
const { validarCliente, validarEvento, urlOcupada, resolverCliente, enviarBienvenida, crearEventoDeCliente } = require('../helpers/clientEvent');
const { beneficiosDe, cuponDePorcentaje } = require('../helpers/plannerBenefits');
const { precioFlash, validarFlash, crearFlashEvent } = require('../helpers/flashEvent');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Alta de eventos de un planner para sus clientes (rutas /api/planner, ver
// router/planner.js). Igual que /sales: crea la cuenta del cliente, su
// invitación y le manda su usuario y contraseña; el planner queda asignado.
//   - gratis: consume uno de sus eventos gratis (siempre PRO). Administración
//     crea sin costo y sin gastar eventos gratis.
//   - compra: pasa por Stripe con su descuento; la invitación la crea el
//     webhook al confirmarse el pago (finalizarEventoPlanner).
// Con `enviar_despues` el evento nace sin cliente (user_id vacío) y el planner
// se lo manda cuando quiera (asignarCliente).

const PLANES_COMPRA = ['lite', 'pro'];
const ORIGENES = /^https?:\/\/(localhost:\d+|(www\.)?iattend\.(site|mx))$/;

const beneficios = async (req, res = response) => {
    try {
        return res.json({ ok: true, beneficios: await beneficiosDe(req.plannerId) });
    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message });
    }
};

const crearEventoGratis = async (req, res = response) => {
    const { error: invalido, datos } = validarEvento(req.body);
    if (invalido) return res.status(400).json({ ok: false, msg: invalido });

    try {
        if (await urlOcupada(datos.url_evento)) {
            return res.status(409).json({ ok: false, msg: 'La URL del evento ya está en uso' });
        }

        // Administración crea sin costo y sin gastar eventos gratis.
        if (!req.esAdmin) {
            const { data: hayEvento, error: rpcError } = await supabase
                .rpc('consumir_evento_gratis', { p_planner_id: req.plannerId });
            if (rpcError) return res.status(500).json({ ok: false, msg: rpcError.message });
            if (!hayEvento) return res.status(409).json({ ok: false, msg: 'Ya no tienes eventos gratis disponibles' });
        }

        let evento;
        try {
            evento = await crearEventoDeCliente(datos, { plan: 'pro', plannerId: req.plannerId });
        } catch (error) {
            if (!req.esAdmin) await supabase.rpc('devolver_evento_gratis', { p_planner_id: req.plannerId });
            return res.status(error.status || 500).json({ ok: false, msg: error.message });
        }

        const { error: logError } = await supabase.from('planner_events').insert({
            planner_id: req.plannerId,
            invitation_id: evento.invitationId,
            tipo: 'gratis',
            estado: 'completado',
            plan: 'pro',
            monto: 0,
            payload: { ...datos, ...(req.esAdmin ? { creadoPorAdmin: true } : {}) },
            completed_at: new Date().toISOString(),
        });
        if (logError) console.error('No se pudo registrar el evento gratis del planner:', logError.message);

        return res.status(201).json({
            ok: true,
            invitation_id: evento.invitationId,
            url_publica: evento.urlPublica,
            cliente_existente: evento.clienteExistente,
            sin_cliente: evento.sinCliente,
        });
    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message });
    }
};

const checkoutEvento = async (req, res = response) => {
    const { error: invalido, datos } = validarEvento(req.body);
    if (invalido) return res.status(400).json({ ok: false, msg: invalido });

    const plan = String(req.body.plan || '').toLowerCase();
    if (!PLANES_COMPRA.includes(plan)) return res.status(400).json({ ok: false, msg: 'Plan inválido' });

    const origen = ORIGENES.test(req.body.origin || '') ? req.body.origin : (process.env.CLIENT_URL || 'https://www.iattend.site');

    try {
        if (await urlOcupada(datos.url_evento)) {
            return res.status(409).json({ ok: false, msg: 'La URL del evento ya está en uso' });
        }

        // Precio: contado (el del catálogo) o un plazo de meses del mismo plan.
        let priceId;
        let months = 0;
        const { lookupKey } = req.body;
        if (lookupKey) {
            if (!String(lookupKey).startsWith(`${plan}_msi_`)) return res.status(400).json({ ok: false, msg: 'Plazo no válido para este plan' });
            const msi = await resolveInstallmentLookupKey(lookupKey);
            if (!msi) return res.status(400).json({ ok: false, msg: 'Plazo de meses sin intereses no válido' });
            priceId = msi.priceId;
            months = msi.months;
        } else {
            priceId = (await getPlan(plan))?.stripe_price_id;
            if (!priceId) return res.status(500).json({ ok: false, msg: 'El plan no tiene precio configurado' });
        }

        const { discount_pct } = await beneficiosDe(req.plannerId);

        const { data: pendiente, error: pendienteError } = await supabase
            .from('planner_events')
            .insert({
                planner_id: req.plannerId,
                tipo: 'compra',
                estado: 'pendiente',
                plan,
                descuento_pct: discount_pct,
                payload: datos,
            })
            .select('id')
            .single();
        if (pendienteError) return res.status(500).json({ ok: false, msg: pendienteError.message });

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            mode: 'payment',
            line_items: [{ price: priceId, quantity: 1 }],
            payment_method_options: installmentsOptions(months),
            ...(discount_pct ? { discounts: [{ coupon: await cuponDePorcentaje(discount_pct) }] } : {}),
            customer_email: req.plannerEmail || undefined,
            metadata: {
                plannerEventId: pendiente.id,
                plannerId: req.plannerId,
                userEmail: req.plannerEmail || '',
                priceId,
                ...(months ? { msiMonths: String(months), lookupKey } : {}),
                ...(discount_pct ? { plannerDiscountPct: String(discount_pct) } : {}),
            },
            success_url: `${origen}/invitations?evento_planner=ok`,
            cancel_url: `${origen}/invitations`,
        });

        await supabase.from('planner_events').update({ stripe_session_id: session.id }).eq('id', pendiente.id);

        return res.json({ ok: true, url: session.url });
    } catch (error) {
        console.error('Error creando checkout de evento de planner:', error.message);
        return res.status(500).json({ ok: false, msg: 'No se pudo iniciar el pago' });
    }
};

/**
 * Reclama de un solo golpe la fila del evento pagado: pasa a 'procesando' solo
 * si estaba 'pendiente' o 'fallido'. Si Stripe manda el aviso dos veces (pasa:
 * crear la cuenta y mandar el correo tarda), el segundo no encuentra nada que
 * reclamar y no crea el evento otra vez. Sin la migración
 * 2026-10-10g_planner_events_procesando.sql el estado no existe (23514) y se
 * sigue como antes: leer y revisar que no esté completado.
 * @returns {Promise<object|null>} la fila reclamada, o null si no hay nada que hacer
 */
async function reclamarEventoPagado(id) {
    const { data, error } = await supabase
        .from('planner_events')
        .update({ estado: 'procesando' })
        .eq('id', id)
        .in('estado', ['pendiente', 'fallido'])
        .select('*')
        .maybeSingle();
    if (!error) return data;
    if (error.code !== '23514') throw new Error(error.message);

    const { data: pendiente } = await supabase.from('planner_events').select('*').eq('id', id).maybeSingle();
    return pendiente && pendiente.estado !== 'completado' ? pendiente : null;
}

/**
 * Webhook (checkout.session.completed con metadata.plannerEventId): crea el
 * evento ya pagado. Idempotente: un reintento del webhook no lo duplica
 * (reclamarEventoPagado). Si falla (ej. alguien tomó la URL mientras pagaba)
 * el pago ya se cobró: queda 'fallido' con un reporte en Admin → Buzón → Reportes.
 */
async function finalizarEventoPlanner(session) {
    const id = session.metadata?.plannerEventId;
    if (!id) return;
    const pendiente = await reclamarEventoPagado(id);
    if (!pendiente) return;

    const monto = Number(session.amount_total ?? 0) / 100;

    try {
        const esFlash = pendiente.kind === 'flash';
        const evento = esFlash
            ? await crearFlashEvent(pendiente.payload, { plannerId: pendiente.planner_id, plannerEmail: pendiente.payload?.plannerEmail })
            : await crearEventoDeCliente(pendiente.payload, { plan: pendiente.plan, plannerId: pendiente.planner_id });
        await supabase.from('planner_events').update({
            estado: 'completado',
            invitation_id: evento.invitationId ?? null,
            side_event_id: evento.sideEventId ?? null,
            monto,
            stripe_session_id: session.id,
            completed_at: new Date().toISOString(),
            error: null,
        }).eq('id', id);
    } catch (error) {
        console.error('Evento de planner pagado sin crear:', error.message);
        await supabase.from('planner_events').update({ estado: 'fallido', monto, error: error.message }).eq('id', id);
        await supabase.from('support_tickets').insert({
            topic: 'help',
            body: [
                'Evento de planner pagado que no se pudo crear.',
                `Motivo: ${error.message}`,
                pendiente.kind === 'flash'
                    ? `Evento Flash: ${pendiente.payload?.nombre}`
                    : `URL pedida: ${pendiente.payload?.url_evento}`,
                `Cliente: ${pendiente.payload?.correo || "(para enviar después)"}`,
                `Plan: ${pendiente.plan} · Monto: $${monto.toLocaleString('es-MX')}`,
                `planner_events: ${id} · Sesión de Stripe: ${session.id}`,
            ].join('\n'),
            user_id: pendiente.planner_id,
            user_email: session.metadata?.userEmail || null,
        });
    }
}

/**
 * POST /api/planner/eventos/:id/cliente  { correo_cliente, nombre_cliente }
 * Manda al cliente un evento creado "para enviar después": crea su cuenta (o
 * usa la que ya tiene), pone su user_id en la invitación y, si la cuenta es
 * nueva, le manda su usuario y contraseña. No crea otra invitación.
 */
const asignarCliente = async (req, res = response) => {
    const { error: invalido, cliente } = validarCliente(req.body);
    if (invalido) return res.status(400).json({ ok: false, msg: invalido });

    try {
        const { data: invitacion, error } = await supabase
            .from('invitations')
            .select('id, user_id, planner_id, owners')
            .eq('id', req.params.id)
            .maybeSingle();
        if (error) return res.status(500).json({ ok: false, msg: error.message });
        if (!invitacion || invitacion.planner_id !== req.plannerId) {
            return res.status(404).json({ ok: false, msg: 'Evento no encontrado' });
        }
        if (invitacion.user_id) return res.status(409).json({ ok: false, msg: 'Este evento ya se le envió a un cliente' });

        const cuenta = await resolverCliente({ ...cliente, ownerNames: invitacion.owners ?? [] });

        // Solo si sigue sin dueño: dos envíos a la vez no se pisan.
        const { data: asignada, error: updateError } = await supabase
            .from('invitations')
            .update({ user_id: cuenta.userId, user_email: cliente.correo })
            .eq('id', invitacion.id)
            .is('user_id', null)
            .select('id')
            .maybeSingle();
        if (updateError || !asignada) {
            await cuenta.borrarCuenta();
            return res.status(updateError ? 500 : 409).json({
                ok: false,
                msg: updateError?.message || 'Este evento ya se le envió a un cliente',
            });
        }

        if (cuenta.cuentaNueva) await enviarBienvenida(cliente.correo, cuenta.password);

        return res.json({ ok: true, cliente_existente: !cuenta.cuentaNueva });
    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message });
    }
};

// ── Eventos Flash (helpers/flashEvent.js) ──

// GET /api/planner/flash/precio → precio de lista y el descuento del planner.
const precioEventoFlash = async (req, res = response) => {
    try {
        const [{ amount, currency }, { discount_pct }] = await Promise.all([precioFlash(), beneficiosDe(req.plannerId)]);
        return res.json({ ok: true, amount, currency, discount_pct });
    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message });
    }
};

// POST /api/planner/flash  — con uno de sus Eventos Flash gratis.
const crearFlashGratis = async (req, res = response) => {
    const { error: invalido, datos } = validarFlash(req.body);
    if (invalido) return res.status(400).json({ ok: false, msg: invalido });

    try {
        if (!req.esAdmin) {
            const { data: hayEvento, error: rpcError } = await supabase
                .rpc('consumir_evento_flash_gratis', { p_planner_id: req.plannerId });
            if (rpcError) return res.status(500).json({ ok: false, msg: rpcError.message });
            if (!hayEvento) return res.status(409).json({ ok: false, msg: 'Ya no tienes Eventos Flash gratis disponibles' });
        }

        let flash;
        try {
            flash = await crearFlashEvent(datos, { plannerId: req.plannerId, plannerEmail: req.plannerEmail });
        } catch (error) {
            if (!req.esAdmin) await supabase.rpc('devolver_evento_flash_gratis', { p_planner_id: req.plannerId });
            return res.status(500).json({ ok: false, msg: error.message });
        }

        const { error: logError } = await supabase.from('planner_events').insert({
            planner_id: req.plannerId,
            kind: 'flash',
            side_event_id: flash.sideEventId,
            tipo: 'gratis',
            estado: 'completado',
            plan: 'flash',
            monto: 0,
            payload: { ...datos, ...(req.esAdmin ? { creadoPorAdmin: true } : {}) },
            completed_at: new Date().toISOString(),
        });
        if (logError) console.error('No se pudo registrar el Evento Flash gratis:', logError.message);

        return res.status(201).json({
            ok: true,
            side_event_id: flash.sideEventId,
            url_publica: flash.urlPublica,
            cliente_existente: flash.clienteExistente,
            sin_cliente: flash.sinCliente,
        });
    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message });
    }
};

// POST /api/planner/flash/checkout — Stripe con su descuento; lo crea el webhook.
const checkoutFlash = async (req, res = response) => {
    const { error: invalido, datos } = validarFlash(req.body);
    if (invalido) return res.status(400).json({ ok: false, msg: invalido });

    const origen = ORIGENES.test(req.body.origin || '') ? req.body.origin : (process.env.CLIENT_URL || 'https://www.iattend.site');

    try {
        const [{ priceId }, { discount_pct }] = await Promise.all([precioFlash(), beneficiosDe(req.plannerId)]);

        const { data: pendiente, error: pendienteError } = await supabase
            .from('planner_events')
            .insert({
                planner_id: req.plannerId,
                kind: 'flash',
                tipo: 'compra',
                estado: 'pendiente',
                plan: 'flash',
                descuento_pct: discount_pct,
                payload: { ...datos, plannerEmail: req.plannerEmail },
            })
            .select('id')
            .single();
        if (pendienteError) return res.status(500).json({ ok: false, msg: pendienteError.message });

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            mode: 'payment',
            line_items: [{ price: priceId, quantity: 1 }],
            ...(discount_pct ? { discounts: [{ coupon: await cuponDePorcentaje(discount_pct) }] } : {}),
            customer_email: req.plannerEmail || undefined,
            metadata: {
                plannerEventId: pendiente.id,
                plannerId: req.plannerId,
                userEmail: req.plannerEmail || '',
                priceId,
                ...(discount_pct ? { plannerDiscountPct: String(discount_pct) } : {}),
            },
            success_url: `${origen}/invitations?evento_planner=ok`,
            cancel_url: `${origen}/invitations`,
        });

        await supabase.from('planner_events').update({ stripe_session_id: session.id }).eq('id', pendiente.id);

        return res.json({ ok: true, url: session.url });
    } catch (error) {
        console.error('Error creando checkout de Evento Flash:', error.message);
        return res.status(500).json({ ok: false, msg: 'No se pudo iniciar el pago' });
    }
};

/**
 * POST /api/planner/flash/:id/cliente  { correo_cliente, nombre_cliente }
 * Manda a su cliente un Evento Flash creado "para enviar después".
 */
const asignarClienteFlash = async (req, res = response) => {
    const { error: invalido, cliente } = validarCliente(req.body);
    if (invalido) return res.status(400).json({ ok: false, msg: invalido });

    try {
        const { data: flash, error } = await supabase
            .from('side_events')
            .select('id, user_id, planner_id, invitation_id')
            .eq('id', req.params.id)
            .maybeSingle();
        if (error) return res.status(500).json({ ok: false, msg: error.message });
        if (!flash || flash.invitation_id || flash.planner_id !== req.plannerId) {
            return res.status(404).json({ ok: false, msg: 'Evento no encontrado' });
        }
        if (flash.user_id) return res.status(409).json({ ok: false, msg: 'Este evento ya se le envió a un cliente' });

        const cuenta = await resolverCliente(cliente);
        const { data: asignado, error: updateError } = await supabase
            .from('side_events')
            .update({ user_id: cuenta.userId, user_email: cliente.correo })
            .eq('id', flash.id)
            .is('user_id', null)
            .select('id')
            .maybeSingle();
        if (updateError || !asignado) {
            await cuenta.borrarCuenta();
            return res.status(updateError ? 500 : 409).json({ ok: false, msg: updateError?.message || 'Este evento ya se le envió a un cliente' });
        }

        if (cuenta.cuentaNueva) await enviarBienvenida(cliente.correo, cuenta.password);
        return res.json({ ok: true, cliente_existente: !cuenta.cuentaNueva });
    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message });
    }
};

module.exports = {
    beneficios, crearEventoGratis, checkoutEvento, asignarCliente, finalizarEventoPlanner,
    precioEventoFlash, crearFlashGratis, checkoutFlash, asignarClienteFlash,
};
