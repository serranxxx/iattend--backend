const Stripe = require('stripe');
const supabase = require('../config/supabase');
const { sendMail } = require('./mailer');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Revisión del plazo de meses sin intereses de un pago (webhook
// checkout.session.completed). Checkout no deja fijar el plazo; los montos
// mínimos por plazo del Dashboard de Stripe impiden elegir más meses de los
// pagados, pero sí se pueden elegir menos (el price de 12 deja 3, 6 o 12). Aquí
// se compara lo cobrado contra lo que dice el price (`metadata.msiMonths`,
// 0 = contado).
//
// Menos meses que los pagados no le cuesta a I attend: solo se anota. Más
// meses (los rangos de Stripe dejaron de cuadrar) sí: el plan se activa igual
// (ya se cobró), queda un reporte en Admin → Buzón → Reportes
// (support_tickets) y sale correo a soporte.
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
        'Pago con más meses que los del precio (meses sin intereses).',
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
        await sendMail(SUPPORT_EMAIL, '[Pagos] Plazo MSI más largo que el del precio', `<p style="white-space:pre-wrap">${body}</p>`);
        if (guardado) await supabase.from('support_tickets').update({ email_sent: true }).eq('id', guardado.id);
    } catch (mailError) {
        console.error('No se pudo mandar el correo del aviso de plazo MSI:', mailError.message);
    }
}

/**
 * Devuelve { esperado, cobrado, coincide } (cobrado null si no se pudo leer).
 */
async function revisarPlazoMSI(session) {
    const esperado = Number(session?.metadata?.msiMonths || 0);
    try {
        const cobrado = await mesesCobrados(session);
        if (cobrado === null) return { esperado, cobrado, coincide: true };

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
