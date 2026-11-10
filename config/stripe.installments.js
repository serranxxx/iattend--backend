// ── Meses sin intereses (MSI) ────────────────────────────────────────────────
// Desde el 10 nov 2026 cada plan con meses tiene UN precio "a meses" (más caro
// que el de contado para cubrir la comisión) y el cliente elige el plazo en
// Stripe Checkout: Stripe no deja fijar el plazo por precio ni por producto.
// El catálogo y la regla de qué productos ofrecen meses viven en
// config/stripe.catalog.js. Ver docs/meses-sin-intereses.md en iattend-vite.
//
// Los fronts piden "a meses" con `lookupKey = '{plan}_meses'`. Los
// `{plan}_msi_{meses}` de antes (un precio por plazo) se siguen aceptando y
// caen en el mismo precio a meses, por si queda un front viejo en caché.

const { PRECIO_A_MESES, PLAZOS_MSI, precioDeStripe, opcionesDePago } = require('./stripe.catalog');

const centavos = (n) => Math.round(n * 100) / 100;

const lookupKeyDe = (planId) => `${planId}_meses`;

/**
 * Pago a meses de un plan para los fronts (GET /api/plans):
 * [{ months, amount, monthly, currency, lookup_key, plazos }] con una sola
 * entrada: `months` es el plazo más largo (para "hasta 12 pagos de $375") y
 * `plazos` todos los que se anuncian. [] si el plan no tiene precio a meses
 * activo. Se deja en arreglo por compatibilidad con los fronts de antes.
 */
async function installmentsFor(planId) {
    const price = await precioDeStripe(PRECIO_A_MESES[planId]);
    if (!price?.active || !price.unit_amount) return [];

    const amount = price.unit_amount / 100;
    const months = Math.max(...PLAZOS_MSI);
    return [{
        months,
        amount,
        monthly: centavos(amount / months),
        currency: price.currency,
        lookup_key: lookupKeyDe(planId),
        plazos: PLAZOS_MSI.map((m) => ({ months: m, monthly: centavos(amount / m) })),
    }];
}

/**
 * Resuelve el lookupKey que manda el front (`pro_meses`, o el viejo
 * `pro_msi_6`) a { priceId, planId } del precio a meses, o null.
 */
async function resolveInstallmentLookupKey(lookupKey) {
    const match = String(lookupKey || '').match(/^([a-z]+)_(?:meses|msi_\d+)$/);
    const planId = match?.[1];
    const priceId = PRECIO_A_MESES[planId];
    if (!priceId) return null;
    const price = await precioDeStripe(priceId);
    if (!price?.active) return null;
    return { priceId, planId };
}

/** Plan del precio a meses vigente ({ planId }) o null. Para el webhook. */
async function installmentByPriceId(priceId) {
    const planId = Object.keys(PRECIO_A_MESES).find((p) => PRECIO_A_MESES[p] === priceId);
    return planId ? { planId } : null;
}

module.exports = {
    installmentsFor,
    resolveInstallmentLookupKey,
    installmentByPriceId,
    opcionesDePago,
};
