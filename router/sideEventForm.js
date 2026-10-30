const express = require('express');
const crypto = require('crypto');
const supabase = require('../config/supabase');
const { crearLimite } = require('../helpers/limiteMemoria');
const { tieneFuncionesDePlanner } = require('../helpers/roles');

const router = express.Router();

/*
  Formulario de un Evento Flash (migraciones 2026-10-29c_flash_registro.sql
  y 2026-10-30_forms.sql; página: iattend-events components/SideEvent/Registro/;
  editor: iattend-vite modules/SideEvents/Formularios/). Reglas:
  · Existe si el Flash (side event sin invitación) tiene body.form.enabled y
    preguntas. Las preguntas salen del snapshot congelado
    (body.form.snapshot) del formulario que eligió el organizador en "Mis
    formularios"; las reglas (scope, allowLater, accepting, folioPrefix) son
    del Flash. Con accepting = false ya no se reciben respuestas.
  · Responde un invitado confirmado con su código (x-codigo-invitado). Con
    scope "persona" también registra a sus acompañantes confirmados; con
    "grupo", solo él. Un acompañante con link (x-token-registro) registra
    solo su propia fila.
  · Se valida aquí lo mismo que en la página (obligatorios y reglas).
  · El organizador (dueño, planner asignado o Administración) lee todo con
    su sesión para la lista y el Excel.
*/

const limite = crearLimite({ max: 30, ventanaMs: 60 * 1000 });
const primerNombre = (n) => String(n ?? '').trim().split(/\s+/)[0] || '';

const cargarEvento = async (id) => {
    const { data, error } = await supabase
        .from('side_events')
        .select('id, invitation_id, body, user_id, planner_id')
        .eq('id', id)
        .maybeSingle();
    if (error) throw error;
    return data;
};

const formDe = (evento) => {
    const form = evento && !evento.invitation_id ? evento.body?.form : null;
    if (!form?.enabled) return null;
    const publicado = form.snapshot ? { ...form, ...form.snapshot } : form;
    return (publicado.sections ?? []).some((s) => (s.fields ?? []).length) ? publicado : null;
};
const cerrado = (form) => form.accepting === false;

// Aviso sin contenido al editor del organizador: "hay respuestas nuevas, vuelve a pedirlas".
const avisar = async (eventoId) => {
    try {
        const canal = supabase.channel(`side_form_${eventoId}`);
        await canal.httpSend('cambio', { t: Date.now() });
        supabase.removeChannel(canal);
    } catch (err) {
        console.error('No se pudo avisar del formulario', eventoId, err?.message ?? err);
    }
};

// Preguntas que el organizador dejó prendidas, en orden.
const camposDe = (form) => (form.sections ?? [])
    .flatMap((s) => (s.fields ?? []).filter((f) => f.enabled !== false));

const fechaValida = (s) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    const f = new Date(Date.UTC(y, m - 1, d));
    return f.getUTCFullYear() === y && f.getUTCMonth() === m - 1 && f.getUTCDate() === d && y >= 1900 && y <= 2100;
};

// Mismas reglas y mensajes que la página (iattend-events Registro/datosRegistro.ts).
const presente = (f, v) => (f.type === 'multi' ? Array.isArray(v) && v.length > 0
    : f.type === 'yesno' ? v === true || v === false
    : f.type === 'check' ? v === true
    : typeof v === 'string' && v.trim().length > 0);

const errorDe = (f, v) => {
    if (f.required && !presente(f, v)) {
        return f.type === 'check' ? 'Necesitamos tu autorización para continuar' : f.type === 'single' ? 'Elige una opción' : f.type === 'date' ? 'Elige una fecha' : 'Este dato es obligatorio';
    }
    if (!presente(f, v)) return null;
    const s = String(v).trim();
    if (f.type === 'date') return fechaValida(s) ? null : 'Revisa la fecha';
    if (!f.validate) return null;
    switch (f.validate) {
        case 'name2': return s.split(/\s+/).length < 2 ? 'Escribe nombre y apellido' : null;
        case 'age16': return +s >= 16 && +s <= 110 ? null : 'Escribe una edad entre 16 y 110';
        case 'cp5': return /^\d{5}$/.test(s) ? null : 'El código postal tiene 5 dígitos';
        case 'digits4': return /^\d{4}$/.test(s) ? null : 'La sección tiene 4 dígitos';
        case 'phone10': return s.replace(/\D/g, '').length === 10 ? null : 'Escribe 10 dígitos';
        case 'email': return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) ? null : 'Revisa el correo';
        case 'number': return /^\d+$/.test(s) ? null : 'Escribe solo números';
        default: return null;
    }
};

