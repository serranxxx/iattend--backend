// ── Catálogo de Stripe (10 nov 2026) ─────────────────────────────────────────
// Un solo lugar con los productos vigentes y la regla de meses sin intereses.
// Todos son pago único en MXN con IVA incluido.
//
// Meses sin intereses: Stripe no deja fijar el plazo por producto (Checkout
// ofrece todos los plazos activos en la cuenta), así que cada producto tiene
// un precio y se decide solo si se ofrecen meses o no. PRO tiene dos
// productos: contado (sin meses) y "a meses" (más caro, absorbe la comisión;
// el cliente elige el plazo en Stripe). Bucket 10 cuesta lo mismo de contado
// o a meses; Bucket 5 es solo de contado.
//
// La regla vive también en Stripe: en el Dashboard (Settings → Payment
// methods → Meses sin intereses) los plazos 3, 6 y 12 tienen un mínimo de
// $4,000 MXN (9, 18 y 24 apagados), así que todo cobro menor a $4,000 no
// ofrece meses, venga de Payment Link o de Checkout. Por eso los productos
// "a meses" cuestan $4,000 o más y ninguno de contado debe llegar a $4,000.
// Aun así, cada Checkout Session lleva `installments.enabled` explícito
// (opcionesDePago) para no depender solo del Dashboard.
//
// Los productos y precios archivados viven en stripe.products.js (mapa legacy
// del webhook). Ver docs/meses-sin-intereses.md en iattend-vite.

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const CATALOGO = {
    // Wedding
    pro_contado: { productId: 'prod_VbSVIYg0eJbVFv', priceId: 'price_1UaFaqAAdNlITNVb73fqH4yd', tipo: 'plan', plan: 'pro', msi: false },
    pro_meses: { productId: 'prod_VbSVZzZnks5dVJ', priceId: 'price_1UaH1yAAdNlITNVbqdsGJJtf', tipo: 'plan', plan: 'pro', msi: true },
    lite: { productId: 'prod_ThrfrgJ7bGsk3f', priceId: 'price_1Tl9jyAAdNlITNVbm0hq6omU', tipo: 'plan', plan: 'lite', msi: false },
    paperless: { productId: 'prod_ThrfQpVr7gTuLS', priceId: 'price_1SkRvtAAdNlITNVbj8BA6F2Q', tipo: 'plan', plan: 'paperless', msi: false },

    // Pops (el Pop suelto se cobra por su lookup_key `flash_event`, helpers/popEvent.js)
    pop_individual: { productId: 'prod_VQ1P4AEuKpGcSY', priceId: 'price_1UPBMpAAdNlITNVbsMytTDx4', tipo: 'pops', pops: 1, msi: false },
    bucket_5: { productId: 'prod_VbRxwmHXwYccpu', priceId: 'price_1UaH4PAAdNlITNVbL15skW9Y', tipo: 'pops', pops: 5, msi: false },
    bucket_10: { productId: 'prod_VbRy89kVxXQ6on', priceId: 'price_1UaHjdAAdNlITNVbv6j6JQKZ', tipo: 'pops', pops: 10, msi: true },

    // Promos (temporales)
    pro_20_off: { productId: 'prod_VbSSieDvJfgvz3', priceId: 'price_1UaFY1AAdNlITNVbWr0IC7SR', tipo: 'plan', plan: 'pro', msi: false },
    pro_msi: { productId: 'prod_Va0VhUewMVIFcz', priceId: 'price_1UaHg5AAdNlITNVbpmncSmHc', tipo: 'plan', plan: 'pro', msi: true },

    // Extras (tienen varios precios: los IDs que se cobran siguen en stripe.products.js)
    side_event: { productId: 'prod_TzUdGoGP30dpei', tipo: 'side', msi: false },
    creditos_50: { productId: 'prod_TuyMyftisD9Ftv', tipo: 'credits', msi: false },
    creditos_100: { productId: 'prod_TuyNgRyhOEgk9p', tipo: 'credits', msi: false },
    creditos_200: { productId: 'prod_TuyOYmiOSKXs97', tipo: 'credits', msi: false },
    cambiate_a_pro: { productId: 'prod_UkhT1IUcNBqftu', tipo: 'plan', plan: 'pro', msi: false },
};

// Productos que ofrecen meses (cualquier plazo). Todo lo demás, sin meses.
const PRODUCTOS_CON_MSI = new Set(
    Object.values(CATALOGO).filter((p) => p.msi).map((p) => p.productId)
);

// Precio "a meses" de cada plan (el de contado vive en la tabla `plans`).
const PRECIO_A_MESES = {
    pro: CATALOGO.pro_meses.priceId,
};

// Plazos que se anuncian: los activos en el Dashboard (3, 6 y 12, desde
// $4,000). Si cambian allá, hay que cambiarlos aquí.
const PLAZOS_MSI = [3, 6, 12];

const CACHE_MS = 5 * 60 * 1000;
const preciosCache = new Map(); // priceId → { at, price }

/** Price de Stripe (con caché de 5 min). null si no existe. */
async function precioDeStripe(priceId) {
    if (!priceId) return null;
    const hit = preciosCache.get(priceId);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.price;
    try {
        const price = await stripe.prices.retrieve(priceId);
        preciosCache.set(priceId, { at: Date.now(), price });
        return price;
    } catch (error) {
        console.error(`Error obteniendo price ${priceId}:`, error.message);
        return hit?.price ?? null;
    }
}

const productoDe = (price) => (typeof price?.product === 'string' ? price.product : price?.product?.id);

/** ¿Este precio ofrece meses? Por su producto; sin datos, no. */
async function permiteMsi(priceId) {
    const price = await precioDeStripe(priceId);
    return PRODUCTOS_CON_MSI.has(productoDe(price));
}

/**
 * `payment_method_options` de una Checkout Session: meses solo para los
 * productos que los ofrecen. Se manda siempre (también `false`), porque con
 * MSI prendido en el Dashboard, Checkout lo ofrecería en todas las sesiones.
 */
async function opcionesDePago(priceId) {
    return { card: { installments: { enabled: await permiteMsi(priceId) } } };
}

module.exports = {
    CATALOGO,
    PRODUCTOS_CON_MSI,
    PRECIO_A_MESES,
    PLAZOS_MSI,
    precioDeStripe,
    permiteMsi,
    opcionesDePago,
};
