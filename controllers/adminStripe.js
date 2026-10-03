const { response } = require('express');
const Stripe = require('stripe');

// Panel de Stripe dentro de Admin → Ventas → Stripe. Solo lectura: nada de
// reembolsar ni mover dinero desde aquí (eso se queda en el dashboard de Stripe).

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PAGOS_RECIENTES = 25;
const DIAS_ABANDONADOS = 14;

const pesos = (centavos) => Number(centavos || 0) / 100;

const montoPorMoneda = (lista = []) => lista
    .map(b => ({ moneda: b.currency, monto: pesos(b.amount) }))
    .sort((a, b) => (a.moneda === 'mxn' ? -1 : b.moneda === 'mxn' ? 1 : 0));

const deposito = (p) => ({
    id: p.id,
    monto: pesos(p.amount),
    moneda: p.currency,
    estado: p.status, // paid · pending · in_transit · canceled · failed
    llega: p.arrival_date ? new Date(p.arrival_date * 1000).toISOString() : null,
    creado: new Date(p.created * 1000).toISOString(),
});

// GET /api/admin/stripe/resumen
const resumenStripe = async (req, res = response) => {
    try {
        const desdeAbandonados = Math.floor(Date.now() / 1000) - DIAS_ABANDONADOS * 86400;

        const [balance, depositos, cargos, disputas, expiradas] = await Promise.all([
            stripe.balance.retrieve(),
            stripe.payouts.list({ limit: 10 }),
            stripe.charges.list({ limit: PAGOS_RECIENTES, expand: ['data.balance_transaction'] }),
            stripe.disputes.list({ limit: 20 }),
            stripe.checkout.sessions.list({ limit: 30, status: 'expired', created: { gte: desdeAbandonados } }),
        ]);

        const pagos = cargos.data.map(c => {
            const bt = typeof c.balance_transaction === 'object' ? c.balance_transaction : null;
            return {
                id: c.id,
                creado: new Date(c.created * 1000).toISOString(),
                monto: pesos(c.amount),
                moneda: c.currency,
                comision: bt ? pesos(bt.fee) : null,
                neto: bt ? pesos(bt.net) : null,
                estado: c.refunded ? 'reembolsado' : c.amount_refunded > 0 ? 'reembolso_parcial' : c.disputed ? 'disputado' : c.status,
                reembolsado: pesos(c.amount_refunded),
                correo: c.billing_details?.email || c.receipt_email || null,
                nombre: c.billing_details?.name || null,
                descripcion: c.description || null,
                tarjeta: c.payment_method_details?.card
                    ? `${c.payment_method_details.card.brand} •••• ${c.payment_method_details.card.last4}`
                    : c.payment_method_details?.type || null,
                recibo: c.receipt_url || null,
            };
        });

        // Las que piden respuesta primero: tienen fecha límite.
        const PIDEN_RESPUESTA = ['needs_response', 'warning_needs_response'];
        const disputasAbiertas = disputas.data
            .filter(d => !['won', 'lost', 'warning_closed'].includes(d.status))
            .map(d => ({
                id: d.id,
                monto: pesos(d.amount),
                moneda: d.currency,
                motivo: d.reason,
                estado: d.status,
                piden_respuesta: PIDEN_RESPUESTA.includes(d.status),
                limite: d.evidence_details?.due_by ? new Date(d.evidence_details.due_by * 1000).toISOString() : null,
                cargo: typeof d.charge === 'string' ? d.charge : d.charge?.id,
            }))
            .sort((a, b) => Number(b.piden_respuesta) - Number(a.piden_respuesta));

        // Checkouts que se abrieron y no se pagaron: posibles clientes a seguir.
        const abandonados = expiradas.data
            .filter(s => s.mode === 'payment')
            .map(s => ({
                id: s.id,
                creado: new Date(s.created * 1000).toISOString(),
                monto: pesos(s.amount_total),
                moneda: s.currency,
                correo: s.customer_details?.email || s.customer_email || null,
                nombre: s.customer_details?.name || null,
            }));

        const proximos = depositos.data.filter(p => ['pending', 'in_transit'].includes(p.status)).map(deposito);
        const recientes = depositos.data.filter(p => p.status === 'paid').slice(0, 5).map(deposito);

        return res.status(200).json({
            ok: true,
            modo: cargos.data[0] ? (cargos.data[0].livemode ? 'live' : 'test') : null,
            saldo: {
                disponible: montoPorMoneda(balance.available),
                pendiente: montoPorMoneda(balance.pending),
            },
            depositos: { proximos, recientes },
            pagos,
            disputas: disputasAbiertas,
            abandonados,
        });
    } catch (error) {
        console.error('Error leyendo Stripe:', error.message);
        return res.status(502).json({ ok: false, msg: `Stripe: ${error.message}` });
    }
};

// Comisiones de Stripe de un mes, por día (YYYY-MM-DD, hora de CDMX), para
// descontarlas del ingreso neto en Hoy.
// GET /api/admin/stripe/comisiones?anio=2026&mes=9
const comisionesStripe = async (req, res = response) => {
    const anio = Number(req.query.anio);
    const mes = Number(req.query.mes);
    if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) {
        return res.status(400).json({ ok: false, msg: 'anio y mes son requeridos' });
    }

    try {
        // El mes en hora de CDMX (UTC-6, sin horario de verano desde 2022).
        const desde = Math.floor(Date.UTC(anio, mes - 1, 1, 6) / 1000);
        const hasta = Math.floor(Date.UTC(anio, mes, 1, 6) / 1000);

        const movimientos = await stripe.balanceTransactions
            .list({ created: { gte: desde, lt: hasta }, limit: 100 })
            .autoPagingToArray({ limit: 5000 });

        const porDia = {};
        let total = 0;
        movimientos.forEach(bt => {
            // `fee` ya trae el IVA de la comisión. Las tarifas sueltas de Stripe
            // (type stripe_fee) vienen como monto negativo.
            const comision = bt.type === 'stripe_fee' ? -pesos(bt.amount) : pesos(bt.fee);
            if (!comision) return;
            const dia = new Date((bt.created - 6 * 3600) * 1000).toISOString().slice(0, 10);
            porDia[dia] = (porDia[dia] || 0) + comision;
            total += comision;
        });

        return res.status(200).json({ ok: true, total, porDia });
    } catch (error) {
        console.error('Error leyendo comisiones de Stripe:', error.message);
        return res.status(502).json({ ok: false, msg: `Stripe: ${error.message}` });
    }
};

module.exports = { resumenStripe, comisionesStripe };