// Solo se guardan las respuestas de preguntas que existen, con tipos sanos.
const limpiarRespuestas = (campos, answers) => {
    const limpio = {};
    for (const f of campos) {
        const v = answers?.[f.id];
        if (v === undefined || v === null) continue;
        if (f.type === 'multi') limpio[f.id] = (Array.isArray(v) ? v : []).map(String).filter((x) => (f.options ?? []).includes(x)).slice(0, f.max ?? 99);
        else if (f.type === 'yesno' || f.type === 'check') limpio[f.id] = v === true;
        else if (f.type === 'single') { if ((f.options ?? []).includes(String(v))) limpio[f.id] = String(v); }
        else if (f.type === 'date') limpio[f.id] = String(v).slice(0, 10);
        else if (f.type === 'long') limpio[f.id] = String(v).slice(0, f.maxLength ?? 500);
        else limpio[f.id] = String(v).slice(0, f.maxLength ?? 200);
    }
    return limpio;
};

const miembroPublico = (g, fila) => ({
    id: String(g.id),
    nombre: primerNombre(g.name),
    nombreCompleto: String(g.name ?? '').trim(),
    emoji: g.emoji || null,
    perfil: Number.isInteger(g.profile) ? g.profile : null,
    telefono: g.phone_number ?? null,
    estado: fila?.status ?? 'sin',
    folio: fila?.folio ?? null,
    token: fila?.status === 'pendiente' ? fila.link_token : null,
});

// Quién pide (código o token) y por quiénes puede responder.
const conRegistro = async (req, res, next) => {
    try {
        const evento = await cargarEvento(req.params.id);
        const form = formDe(evento);
        if (!form) return res.status(404).json({ ok: false, msg: 'Este evento no tiene formulario' });

        const codigo = String(req.header('x-codigo-invitado') ?? '').trim();
        const token = String(req.header('x-token-registro') ?? '').trim();
        let miembros = [];
        if (token) {
            const { data: fila } = await supabase.from('side_event_form_responses')
                .select('guest_id').eq('side_event_id', evento.id).eq('link_token', token).maybeSingle();
            if (!fila) return res.status(403).json({ ok: false, msg: 'Este link ya no es válido' });
            const { data: g } = await supabase.from('side_events_guests')
                .select('id, name, emoji, profile, phone_number, state, companion_id').eq('id', fila.guest_id).maybeSingle();
            if (!g) return res.status(403).json({ ok: false, msg: 'Este link ya no es válido' });
            miembros = [g];
        } else if (codigo) {
            const { data: g } = await supabase.from('side_events_guests')
                .select('id, name, emoji, profile, phone_number, state, companion_id')
                .eq('side_events_id', evento.id).eq('password', codigo).maybeSingle();
            if (!g || g.state !== 'confirmado') return res.status(403).json({ ok: false, msg: 'Confirma tu asistencia para responder' });
            miembros = [g];
            // Por persona: el titular registra también a sus acompañantes confirmados.
            if (form.scope !== 'grupo' && !g.companion_id) {
                const { data: acomp } = await supabase.from('side_events_guests')
                    .select('id, name, emoji, profile, phone_number, state, companion_id')
                    .eq('companion_id', g.id).eq('state', 'confirmado').order('id');
                miembros = [g, ...(acomp ?? [])];
            }
        } else {
            return res.status(403).json({ ok: false, msg: 'Confirma tu asistencia para responder' });
        }
        req.evento = evento;
        req.form = form;
        req.miembros = miembros;
        req.porToken = Boolean(token);
        next();
    } catch (err) {
        console.error('Error validando el registro:', err);
        return res.status(500).json({ ok: false, msg: 'Error interno del servidor' });
    }
};

