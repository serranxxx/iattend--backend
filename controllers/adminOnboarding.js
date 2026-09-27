const { response } = require('express');
const supabase = require('../config/supabase');

// Slides del onboarding wizard de iattend-vite. Ver
// migrations/2026-09-27_create_onboarding_slides.sql.

const KINDS_VALIDOS = [
    'invitation', 'save_the_date', 'guests', 'rsvp', 'passes',
    'seating', 'side_events', 'photo_wall', 'lia', 'image',
];

const TEXTOS = ['eyebrow', 'title', 'subtitle', 'description', 'description_mobile', 'cta_label', 'image_url'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const URL_HTTP = /^https?:\/\/\S+$/i;
const MAX_FOTOS = 30;

// `config` guarda los datos de la demo de cada tipo. Solo se aceptan las
// llaves conocidas, con su forma.
const prepararConfig = (config) => {
    if (config === null || typeof config !== 'object' || Array.isArray(config)) {
        return { error: 'config debe ser un objeto' };
    }

    const valor = {};

    if (config.invitation_id !== undefined && config.invitation_id !== null && config.invitation_id !== '') {
        if (!UUID.test(String(config.invitation_id).trim())) return { error: 'El ID de la invitación demo no es válido' };
        valor.invitation_id = String(config.invitation_id).trim();
    }

    if (config.url !== undefined && config.url !== null && config.url !== '') {
        if (!URL_HTTP.test(String(config.url).trim())) return { error: 'La URL del Save the Date debe empezar con https://' };
        valor.url = String(config.url).trim();
    }

    if (config.photos !== undefined) {
        if (!Array.isArray(config.photos)) return { error: 'photos debe ser una lista' };
        const fotos = config.photos.map(f => String(f ?? '').trim()).filter(Boolean);
        if (fotos.some(f => !URL_HTTP.test(f))) return { error: 'Cada foto debe ser una URL https://' };
        if (fotos.length > MAX_FOTOS) return { error: `Máximo ${MAX_FOTOS} fotos` };
        valor.photos = fotos;
    }

    return { valor };
};

// Valida el body y devuelve { error } o { valor } con solo los campos presentes.
const prepararCambios = async (body, { creando = false } = {}) => {
    const cambios = {};

    if (body.kind !== undefined || creando) {
        if (!KINDS_VALIDOS.includes(body.kind)) return { error: 'kind no válido' };
        cambios.kind = body.kind;
    }

    for (const campo of TEXTOS) {
        if (body[campo] === undefined) continue;
        if (body[campo] !== null && typeof body[campo] !== 'string') return { error: `${campo} debe ser texto` };
        cambios[campo] = body[campo]?.trim() || null;
    }

    if ((creando || 'title' in cambios) && !cambios.title) return { error: 'El título es requerido' };

    if (body.exclusive_plan !== undefined) {
        const plan = body.exclusive_plan || null;
        if (plan) {
            const { data } = await supabase.from('plans').select('id').eq('id', plan).maybeSingle();
            if (!data) return { error: `El plan ${plan} no existe` };
        }
        cambios.exclusive_plan = plan;
    }

    if (body.config !== undefined) {
        const { error, valor } = prepararConfig(body.config);
        if (error) return { error };
        cambios.config = valor;
    }

    if (body.is_active !== undefined) {
        if (typeof body.is_active !== 'boolean') return { error: 'is_active debe ser booleano' };
        cambios.is_active = body.is_active;
    }

    if (body.sort_order !== undefined) {
        if (!Number.isInteger(body.sort_order) || body.sort_order < 0) return { error: 'sort_order no válido' };
        cambios.sort_order = body.sort_order;
    }

    const kindFinal = cambios.kind ?? body.kind;
    if (kindFinal === 'image' && creando && !cambios.image_url) {
        return { error: 'Un slide de imagen necesita la URL de la imagen' };
    }

    return { valor: cambios };
};

const listarSlides = async (req, res = response) => {
    const { data, error } = await supabase
        .from('onboarding_slides')
        .select('*')
        .order('sort_order', { ascending: true });

    if (error) return res.status(500).json({ ok: false, msg: error.message });
    return res.status(200).json({ ok: true, slides: data || [] });
};

const crearSlide = async (req, res = response) => {
    try {
        const { error: validacion, valor } = await prepararCambios(req.body || {}, { creando: true });
        if (validacion) return res.status(400).json({ ok: false, msg: validacion });

        // Al final de la lista si no se indica posición.
        if (valor.sort_order === undefined) {
            const { data: ultimo } = await supabase
                .from('onboarding_slides')
                .select('sort_order')
                .order('sort_order', { ascending: false })
                .limit(1)
                .maybeSingle();
            valor.sort_order = (ultimo?.sort_order ?? 0) + 1;
        }

        const { data, error } = await supabase
            .from('onboarding_slides')
            .insert({ ...valor, updated_by: req.adminUserId })
            .select('*')
            .single();

        if (error) return res.status(500).json({ ok: false, msg: error.message });
        return res.status(201).json({ ok: true, slide: data });
    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
};

const actualizarSlide = async (req, res = response) => {
    try {
        const { error: validacion, valor } = await prepararCambios(req.body || {});
        if (validacion) return res.status(400).json({ ok: false, msg: validacion });
        if (!Object.keys(valor).length) return res.status(400).json({ ok: false, msg: 'No hay cambios que guardar' });

        const { data, error } = await supabase
            .from('onboarding_slides')
            .update({ ...valor, updated_by: req.adminUserId })
            .eq('id', req.params.id)
            .select('*')
            .maybeSingle();

        if (error) return res.status(500).json({ ok: false, msg: error.message });
        if (!data) return res.status(404).json({ ok: false, msg: 'Slide no encontrado' });
        return res.status(200).json({ ok: true, slide: data });
    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
};

const eliminarSlide = async (req, res = response) => {
    const { error } = await supabase.from('onboarding_slides').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ ok: false, msg: error.message });
    return res.status(200).json({ ok: true });
};

// Body: { ids: [...] } en el orden nuevo. Reescribe sort_order 1..n.
const reordenarSlides = async (req, res = response) => {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ ok: false, msg: 'ids es requerido' });

    try {
        const resultados = await Promise.all(ids.map((id, index) =>
            supabase.from('onboarding_slides').update({ sort_order: index + 1, updated_by: req.adminUserId }).eq('id', id)
        ));
        const fallo = resultados.find(r => r.error);
        if (fallo) return res.status(500).json({ ok: false, msg: fallo.error.message });
        return res.status(200).json({ ok: true });
    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
};

module.exports = {
    listarSlides,
    crearSlide,
    actualizarSlide,
    eliminarSlide,
    reordenarSlides,
};
