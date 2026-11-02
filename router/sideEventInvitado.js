const express = require('express');
const supabase = require('../config/supabase');
const { crearLimite } = require('../helpers/limiteMemoria');
const { buscarSideEventPorClave } = require('../helpers/sideEventClave');

const router = express.Router();

/*
  El invitado de un side event / Pop en su página (iattend-events,
  components/SideEvent/SideEvent.tsx). Antes la página leía y escribía
  side_events_guests directo con la anon key, y eso obligaba a dejar la
  tabla abierta: cualquiera bajaba la lista completa con teléfonos y
  códigos, y los acompañantes se actualizaban solo por id. Ahora todo pasa
  por aquí (service role) y siempre con:
  · el evento por su código público (o el número con link viejo,
    helpers/sideEventClave.js), y
  · el código del invitado (header x-codigo-invitado = password).
  Un titular solo toca su fila y la de sus acompañantes (companion_id).
  Con esto la anon key ya no necesita permisos sobre side_events_guests.
*/

const ESTADOS = new Set(['confirmado', 'rechazado']);
const MAX_NOMBRE = 80;
const MAX_PERFIL = 15;
// Adivinar códigos: tope por IP (varios invitados pueden compartir el wifi del salón).
const limiteLectura = crearLimite({ max: 60, ventanaMs: 60 * 1000 });
const limiteEscritura = crearLimite({ max: 30, ventanaMs: 60 * 1000 });

const ipDe = (req) => String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.ip;
const limpiar = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NOMBRE);
const emojiValido = (v) => {
    const e = String(v ?? '').trim();
    if (!e || e.length > 16 || /[\p{L}\p{N}<>]/u.test(e)) return null;
    const seg = typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter('es', { granularity: 'grapheme' }).segment(e)] : [e];
    return seg.length === 1 ? e : null;
};
const perfilValido = (v) => (Number.isInteger(v) && v >= 0 && v <= MAX_PERFIL ? v : null);

const acompanantesDe = async (titular) => {
    if (!titular.has_companion) return [];
    const { data, error } = await supabase.from('side_events_guests').select('*')
        .eq('side_events_id', titular.side_events_id).eq('companion_id', String(titular.id)).order('id');
    if (error) throw error;
    return data ?? [];
};

// Middleware: evento (por clave) + invitado dueño del código en ese evento.
const conInvitado = (limite) => async (req, res, next) => {
    if (!limite(`i:${ipDe(req)}`)) return res.status(429).json({ ok: false, msg: 'Demasiados intentos. Inténtalo en unos minutos.' });
    const codigo = String(req.header('x-codigo-invitado') ?? '').trim();
    if (!codigo) return res.status(400).json({ ok: false, msg: 'Falta tu código' });
    try {
        const evento = await buscarSideEventPorClave(req.params.id, 'id');
        if (!evento) return res.status(404).json({ ok: false, msg: 'Evento no encontrado' });
        const { data: invitado, error } = await supabase.from('side_events_guests').select('*')
            .eq('side_events_id', evento.id).eq('password', codigo).maybeSingle();
        if (error) throw error;
        if (!invitado) return res.status(404).json({ ok: false, msg: 'Código incorrecto' });
        req.evento = evento;
        req.invitado = invitado;
        next();
    } catch (err) {
        console.error('Error validando al invitado del side event:', err);
        return res.status(500).json({ ok: false, msg: 'Error interno del servidor' });
    }
};

// GET /api/side-events/:clave/invitado → { ok, invitado, acompanantes }
router.get('/:id/invitado', conInvitado(limiteLectura), async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');
        return res.json({ ok: true, invitado: req.invitado, acompanantes: await acompanantesDe(req.invitado) });
    } catch (err) {
        console.error('Error en GET /api/side-events/:id/invitado:', err);
        return res.status(500).json({ ok: false, msg: 'Error interno del servidor' });
    }
});

// POST /api/side-events/:clave/respuesta
// { estado, nombre?, acompanantes?: [{ id, estado, nombre? }] } → { ok, invitado, acompanantes }
// Confirmar / rechazar el pase: el titular (y su nombre, si viene) y los
// acompañantes que mande, solo si son suyos.
router.post('/:id/respuesta', conInvitado(limiteEscritura), async (req, res) => {
    const estado = req.body?.estado;
    if (!ESTADOS.has(estado)) return res.status(400).json({ ok: false, msg: 'Respuesta inválida' });
    const nombre = req.body?.nombre === undefined ? undefined : limpiar(req.body.nombre);
    const cambios = Array.isArray(req.body?.acompanantes) ? req.body.acompanantes.slice(0, 30) : [];
    if (cambios.some((c) => !ESTADOS.has(c?.estado))) return res.status(400).json({ ok: false, msg: 'Respuesta inválida' });

    try {
        const titular = req.invitado;
        if (cambios.length) {
            const suyos = new Set((await acompanantesDe(titular)).map((a) => String(a.id)));
            if (cambios.some((c) => !suyos.has(String(c.id)))) return res.status(403).json({ ok: false, msg: 'No puedes responder por esta persona' });
            for (const c of cambios) {
                const patch = { state: c.estado };
                if (c.nombre !== undefined) patch.name = limpiar(c.nombre) || `Acompañante de ${nombre || titular.name}`;
                const { error } = await supabase.from('side_events_guests').update(patch)
                    .eq('id', c.id).eq('side_events_id', titular.side_events_id).eq('companion_id', String(titular.id));
                if (error) throw error;
            }
        }

        const patch = { state: estado };
        if (nombre) patch.name = nombre;
        const { data: invitado, error } = await supabase.from('side_events_guests').update(patch)
            .eq('id', titular.id).select('*').single();
        if (error) throw error;
        return res.json({ ok: true, invitado, acompanantes: await acompanantesDe(invitado) });
    } catch (err) {
        console.error('Error en POST /api/side-events/:id/respuesta:', err);
        return res.status(500).json({ ok: false, msg: 'No se pudo guardar tu respuesta' });
    }
});

// POST /api/side-events/:clave/avatar { emoji, perfil } → { ok, invitado }
router.post('/:id/avatar', conInvitado(limiteEscritura), async (req, res) => {
    try {
        const { data: invitado, error } = await supabase.from('side_events_guests')
            .update({ emoji: emojiValido(req.body?.emoji), profile: perfilValido(req.body?.perfil) })
            .eq('id', req.invitado.id).select('*').single();
        if (error) throw error;
        return res.json({ ok: true, invitado });
    } catch (err) {
        console.error('Error en POST /api/side-events/:id/avatar:', err);
        return res.status(500).json({ ok: false, msg: 'No se pudo guardar tu avatar' });
    }
});

module.exports = router;
