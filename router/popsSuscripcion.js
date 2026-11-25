const express = require('express');
const { usuarioDeSesion } = require('../helpers/accesoEvento');
const {
    stripe, PORTAL_CONFIG, VIGENTE, precioPlus, suscripcionDe,
} = require('../helpers/popsSuscripcion');

const router = express.Router();

/*
  Suscripción de Pops+ (iattend-vite, pages/Board/PopsApp: "Pasar a Pops+" y
  "Método de pago y facturas"; handoff "App de Pops"). Ver helpers/popsSuscripcion.js.
  · POST /api/pops/suscripcion/checkout { origin } → { url } de Stripe Checkout.
      409 YA_PLUS si la cuenta ya tiene una vigente (una por cuenta).
  · POST /api/pops/suscripcion/portal { origin } → { url } del portal de cliente.
      404 SIN_SUSCRIPCION si la cuenta nunca pagó.
  Las dos piden la sesión de Supabase (Authorization: Bearer).
*/

const ORIGENES = /^https?:\/\/(localhost:\d+|(www\.|beta\.)?iattend\.(site|mx))$/;
const origenDe = (req) => (ORIGENES.test(req.body?.origin || '')
    ? req.body.origin
    : (process.env.CLIENT_URL || 'https://www.iattend.site'));

const conSesion = async (req, res, next) => {
    try {
        const usuario = await usuarioDeSesion(req);
        if (!usuario) return res.status(401).json({ ok: false, msg: 'Inicia sesión' });
        req.usuario = usuario;
        next();
    } catch (err) {
        console.error('[pops+] Error leyendo la sesión:', err.message);
        return res.status(500).json({ ok: false, msg: 'No se pudo revisar tu sesión' });
    }
};

router.post('/checkout', conSesion, async (req, res) => {
    try {
        const { id: userId, email } = req.usuario;
        const actual = await suscripcionDe(userId);
        // Una prueba gratis de Admin (sin suscripción de Stripe) sí puede pagar.
        if (actual?.plan === 'plus' && VIGENTE.includes(actual.status) && actual.stripe_subscription_id) {
            return res.status(409).json({ ok: false, code: 'YA_PLUS', msg: 'Ya tienes Pops+' });
        }

        const origen = origenDe(req);
        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            line_items: [{ price: await precioPlus(), quantity: 1 }],
            // El mismo customer si ya pagó antes (facturas y tarjeta en un solo lugar).
            ...(actual?.stripe_customer_id
                ? { customer: actual.stripe_customer_id }
                : { customer_email: email || undefined }),
            client_reference_id: userId,
            metadata: { popsSuscripcion: '1', userId },
            subscription_data: { metadata: { popsSuscripcion: '1', userId } },
            allow_promotion_codes: false,
            locale: 'es',
            success_url: `${origen}/invitations?espacio=pops&plus=ok`,
            cancel_url: `${origen}/invitations?espacio=pops`,
        });
        return res.json({ ok: true, url: session.url });
    } catch (err) {
        console.error('[pops+] Error creando el checkout:', err.message);
        return res.status(500).json({ ok: false, msg: 'No se pudo iniciar el pago' });
    }
});

router.post('/portal', conSesion, async (req, res) => {
    try {
        const actual = await suscripcionDe(req.usuario.id);
        if (!actual?.stripe_customer_id) {
            return res.status(404).json({ ok: false, code: 'SIN_SUSCRIPCION', msg: 'Todavía no tienes pagos' });
        }
        const portal = await stripe.billingPortal.sessions.create({
            customer: actual.stripe_customer_id,
            configuration: PORTAL_CONFIG,
            return_url: `${origenDe(req)}/invitations?espacio=pops`,
        });
        return res.json({ ok: true, url: portal.url });
    } catch (err) {
        console.error('[pops+] Error abriendo el portal:', err.message);
        return res.status(500).json({ ok: false, msg: 'No se pudo abrir el portal de pagos' });
    }
});

/*
  GET /api/pops/suscripcion/pagos → la pantalla "Método de pago y facturas"
  (handoff 2e): todo de Stripe.
  { suscripcion: { status, monto, moneda, intervalo, proximoCobro, cancelaAlFinal },
    tarjeta: { marca, last4, mes, anio } | null,
    facturas: [{ id, numero, fecha, monto, moneda, estado, ver, pdf }] }
  404 SIN_SUSCRIPCION si la cuenta nunca pagó.
*/
const tarjetaDe = (pm) => (pm?.card
    ? { marca: pm.card.brand, last4: pm.card.last4, mes: pm.card.exp_month, anio: pm.card.exp_year }
    : null);

router.get('/pagos', conSesion, async (req, res) => {
    try {
        const actual = await suscripcionDe(req.usuario.id);
        if (!actual?.stripe_customer_id) {
            return res.status(404).json({ ok: false, code: 'SIN_SUSCRIPCION', msg: 'Todavía no tienes pagos' });
        }

        const [sub, customer, facturas] = await Promise.all([
            actual.stripe_subscription_id
                ? stripe.subscriptions.retrieve(actual.stripe_subscription_id, { expand: ['default_payment_method'] }).catch(() => null)
                : null,
            stripe.customers.retrieve(actual.stripe_customer_id, { expand: ['invoice_settings.default_payment_method'] }),
            stripe.invoices.list({ customer: actual.stripe_customer_id, limit: 24 }),
        ]);

        // La tarjeta: la de la suscripción, la del customer o, si no, la primera guardada.
        let tarjeta = tarjetaDe(sub?.default_payment_method) || tarjetaDe(customer?.invoice_settings?.default_payment_method);
        if (!tarjeta) {
            const { data } = await stripe.paymentMethods.list({ customer: actual.stripe_customer_id, type: 'card', limit: 1 });
            tarjeta = tarjetaDe(data?.[0]);
        }

        const item = sub?.items?.data?.[0];
        const fin = sub?.current_period_end ?? item?.current_period_end;
        return res.json({
            ok: true,
            suscripcion: sub && {
                status: sub.status,
                monto: (item?.price?.unit_amount ?? 0) / 100,
                moneda: (item?.price?.currency ?? 'mxn').toUpperCase(),
                intervalo: item?.price?.recurring?.interval ?? 'month',
                proximoCobro: fin ? new Date(fin * 1000).toISOString() : null,
                cancelaAlFinal: Boolean(sub.cancel_at_period_end || sub.cancel_at),
            },
            tarjeta,
            facturas: (facturas?.data ?? [])
                .filter(f => f.status !== 'draft')
                .map(f => ({
                    id: f.id,
                    numero: f.number,
                    fecha: new Date(f.created * 1000).toISOString(),
                    monto: (f.status === 'paid' ? f.amount_paid : f.amount_due) / 100,
                    moneda: f.currency.toUpperCase(),
                    estado: f.status, // paid · open · void · uncollectible
                    ver: f.hosted_invoice_url,
                    pdf: f.invoice_pdf,
                })),
        });
    } catch (err) {
        console.error('[pops+] Error leyendo los pagos:', err.message);
        return res.status(500).json({ ok: false, msg: 'No se pudieron leer tus pagos' });
    }
});

module.exports = router;