const conOrganizador = async (req, res, next) => {
    const auth = req.header('Authorization');
    const tokenSesion = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!tokenSesion) return res.status(401).json({ ok: false, msg: 'Inicia sesión' });
    try {
        const { data: userData } = await supabase.auth.getUser(tokenSesion);
        const userId = userData?.user?.id;
        if (!userId) return res.status(401).json({ ok: false, msg: 'Sesión no válida' });
        const [evento, { data: perfil }] = await Promise.all([
            cargarEvento(req.params.id),
            supabase.from('profiles').select('role, active').eq('user_id', userId).maybeSingle(),
        ]);
        if (!evento || evento.invitation_id) return res.status(404).json({ ok: false, msg: 'Evento no encontrado' });
        const activo = perfil?.active ?? true;
        const puede = evento.user_id === userId
            || (activo && perfil?.role === 'Administration')
            || (activo && tieneFuncionesDePlanner(perfil?.role) && evento.planner_id === userId);
        if (!puede) return res.status(403).json({ ok: false, msg: 'No tienes acceso a este evento' });
        req.evento = evento;
        next();
    } catch (err) {
        console.error('Error validando al organizador del registro:', err);
        return res.status(500).json({ ok: false, msg: 'Error interno del servidor' });
    }
};

// GET /api/side-events/:id/registro → { ok, miembros, respuestas }
router.get('/:id/registro', conRegistro, async (req, res) => {
    try {
        const ids = req.miembros.map((m) => m.id);
        const { data: filas } = await supabase.from('side_event_form_responses')
            .select('guest_id, answers, status, folio, link_token').eq('side_event_id', req.evento.id).in('guest_id', ids);
        const porGuest = Object.fromEntries((filas ?? []).map((f) => [String(f.guest_id), f]));
        res.set('Cache-Control', 'no-store');
        return res.json({
            ok: true,
            porToken: req.porToken,
            cerrado: cerrado(req.form),
            miembros: req.miembros.map((g) => miembroPublico(g, porGuest[String(g.id)])),
            respuestas: Object.fromEntries((filas ?? []).filter((f) => f.status === 'completo').map((f) => [String(f.guest_id), f.answers])),
        });
    } catch (err) {
        console.error('Error en GET /api/side-events/:id/registro:', err);
        return res.status(500).json({ ok: false, msg: 'No se pudo cargar el formulario' });
    }
});

// POST /api/side-events/:id/registro/:guestId { answers } → { ok, folio }
router.post('/:id/registro/:guestId', conRegistro, async (req, res) => {
    const miembro = req.miembros.find((m) => String(m.id) === String(req.params.guestId));
    if (!miembro) return res.status(403).json({ ok: false, msg: 'No puedes responder por esta persona' });
    if (cerrado(req.form)) return res.status(403).json({ ok: false, msg: 'Este formulario ya no recibe respuestas' });
    if (!limite(`f:${req.evento.id}:${miembro.id}`)) return res.status(429).json({ ok: false, msg: 'Espera un momento' });

    const campos = camposDe(req.form);
    const answers = limpiarRespuestas(campos, req.body?.answers);
    const errores = Object.fromEntries(campos.map((f) => [f.id, errorDe(f, answers[f.id])]).filter(([, e]) => e));
    if (Object.keys(errores).length) return res.status(400).json({ ok: false, msg: 'Revisa tus respuestas', errores });

    try {
        const { data: previa } = await supabase.from('side_event_form_responses')
            .select('id, folio').eq('side_event_id', req.evento.id).eq('guest_id', miembro.id).maybeSingle();
        let folio = previa?.folio;
        if (!folio) {
            // El más alto + 1 (no el conteo: si se borra un invitado, el conteo repetiría un folio).
            const { data: folios } = await supabase.from('side_event_form_responses')
                .select('folio').eq('side_event_id', req.evento.id).not('folio', 'is', null);
            const mayor = Math.max(0, ...(folios ?? []).map((f) => Number(String(f.folio).split('-').pop()) || 0));
            const prefijo = String(req.form.folioPrefix || 'REG').replace(/[^A-Z0-9]/gi, '').slice(0, 5).toUpperCase() || 'REG';
            folio = `${prefijo}-${String(mayor + 1).padStart(4, '0')}`;
        }
        const conConsentimiento = campos.some((f) => f.type === 'check' && f.required && answers[f.id] === true);
        const fila = {
            side_event_id: req.evento.id,
            guest_id: miembro.id,
            answers,
            status: 'completo',
            link_token: null,
            folio,
            consent_at: conConsentimiento ? new Date().toISOString() : null,
            consent_version: conConsentimiento ? String(req.form.version ?? 'v1') : null,
            updated_at: new Date().toISOString(),
        };
        const { error } = await supabase.from('side_event_form_responses').upsert(fila, { onConflict: 'side_event_id,guest_id' });
        if (error) throw error;
        avisar(req.evento.id);
        return res.json({ ok: true, folio });
    } catch (err) {
        console.error('Error en POST /api/side-events/:id/registro/:guestId:', err);
        return res.status(500).json({ ok: false, msg: 'No se pudieron guardar tus respuestas' });
    }
});

