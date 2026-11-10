// GET /api/comprar/:productKey — link propio para vender sin Payment Links
// (WhatsApp, Instagram). Crea una Checkout Session del producto del catálogo
// (config/stripe.catalog.js) con cantidad fija en 1 y los meses prendidos o
// apagados según el producto, y devuelve su `url`. El front
// (iattend-vite `/comprar/:clave`) redirige ahí.
//
// Como un Payment Link, la compra no trae cuenta ni invitación: el webhook no
// activa nada (solo corre la red de seguridad de meses, por eso va `priceId`
// en la metadata) y la activa un asesor.

const express = require('express');
const Stripe = require('stripe');
const { CATALOGO, opcionesDePago } = require('../config/stripe.catalog');

const router = express.Router();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
// Stripe regresa al front que pidió el link (mismos orígenes que el checkout
// de planners); si no, al de producción.
const ORIGENES = /^https?:\/\/(localhost:\d+|(www\.)?iattend\.(site|mx))$/;
const origenDe = (req) => {
    const origen = req.get('origin') || '';
    return ORIGENES.test(origen) ? origen : (process.env.CLIENT_URL || 'https://www.iattend.site');
};

router.get('/:productKey', async (req, res) => {
    const productKey = req.params.productKey;
    const producto = Object.prototype.hasOwnProperty.call(CATALOGO, productKey) ? CATALOGO[productKey] : null;
    if (!producto?.priceId) return res.status(404).json({ ok: false, msg: 'Producto no encontrado' });

    const origen = origenDe(req);
    try {
        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            payment_method_types: ['card'],
            line_items: [{ price: producto.priceId, quantity: 1 }],
            payment_method_options: await opcionesDePago(producto.priceId),
            metadata: { origen: 'comprar', productKey, priceId: producto.priceId },
            success_url: `${origen}/comprar/${productKey}?estado=lista`,
            cancel_url: `${origen}/comprar/${productKey}?estado=cancelada`,
        });
        return res.json({ ok: true, url: session.url });
    } catch (error) {
        console.error('Error creando checkout de /comprar:', productKey, error.message);
        return res.status(500).json({ ok: false, msg: 'No se pudo iniciar el pago' });
    }
});

module.exports = router;
