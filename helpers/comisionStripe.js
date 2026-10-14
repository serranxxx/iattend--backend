const Stripe = require('stripe');
const supabase = require('../config/supabase');

// Lo que Stripe se queda de un pago en línea, para que el ingreso del Admin sea
// lo que de verdad llega a la cuenta y no lo que pagó el cliente.
//
// Stripe lo cobra en tres partes (todas con su IVA):
//   1. La comisión del cargo (balance_transaction.fee del charge).
//   2. Meses sin intereses: un cargo aparte (type stripe_fee) al día siguiente,
//      "Installments (YYYY-MM-DD): Transaction", que junta todos los cargos a
//      meses de ese día (UTC). Se reparte entre ellos según su monto.
//   3. Stripe Climate (type contribution), si está activo en la cuenta.
// Mientras el de MSI no aparece se estima con la tarifa y el pago queda como
// no final; conciliarComisionesStripe lo corrige después.

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Lo que Stripe se queda en total (cargo + MSI, con IVA) por plazo, según la
// tabla de tarifas del dueño. Solo para estimar mientras llega el cobro real.
const TASA_TOTAL = { 0: 0.0426, 3: 0.1005, 6: 0.1295, 9: 0.1585, 12: 0.1875 };
// Stripe Climate se registra en el mismo momento que el cargo.
const VENTANA_CLIMATE_S = 300;

const pesos = (centavos) => Number(centavos || 0) / 100;
const redondear = (n) => Math.round(n * 100) / 100;
const diaUtc = (segundos) => new Date(segundos * 1000).toISOString().slice(0, 10);

const movimientos = (desde, hasta, type) => stripe.balanceTransactions
    .list({ created: { gte: desde, lt: hasta }, type, limit: 100 })
    .autoPagingToArray({ limit: 1000 });

const mesesDe = (charge) => charge?.payment_method_details?.card?.installments?.plan?.count ?? 0;

// Parte de este cargo en el cobro de MSI de su día, o null si Stripe aún no lo cobra.
async function msiReal(charge) {
    const dia = diaUtc(charge.created);
    const inicioDia = Math.floor(Date.parse(`${dia}T00:00:00Z`) / 1000);
    const cobros = await movimientos(inicioDia, inicioDia + 4 * 86400, 'stripe_fee');
    const delDia = cobros.filter(bt => (bt.description || '').includes(`Installments (${dia})`));
    if (!delDia.length) return null;
    // net: el monto más el IVA de la tarifa, que viene aparte en fee.
    const total = delDia.reduce((acc, bt) => acc - pesos(bt.net), 0);

    // Los cargos a meses de ese día, para repartir.
    const cargos = await stripe.charges
        .list({ created: { gte: inicioDia, lt: inicioDia + 86400 }, limit: 100 })
        .autoPagingToArray({ limit: 1000 });
    const aMeses = cargos.filter(c => c.paid && mesesDe(c) > 0);
    const suma = aMeses.reduce((acc, c) => acc + c.amount, 0);
    if (!suma) return total;
    return total * (charge.amount / suma);
}

async function climate(charge) {
    const cerca = await movimientos(charge.created - 5, charge.created + VENTANA_CLIMATE_S, 'contribution');
    if (!cerca.length) return 0;
    const masCercano = cerca.sort((a, b) => Math.abs(a.created - charge.created) - Math.abs(b.created - charge.created))[0];
    return -pesos(masCercano.amount);
}

// { comision, final } de una Checkout Session, o null si no tiene cargo.
async function costoStripeDeSesion(sessionId) {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['payment_intent.latest_charge.balance_transaction'],
    });
    const charge = session.payment_intent?.latest_charge;
    if (!charge || typeof charge !== 'object') return null;

    const bt = typeof charge.balance_transaction === 'object' ? charge.balance_transaction : null;
    let comision = bt ? pesos(bt.fee) : pesos(charge.amount) * TASA_TOTAL[0];
    let final = Boolean(bt);

    const meses = mesesDe(charge);
    if (meses) {
        const real = await msiReal(charge);
        if (real != null) {
            comision += real;
        } else {
            const tasa = TASA_TOTAL[meses] ?? TASA_TOTAL[12];
            comision = Math.max(comision, pesos(charge.amount) * tasa);
            final = false;
        }
    }

    comision += await climate(charge);
    return { comision: redondear(comision), final };
}

// Calcula y guarda la comisión de los pagos de Stripe que no la tienen final.
// Nunca lanza: si Stripe falla, el pago se queda como estaba.
async function conciliarComisionesStripe({ pagoIds } = {}) {
    let query = supabase
        .from('pagos')
        .select('id, referencia')
        .eq('metodo', 'stripe')
        .eq('comision_stripe_final', false);
    if (pagoIds?.length) query = query.in('id', pagoIds);

    const { data: pagos, error } = await query;
    if (error) {
        console.error('No se pudieron leer los pagos de Stripe:', error.message);
        return 0;
    }

    let actualizados = 0;
    for (const pago of pagos || []) {
        if (!String(pago.referencia || '').startsWith('cs_')) continue;
        try {
            const costo = await costoStripeDeSesion(pago.referencia);
            if (!costo) continue;
            const { error: updError } = await supabase
                .from('pagos')
                .update({ comision_stripe: costo.comision, comision_stripe_final: costo.final })
                .eq('id', pago.id);
            if (updError) throw updError;
            actualizados += 1;
        } catch (e) {
            console.error(`Comisión de Stripe del pago ${pago.id}:`, e.message || e);
        }
    }
    return actualizados;
}

module.exports = { costoStripeDeSesion, conciliarComisionesStripe };
