const { response } = require('express');
const Stripe = require('stripe');
const supabase = require('../config/supabase');
const { getPlans, invalidatePlansCache } = require('../config/plans');
const { installmentsFor } = require('../config/stripe.installments');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const PRICE_CACHE_MS = 5 * 60 * 1000;
const priceCache = new Map(); // priceId → { at, value }

// Monto vigente en Stripe. El catálogo solo guarda el price id: el precio que
// se cobra y el que se muestra salen del mismo lugar.
const priceOf = async (priceId) => {
    if (!priceId) return null;

    const hit = priceCache.get(priceId);
    if (hit && Date.now() - hit.at < PRICE_CACHE_MS) return hit.value;

    try {
        const price = await stripe.prices.retrieve(priceId);
        const value = { amount: price.unit_amount / 100, currency: price.currency, active: price.active };
        priceCache.set(priceId, { at: Date.now(), value });
        return value;
    } catch (error) {
        console.error(`Error obteniendo price ${priceId}:`, error.message);
        return hit?.value ?? null;
    }
};

// `installments`: plazos a meses sin intereses (precio total y mensualidad de
// cada uno), resueltos por lookup_key en Stripe. [] si el plan no tiene MSI.
const withPrices = (plans) => Promise.all(
    plans.map(async (plan) => ({
        ...plan,
        price: await priceOf(plan.stripe_price_id),
        installments: await installmentsFor(plan.id),
    }))
);

// Campos que ven los frontends. `updated_by` se queda en el admin.
const publicShape = ({ updated_by, created_at, ...plan }) => plan;

/**
 * GET /api/plans — público. Lo consumen iattend-vite (checkout, selector de
 * planes, side events) e iattend-next (landing y páginas de producto).
 */
const listarPlanesPublicos = async (req, res = response) => {
    try {
        const plans = await withPrices(await getPlans());
        res.set('Cache-Control', 'public, max-age=60');
        return res.status(200).json({ ok: true, plans: plans.map(publicShape) });
    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
};

/**
 * GET /api/admin/plans — el catálogo completo con cuántas invitaciones hay
 * en cada plan.
 */
const listarPlanesAdmin = async (req, res = response) => {
    try {
        const plans = await withPrices(await getPlans({ fresh: true }));

        const { data: invitaciones, error } = await supabase
            .from('invitations')
            .select('plan');

        if (error) return res.status(500).json({ ok: false, msg: error.message });

        const porPlan = {};
        (invitaciones || []).forEach(({ plan }) => {
            const id = String(plan ?? '').toLowerCase();
            porPlan[id] = (porPlan[id] || 0) + 1;
        });

        return res.status(200).json({
            ok: true,
            plans: plans.map(plan => ({ ...plan, invitation_count: porPlan[plan.id] || 0 })),
        });
    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
};

const GRUPOS_VALIDOS = ['invitation', 'event'];

// Le avisa a la landing (iattend-next) que el catálogo cambió, para que no
// siga sirviendo su caché de 5 min. Si no está configurado o falla, solo se
// registra: el guardado ya ocurrió y la caché vence sola.
const refrescarLanding = async () => {
    const url = process.env.LANDING_REVALIDATE_URL;
    const secret = process.env.LANDING_REVALIDATE_SECRET;
    if (!url || !secret) return;

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'x-revalidate-secret': secret },
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) console.error(`Revalidar landing respondió ${res.status}`);
    } catch (error) {
        console.error('No se pudo revalidar la landing:', error.message);
    }
};

const esEnteroNoNegativo = (v) => Number.isInteger(v) && v >= 0;
const textoOpcional = (v) => v === null || typeof v === 'string';

