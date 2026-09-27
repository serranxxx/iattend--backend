// ── Catálogo de planes ───────────────────────────────────────────────────────
// Única fuente de verdad de lo que incluye cada plan: tabla `plans` en
// Supabase, editable desde Admin → Planes (/api/admin/plans). Ver
// migrations/2026-09-25_create_plans_catalog.sql.
//
// Lo que incluye el plan se COPIA a la invitación al crearla o activarla
// (`credits_included`, `side_events_included`). Editar el catálogo nunca toca
// invitaciones existentes.

const supabase = require('./supabase');

const CACHE_MS = 60 * 1000;

let cache = null;
let cacheAt = 0;

const normalizePlanId = (plan) => String(plan ?? '').trim().toLowerCase() || null;

async function getPlans({ fresh = false } = {}) {
    if (!fresh && cache && Date.now() - cacheAt < CACHE_MS) return cache;

    const { data, error } = await supabase
        .from('plans')
        .select('*')
        .order('sort_order', { ascending: true });

    if (error) {
        // Mejor servir el último catálogo conocido que tumbar un alta pagada.
        if (cache) {
            console.error('Error leyendo plans, se usa la caché anterior:', error.message);
            return cache;
        }
        throw new Error(`No se pudo leer el catálogo de planes: ${error.message}`);
    }

    cache = data || [];
    cacheAt = Date.now();
    return cache;
}

async function getPlan(plan) {
    const id = normalizePlanId(plan);
    if (!id) return null;
    const plans = await getPlans();
    return plans.find(p => p.id === id) || null;
}

/**
 * Columnas que se copian a `invitations` al crear una invitación con este
 * plan. Un plan desconocido o nulo (borrador sin pagar) no incluye nada.
 */
async function planEntitlements(plan) {
    const found = await getPlan(plan);
    const credits = found?.credits_included ?? 0;
    return {
        credits,
        credits_included: credits,
        side_events_included: found?.side_events_included ?? 0,
        photo_wall_included: Boolean(found?.photo_wall_included),
    };
}

/** Plan del catálogo que se vende con este price de Stripe (o null). */
async function getPlanByPriceId(priceId) {
    if (!priceId) return null;
    const plans = await getPlans();
    return plans.find(p => p.stripe_price_id === priceId) || null;
}

function invalidatePlansCache() {
    cache = null;
    cacheAt = 0;
}

module.exports = {
    getPlans,
    getPlan,
    getPlanByPriceId,
    planEntitlements,
    invalidatePlansCache,
    normalizePlanId,
};
