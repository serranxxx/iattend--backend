// ── Meses sin intereses (MSI) ────────────────────────────────────────────────
// Plazos que se venden por plan. Cada plazo es un price propio en Stripe, más
// caro que el de contado para cubrir la comisión extra de MSI, y se busca por
// `lookup_key` (`{plan}_msi_{meses}`): el monto nunca se escribe aquí, sale de
// Stripe igual que el precio de contado.
//
// Ojo: en Checkout Session el plazo NO queda ligado al price
// (`installments` solo acepta `enabled`). Lo acotan los montos mínimos por
// plazo del Dashboard de Stripe (3 meses desde $4,269, 6 desde $4,399, 12 desde
// $4,700): nadie puede elegir más meses de los que pagó. Si cambian precios o
// se agregan plazos, hay que revisar que sigan cuadrando con esos rangos. El
// webhook avisa si aun así llega un plazo más largo.
// Ver docs/meses-sin-intereses.md en iattend-vite.

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Lite solo se vende de contado (sus prices lite_msi_* están archivados).
const MSI_TERMS = {
    pro: [3, 6, 12],
};

const lookupKeyOf = (planId, months) => `${planId}_msi_${months}`;

// lookup_key → { planId, months }
const TERM_BY_LOOKUP_KEY = Object.fromEntries(
    Object.entries(MSI_TERMS).flatMap(([planId, terms]) =>
        terms.map(months => [lookupKeyOf(planId, months), { planId, months }])
    )
);

const CACHE_MS = 5 * 60 * 1000;
let cache = null;
let cacheAt = 0;

// lookup_key → price de Stripe (solo los activos).
async function msiPrices() {
    if (cache && Date.now() - cacheAt < CACHE_MS) return cache;

    try {
        const { data } = await stripe.prices.list({
            lookup_keys: Object.keys(TERM_BY_LOOKUP_KEY),
            active: true,
            limit: 100,
        });
        cache = new Map(data.map(price => [price.lookup_key, price]));
        cacheAt = Date.now();
    } catch (error) {
        console.error('Error obteniendo precios MSI:', error.message);
        // Mejor el último catálogo conocido que dejar de ofrecer MSI.
        if (!cache) return new Map();
    }
    return cache;
}

const centavos = (n) => Math.round(n * 100) / 100;

/**
 * Plazos disponibles de un plan para los fronts:
 * [{ months, amount, monthly, currency, lookup_key }]. Sin price activo en
 * Stripe, el plazo no se ofrece.
 */
async function installmentsFor(planId) {
    const terms = MSI_TERMS[planId] ?? [];
    if (!terms.length) return [];

    const prices = await msiPrices();
    return terms
        .map(months => {
            const lookup_key = lookupKeyOf(planId, months);
            const price = prices.get(lookup_key);
            if (!price?.unit_amount) return null;
            const amount = price.unit_amount / 100;
            return {
                months,
                amount,
                monthly: centavos(amount / months),
                currency: price.currency,
                lookup_key,
            };
        })
        .filter(Boolean);
}

/** Resuelve un lookup_key a { priceId, planId, months } o null si no es MSI. */
async function resolveInstallmentLookupKey(lookupKey) {
    const term = TERM_BY_LOOKUP_KEY[lookupKey];
    if (!term) return null;
    const price = (await msiPrices()).get(lookupKey);
    if (!price) return null;
    return { priceId: price.id, ...term };
}

/** Plazo MSI al que pertenece un price id ({ planId, months, lookupKey }) o null. */
async function installmentByPriceId(priceId) {
    if (!priceId) return null;
    for (const [lookupKey, price] of await msiPrices()) {
        if (price.id === priceId) return { ...TERM_BY_LOOKUP_KEY[lookupKey], lookupKey };
    }
    return null;
}

// Opciones de tarjeta para la sesión: MSI solo con un price de MSI. En contado
// se apaga explícito, porque si se prende MSI en el Dashboard de Stripe,
// Checkout lo ofrecería en todas las sesiones.
const installmentsOptions = (months) => ({
    card: { installments: { enabled: Boolean(months) } },
});

module.exports = {
    MSI_TERMS,
    installmentsFor,
    resolveInstallmentLookupKey,
    installmentByPriceId,
    installmentsOptions,
};