// Valida el body del PATCH. Devuelve { error } o { valor } con solo los campos
// presentes.
const prepararCambios = async (body) => {
    const cambios = {};

    if (body.name !== undefined) {
        if (typeof body.name !== 'string' || !body.name.trim()) return { error: 'name es requerido' };
        cambios.name = body.name.trim();
    }

    for (const campo of ['tagline', 'description']) {
        if (body[campo] === undefined) continue;
        if (!textoOpcional(body[campo])) return { error: `${campo} debe ser texto` };
        cambios[campo] = body[campo]?.trim() || null;
    }

    for (const campo of ['credits_included', 'side_events_included', 'sort_order']) {
        if (body[campo] === undefined) continue;
        if (!esEnteroNoNegativo(body[campo])) return { error: `${campo} debe ser un entero mayor o igual a 0` };
        cambios[campo] = body[campo];
    }

    for (const campo of ['can_buy_side_events', 'photo_wall_included', 'show_landing', 'show_checkout', 'show_app']) {
        if (body[campo] === undefined) continue;
        if (typeof body[campo] !== 'boolean') return { error: `${campo} debe ser booleano` };
        cambios[campo] = body[campo];
    }

    if (body.features !== undefined) {
        if (!Array.isArray(body.features)) return { error: 'features debe ser un arreglo' };

        const features = [];
        for (const f of body.features) {
            const icon = typeof f?.icon === 'string' ? f.icon.trim() : '';
            const es = typeof f?.es === 'string' ? f.es.trim() : '';
            const en = typeof f?.en === 'string' ? f.en.trim() : '';
            if (!es) return { error: 'Cada feature necesita al menos el texto en español' };
            // "invitation" → "Tu invitación", "event" → "Gestión del evento" en el checkout.
            const group = GRUPOS_VALIDOS.includes(f?.group) ? f.group : 'event';
            features.push({ group, icon: icon || 'check', es, en: en || es });
        }
        cambios.features = features;
    }

    if (body.highlights !== undefined) {
        if (!Array.isArray(body.highlights)) return { error: 'highlights debe ser un arreglo' };

        const highlights = [];
        for (const h of body.highlights) {
            const title = typeof h?.title === 'string' ? h.title.trim() : '';
            const note = typeof h?.note === 'string' ? h.note.trim() : '';
            if (!title) return { error: 'Cada punto de "Y además incluye" necesita un título' };
            highlights.push({ title, note });
        }
        cambios.highlights = highlights;
    }

    if (body.stripe_price_id !== undefined) {
        const priceId = typeof body.stripe_price_id === 'string' ? body.stripe_price_id.trim() : null;

        if (priceId) {
            // Un price id mal pegado dejaría el plan sin precio y sin checkout:
            // se verifica contra Stripe antes de guardarlo.
            try {
                await stripe.prices.retrieve(priceId);
            } catch {
                return { error: `El price ${priceId} no existe en Stripe` };
            }
        }
        cambios.stripe_price_id = priceId || null;
    }

    return { valor: cambios };
};

/**
 * PATCH /api/admin/plans/:id — edita un plan. Solo afecta a invitaciones que
 * se creen de aquí en adelante: las existentes guardan su propia copia de lo
 * incluido (credits_included / side_events_included).
 */
const actualizarPlan = async (req, res = response) => {
    const { id } = req.params;

    try {
        const { error: validacion, valor } = await prepararCambios(req.body || {});
        if (validacion) return res.status(400).json({ ok: false, msg: validacion });
        if (!Object.keys(valor).length) return res.status(400).json({ ok: false, msg: 'No hay cambios que guardar' });

        // `is_public` es el resumen de los tres interruptores: se recalcula
        // contra la fila actual para no depender de que lleguen los tres.
        const VISIBILIDAD = ['show_landing', 'show_checkout', 'show_app'];
        if (VISIBILIDAD.some(c => c in valor)) {
            const { data: actual } = await supabase.from('plans').select(VISIBILIDAD.join(', ')).eq('id', id).maybeSingle();
            const merged = { ...(actual || {}), ...valor };
            valor.is_public = VISIBILIDAD.some(c => merged[c]);
        }

        const { data, error } = await supabase
            .from('plans')
            .update({ ...valor, updated_by: req.adminUserId })
            .eq('id', id)
            .select('*')
            .maybeSingle();

        if (error) return res.status(500).json({ ok: false, msg: error.message });
        if (!data) return res.status(404).json({ ok: false, msg: 'Plan no encontrado' });

        invalidatePlansCache();
        refrescarLanding();

        return res.status(200).json({ ok: true, plan: { ...data, price: await priceOf(data.stripe_price_id) } });
    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
};

module.exports = {
    listarPlanesPublicos,
    listarPlanesAdmin,
    actualizarPlan,
};