// POST /api/side-events/:id/registro/:guestId/despues → { ok, token }
// El titular deja a un acompañante para que se registre con su propio link.
router.post('/:id/registro/:guestId/despues', conRegistro, async (req, res) => {
    if (req.porToken || req.form.allowLater === false || cerrado(req.form)) return res.status(403).json({ ok: false, msg: 'No disponible' });
    const miembro = req.miembros.find((m) => String(m.id) === String(req.params.guestId));
    if (!miembro || !miembro.companion_id) return res.status(403).json({ ok: false, msg: 'No puedes hacer esto' });
    try {
        const { data: previa } = await supabase.from('side_event_form_responses')
            .select('status, link_token').eq('side_event_id', req.evento.id).eq('guest_id', miembro.id).maybeSingle();
        if (previa?.status === 'completo') return res.json({ ok: true, token: null, completo: true });
        const token = previa?.link_token || crypto.randomBytes(16).toString('hex');
        const { error } = await supabase.from('side_event_form_responses').upsert({
            side_event_id: req.evento.id, guest_id: miembro.id, status: 'pendiente', link_token: token, updated_at: new Date().toISOString(),
        }, { onConflict: 'side_event_id,guest_id' });
        if (error) throw error;
        avisar(req.evento.id);
        return res.json({ ok: true, token });
    } catch (err) {
        console.error('Error en POST /api/side-events/:id/registro/:guestId/despues:', err);
        return res.status(500).json({ ok: false, msg: 'No se pudo crear el link' });
    }
});

// GET /api/side-events/:id/registro-respuestas → todas, para la lista y el Excel del organizador.
router.get('/:id/registro-respuestas', conOrganizador, async (req, res) => {
    try {
        const { data: filas, error } = await supabase.from('side_event_form_responses')
            .select('guest_id, answers, status, folio, link_token, consent_at, updated_at')
            .eq('side_event_id', req.evento.id)
            .order('updated_at', { ascending: false });
        if (error) throw error;
        const ids = [...new Set((filas ?? []).map((f) => f.guest_id))];
        const { data: invitados } = ids.length
            ? await supabase.from('side_events_guests').select('id, name, companion_id, phone_number').in('id', ids)
            : { data: [] };
        const titularesIds = [...new Set((invitados ?? []).map((g) => g.companion_id).filter(Boolean))];
        const { data: titulares } = titularesIds.length
            ? await supabase.from('side_events_guests').select('id, name').in('id', titularesIds)
            : { data: [] };
        const porId = Object.fromEntries((invitados ?? []).map((g) => [String(g.id), g]));
        const nombreTitular = Object.fromEntries((titulares ?? []).map((g) => [String(g.id), g.name]));
        res.set('Cache-Control', 'no-store');
        return res.json({
            ok: true,
            respuestas: (filas ?? []).map((f) => {
                const g = porId[String(f.guest_id)];
                return {
                    guestId: String(f.guest_id),
                    nombre: g?.name ?? '',
                    acompanaA: g?.companion_id ? nombreTitular[String(g.companion_id)] ?? '' : '',
                    estado: f.status,
                    folio: f.folio,
                    token: f.status === 'pendiente' ? f.link_token : null,
                    consentimiento: f.consent_at,
                    actualizado: f.updated_at,
                    answers: f.answers ?? {},
                };
            }),
        });
    } catch (err) {
        console.error('Error en GET /api/side-events/:id/registro-respuestas:', err);
        return res.status(500).json({ ok: false, msg: 'No se pudieron cargar las respuestas' });
    }
});

module.exports = router;
