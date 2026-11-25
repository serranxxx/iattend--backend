const Stripe = require('stripe');
const supabase = require('../config/supabase');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

/*
  Suscripción mensual de Pops+ ("Pops Pro" en Stripe, $259 MXN/mes con IVA).
  · Precio por lookup key `pops_pro_monthly` (nunca el id del precio).
  · La Checkout Session la crea el backend (router/popsSuscripcion.js) con
    `client_reference_id` y `metadata.userId`: así el pago queda ligado a la
    cuenta de I attend. El Payment Link de Stripe no se usa (no sabe de quién es).
  · El estado vive en `pops_suscripciones` (migración 2026-11-23c), una fila
    por cuenta, y lo escribe solo este archivo desde el webhook de Stripe.
  · Portal de cliente: configuración `bpc_1Uf503…` (cancelar al final del
    periodo, método de pago, facturas).
*/

const LOOKUP_KEY = 'pops_pro_monthly';
const PORTAL_CONFIG = 'bpc_1Uf503AAdNlITNVbgfG4aUSk';
const VIGENTE = ['active', 'trialing', 'past_due'];

let precioCache = null;
/** Id del precio vigente de Pops+ (por lookup key, con caché de 10 min). */
async function precioPlus() {
    if (precioCache && Date.now() - precioCache.at < 10 * 60 * 1000) return precioCache.id;
    const { data } = await stripe.prices.list({ lookup_keys: [LOOKUP_KEY], active: true, limit: 1 });
    if (!data?.[0]) throw new Error(`No hay precio activo con lookup key ${LOOKUP_KEY}`);
    precioCache = { id: data[0].id, at: Date.now() };
    return data[0].id;
}

/** ¿La suscripción es de Pops+? (por metadata o por la lookup key del precio). */
const esDePops = (sub) => sub?.metadata?.popsSuscripcion === '1'
    || (sub?.items?.data ?? []).some(i => i.price?.lookup_key === LOOKUP_KEY);

/** Fila de la cuenta, o null. */
async function suscripcionDe(userId) {
    const { data, error } = await supabase
        .from('pops_suscripciones').select('*').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return data;
}

const finDePeriodo = (sub) => {
    // API nueva: el periodo vive en cada item; la vieja, en la suscripción.
    const s = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end;
    return s ? new Date(s * 1000).toISOString() : null;
};

/**
 * Copia a `pops_suscripciones` el estado de una suscripción de Stripe.
 * La cuenta sale de `metadata.userId` o, si no, del customer ya guardado.
 */
