const Stripe = require('stripe');
const supabase = require('../config/supabase');
const { sendMail } = require('./mailer');
const { permiteMsi } = require('../config/stripe.catalog');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Revisión del plazo de meses sin intereses de un pago (webhook
// checkout.session.completed). Desde el 10 nov 2026 un producto con meses
// (`PRODUCTOS_CON_MSI` en config/stripe.catalog.js, o `metadata.aMeses`) deja
// elegir cualquier plazo en Stripe: se anota el que se cobró y ya. Red de
// seguridad: un producto sin meses lleva los meses apagados en su Checkout
// Session (y Stripe no los ofrece debajo de $4,000); si aun así llegó a meses,
// el plan se activa igual (ya se cobró), queda un reporte para reembolso
// manual en Admin → Buzón → Reportes (support_tickets) y sale correo a soporte.
//
// Las sesiones de antes traen `metadata.msiMonths` (un precio por plazo): se
// revisan como antes, más meses que los del precio = aviso.
// Nunca lanza: un error aquí no puede frenar la activación del plan.

const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'contacto.iattend@gmail.com';

const plazoTexto = (meses) => (meses ? `${meses} MSI` : 'contado');

/** Meses con los que se cobró la sesión (0 = contado), o null si no se pudo leer. */
async function mesesCobrados(session) {
    const paymentIntentId = typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id;
    if (!paymentIntentId) return null;

    const pi = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] });
    const plan = pi.latest_charge?.payment_method_details?.card?.installments?.plan;
    return plan?.count ?? 0;
}

async function avisarDescuadre(session, esperado, cobrado) {
    const { metadata = {} } = session;
    const monto = Number(session.amount_total ?? 0) / 100;
    const body = [
        'Pago con más meses que los del precio (meses sin intereses). Si el producto es de contado, sus meses debían ir apagados en el Checkout: revisar para reembolso manual de la comisión.',
        `Precio elegido: ${plazoTexto(esperado)}${metadata.lookupKey ? ` (${metadata.lookupKey})` : ''}`,
        `Plazo cobrado en Stripe: ${plazoTexto(cobrado)}`,
        `Monto: $${monto.toLocaleString('es-MX')} ${String(session.currency || '').toUpperCase()}`,
        `Sesión de Stripe: ${session.id}`,
        `PaymentIntent: ${session.payment_intent || '—'}`,
        `Modo: ${session.livemode ? 'producción' : 'prueba'}`,
        'El plan se activó normal. Revisar la comisión de Stripe de este cobro y los montos mínimos por plazo en Stripe (Settings → Payment methods → Meses sin intereses).',
    ].join('\n');

    const ticket = {
        topic: 'help',
        body,
        user_id: null,
        user_email: metadata.userEmail || session.customer_details?.email || null,
        user_name: session.customer_details?.name || null,
        invitation_id: metadata.invitationId || null,
        event_name: null,
    };

    const { data: guardado, error } = await supabase
        .from('support_tickets')
        .insert(ticket)
        .select('id')
        .maybeSingle();
    if (error) console.error('No se pudo guardar el aviso de plazo MSI:', error.message);

    try {
        await sendMail(SUPPORT_EMAIL, '[Pagos] Pago a meses de un producto sin meses (revisar reembolso)', `<p style="white-space:pre-wrap">${body}</p>`);
        if (guardado) await supabase.from('support_tickets').update({ email_sent: true }).eq('id', guardado.id);
    } catch (mailError) {
        console.error('No se pudo mandar el correo del aviso de plazo MSI:', mailError.message);
    }
}

/**
 * Devuelve { esperado, cobrado, coincide } (cobrado null si no se pudo leer).
 */
async function revisarPlazoMSI(session) {
    let esperado = Number(session?.metadata?.msiMonths || 0);
    try {
        const aMeses = session?.metadata?.aMeses === '1'
            || (!session?.metadata?.msiMonths && await permiteMsi(session?.metadata?.priceId));
        const cobrado = await mesesCobrados(session);
        if (cobrado === null) return { esperado, cobrado, coincide: true };

        // A meses: el plazo que eligió en Stripe es el bueno.
        if (aMeses) esperado = cobrado;

        const coincide = cobrado === esperado;
        if (cobrado > esperado) {
            console.warn(`⚠️ Plazo MSI distinto: precio ${plazoTexto(esperado)}, cobrado ${plazoTexto(cobrado)} (${session.id})`);
            await avisarDescuadre(session, esperado, cobrado);
        }
        return { esperado, cobrado, coincide };
    } catch (error) {
        console.error('No se pudo revisar el plazo MSI:', error.message);
        return { esperado, cobrado: null, coincide: true };
    }
}

module.exports = { revisarPlazoMSI, plazoTexto };
