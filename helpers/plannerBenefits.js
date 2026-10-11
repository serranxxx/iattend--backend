const Stripe = require('stripe');
const supabase = require('../config/supabase');
const { tieneFuncionesDePlanner } = require('./roles');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Beneficios de un planner (tabla planner_benefits, migración
// 2026-10-10b_planner_benefits.sql). Sin fila = sin beneficios.
async function beneficiosDe(plannerId) {
    if (!plannerId) return { free_events: 0, free_flash_events: 0, discount_pct: 0 };
    const { data } = await supabase
        .from('planner_benefits')
        .select('free_events, free_flash_events, discount_pct')
        .eq('planner_id', plannerId)
        .maybeSingle();
    return {
        free_events: data?.free_events ?? 0,
        free_flash_events: data?.free_flash_events ?? 0,
        discount_pct: data?.discount_pct ?? 0,
    };
}

// Usuario de la sesión de Supabase (Authorization: Bearer). null si no hay o
// no es válida: el checkout sigue sin descuento.
async function usuarioDeRequest(req) {
    const authHeader = req.header('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return null;
    const { data, error } = await supabase.auth.getUser(token);
    return error ? null : data?.user ?? null;
}

// Un cupón por porcentaje, reutilizable: `planner-15` = 15% una vez.
async function cuponDePorcentaje(pct) {
    const id = `planner-${pct}`;
    try {
        return (await stripe.coupons.retrieve(id)).id;
    } catch (error) {
        if (error?.code !== 'resource_missing') throw error;
        try {
            const cupon = await stripe.coupons.create({
                id, percent_off: pct, duration: 'once', name: `Planner ${pct}%`,
            });
            return cupon.id;
        } catch (createError) {
            // Dos primeros checkouts con el mismo porcentaje a la vez: el otro
            // ya lo creó.
            if (createError?.code !== 'resource_already_exists') throw createError;
            return (await stripe.coupons.retrieve(id)).id;
        }
    }
}

/**
 * Descuento global del planner para una sesión de Checkout: devuelve
 * `{ discounts, metadata }` para mezclar en `stripe.checkout.sessions.create`,
 * vacío si quien compra no es planner o no tiene descuento. Se identifica por
 * la sesión (Bearer), nunca por un id del body.
 * Nunca lanza: si algo falla se cobra sin descuento.
 */
async function descuentoParaCheckout(req) {
    try {
        const user = await usuarioDeRequest(req);
        if (!user) return {};
        const { data: perfil } = await supabase
            .from('profiles').select('role, active').eq('user_id', user.id).maybeSingle();
        if (!tieneFuncionesDePlanner(perfil?.role) || perfil.active === false) return {};
        const { discount_pct } = await beneficiosDe(user.id);
        if (!discount_pct) return {};
        return {
            discounts: [{ coupon: await cuponDePorcentaje(discount_pct) }],
            metadata: { plannerDiscountPct: String(discount_pct), plannerId: user.id },
        };
    } catch (error) {
        console.error('No se pudo aplicar el descuento de planner:', error.message);
        return {};
    }
}

module.exports = { beneficiosDe, usuarioDeRequest, cuponDePorcentaje, descuentoParaCheckout };