async function sincronizarSuscripcion(sub, userIdRespaldo = null) {
    if (!sub || !esDePops(sub)) return;
    const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
    let userId = sub.metadata?.userId || userIdRespaldo;
    if (!userId && customer) {
        const { data } = await supabase
            .from('pops_suscripciones').select('user_id').eq('stripe_customer_id', customer).maybeSingle();
        userId = data?.user_id;
    }
    if (!userId) {
        console.error('[pops+] Suscripción sin cuenta de I attend:', sub.id);
        return;
    }

    // Una cuenta = una suscripción: si llega el aviso de otra vieja (ya
    // cancelada) que no es la guardada, no pisa a la vigente.
    const actual = await suscripcionDe(userId);
    if (actual?.stripe_subscription_id && actual.stripe_subscription_id !== sub.id
        && VIGENTE.includes(actual.status) && !VIGENTE.includes(sub.status)) {
        return;
    }

    const { error } = await supabase.from('pops_suscripciones').upsert({
        user_id: userId,
        plan: VIGENTE.includes(sub.status) ? 'plus' : 'free',
        status: sub.status,
        current_period_end: finDePeriodo(sub),
        cancel_at_period_end: Boolean(sub.cancel_at_period_end || sub.cancel_at),
        stripe_customer_id: customer || null,
        stripe_subscription_id: sub.id,
        updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (error) console.error('[pops+] No se pudo guardar la suscripción:', error.message);
}

/** checkout.session.completed en modo suscripción. */
async function suscripcionPagada(session) {
    if (session?.mode !== 'subscription' || session.metadata?.popsSuscripcion !== '1') return false;
    const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
    if (!subId) return true;
    const sub = await stripe.subscriptions.retrieve(subId);
    await sincronizarSuscripcion(sub, session.client_reference_id || session.metadata?.userId);
    return true;
}

/** Eventos de Stripe de la suscripción. Devuelve true si lo atendió. */
async function eventoDeSuscripcion(event) {
    switch (event.type) {
        case 'checkout.session.completed':
            return suscripcionPagada(event.data.object);
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted':
            if (!esDePops(event.data.object)) return false;
            await sincronizarSuscripcion(event.data.object);
            return true;
        case 'invoice.paid':
        case 'invoice.payment_failed': {
            // Renovación cobrada o fallida: el estado real se vuelve a leer.
            const inv = event.data.object;
            const subId = inv.subscription ?? inv.parent?.subscription_details?.subscription;
            if (!subId) return false;
            const sub = await stripe.subscriptions.retrieve(typeof subId === 'string' ? subId : subId.id);
            if (!esDePops(sub)) return false;
            await sincronizarSuscripcion(sub);
            return true;
        }
        default:
            return false;
    }
}

/*
  Prueba gratis de Pops+ (Admin → Usuarios › Clientes, switch "Pops+ de
  prueba"). Es la misma fila de pops_suscripciones con plan 'plus', status
  'trialing', fin en current_period_end y SIN stripe_subscription_id (así se
  distingue de una suscripción pagada o de una prueba de Stripe). Mientras
  dure, pops_plan_de la cuenta como Plus; al vencer regresa sola a Free.
  Si después paga, el webhook pisa la fila con la suscripción real.
*/
const DIAS_PRUEBA = 30;

const esPruebaAdmin = (fila) => fila?.plan === 'plus' && fila?.status === 'trialing'
    && !fila?.stripe_subscription_id;

/** { vence, dias } si la cuenta está en su prueba gratis vigente; si no, null. */
const pruebaVigente = (fila) => {
    if (!esPruebaAdmin(fila) || !fila.current_period_end) return null;
    const ms = Date.parse(fila.current_period_end) - Date.now();
    if (ms <= 0) return null;
    return { vence: fila.current_period_end, dias: Math.ceil(ms / 86400000) };
};

/** Activa (o renueva) la prueba. 409 YA_PAGA si ya tiene una suscripción pagada vigente. */
async function activarPrueba(userId, dias = DIAS_PRUEBA) {
    const actual = await suscripcionDe(userId);
    if (actual?.stripe_subscription_id && VIGENTE.includes(actual.status)) {
        const err = new Error('Esa cuenta ya paga Pops+'); err.code = 'YA_PAGA'; throw err;
    }
    const vence = new Date(Date.now() + dias * 86400000).toISOString();
    const { data, error } = await supabase.from('pops_suscripciones').upsert({
        user_id: userId,
        plan: 'plus',
        status: 'trialing',
        current_period_end: vence,
        cancel_at_period_end: false,
        stripe_subscription_id: null,
        updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' }).select().single();
    if (error) throw error;
    return data;
}

/** Quita la prueba (solo si la fila es una prueba de admin). */
async function quitarPrueba(userId) {
    const actual = await suscripcionDe(userId);
    if (!esPruebaAdmin(actual)) return actual;
    const { data, error } = await supabase.from('pops_suscripciones').update({
        plan: 'free',
        status: 'canceled',
        current_period_end: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    }).eq('user_id', userId).select().single();
    if (error) throw error;
    return data;
}

module.exports = {
    DIAS_PRUEBA,
    pruebaVigente,
    activarPrueba,
    quitarPrueba,
    stripe,
    LOOKUP_KEY,
    PORTAL_CONFIG,
    VIGENTE,
    precioPlus,
    suscripcionDe,
    eventoDeSuscripcion,
};
