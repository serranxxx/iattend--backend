const express = require('express');
const crypto = require('crypto');
const supabase = require('../config/supabase');

const router = express.Router();

/*
  Confirmación en un side event público (`side_events.type = 'open'`, el
  candado abierto del editor de Flash). Sin código de invitado: quien abre el
  link da su nombre y el de sus acompañantes, y aquí se dan de alta en
  side_events_guests como un pase (titular + acompañantes con companion_id),
  igual que los que importa el organizador. Pasa por el backend (service
  role) para validar que el evento de verdad sea público: la anon key no
  tiene que poder insertar invitados en cualquier evento.
  La página del invitado (iattend-events, SideEvent.tsx) guarda el código del
  titular en localStorage para que al volver vea su respuesta y la cambie
  por el flujo normal (update por password).
*/

const ESTADOS = new Set(['confirmado', 'rechazado']);
const MAX_ACOMPANANTES = 10;
const MAX_NOMBRE = 80;

// Límite sencillo por IP: evita que alguien llene la lista de un evento con
// basura. En memoria (se reinicia con el proceso), suficiente para un link.
const VENTANA_MS = 10 * 60 * 1000;
// Holgado: varios invitados pueden salir con la misma IP (el wifi del salón).
const MAX_POR_VENTANA = 30;
const intentos = new Map();
const permitido = (ip) => {
    const ahora = Date.now();
    const recientes = (intentos.get(ip) ?? []).filter(t => ahora - t < VENTANA_MS);
    if (recientes.length >= MAX_POR_VENTANA) {
        intentos.set(ip, recientes);
        return false;
    }
    recientes.push(ahora);
    intentos.set(ip, recientes);
    return true;
};

const limpiar = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NOMBRE);

// Mismo estilo que los códigos de invitado: 6 caracteres sin los que se
// confunden (0/O, 1/I).
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const nuevoCodigo = () => Array.from(crypto.randomBytes(6), b => ALFABETO[b % ALFABETO.length]).join('');

// Avatar con que aparece en "Asistentes" (solo Flash): un emoji y/o un color
// (índice de la paleta `profiles` de iattend-events, ConfirmCard/profiles.ts;
// columnas side_events_guests.emoji / .profile). Sin ellos, sus iniciales con
// un color fijo por invitado.
const MAX_PERFIL = 15;
const emojiValido = (v) => {
    const e = String(v ?? '').trim();
    // Un solo grafema (emoji con modificadores incluidos), sin letras ni números.
    if (!e || e.length > 16 || /[\p{L}\p{N}<>]/u.test(e)) return null;
    const seg = typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter('es', { granularity: 'grapheme' }).segment(e)] : [e];
    return seg.length === 1 ? e : null;
};
const perfilValido = (v) => (Number.isInteger(v) && v >= 0 && v <= MAX_PERFIL ? v : null);
const primerNombre = (n) => String(n ?? '').trim().split(/\s+/)[0] || '';
// Solo letras: "Abuela (Lupita)" → "AL", no "A(".
const inicialesDe = (n) => String(n ?? '').trim().split(/\s+/).map(p => p.match(/\p{L}/u)?.[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';

// GET /api/side-events/:id/asistentes
// Quiénes confirmaron, para el cuadro "Asistentes" de un Flash (side event sin
// invitación) que lo tiene prendido (body.showAttendees). Solo primer nombre,
// iniciales y avatar: nada de teléfonos ni códigos. Más reciente primero.
router.get('/:id/asistentes', async (req, res) => {
    try {
        const { data: evento, error } = await supabase
            .from('side_events')
            .select('id, invitation_id, body')
            .eq('id', req.params.id)
            .maybeSingle();
        if (error) return res.status(500).json({ ok: false, msg: error.message });
        if (!evento || evento.invitation_id || !evento.body?.showAttendees) {
            return res.status(404).json({ ok: false, msg: 'Sin asistentes públicos' });
        }

        const { data, error: errAsist, count } = await supabase
            .from('side_events_guests')
            .select('id, name, emoji, profile, companion_id', { count: 'exact' })
            .eq('side_events_id', evento.id)
            .eq('state', 'confirmado')
            .order('last_update_date', { ascending: false })
            .limit(300);
        if (errAsist) return res.status(500).json({ ok: false, msg: errAsist.message });

        res.set('Cache-Control', 'no-store');
        return res.json({
            ok: true,
            total: count ?? data.length,
            asistentes: (data ?? []).map(g => ({
                id: String(g.id),
                nombre: primerNombre(g.name),
                iniciales: inicialesDe(g.name),
                emoji: emojiValido(g.emoji),
                perfil: perfilValido(g.profile),
                // Id del titular si es acompañante (la tarjeta los agrupa en cápsulas).
                titular: g.companion_id ? String(g.companion_id) : null,
            })),
        });
    } catch (err) {
        console.error('Error en GET /api/side-events/:id/asistentes:', err);
        return res.status(500).json({ ok: false, msg: 'Error interno del servidor' });
    }
});

// POST /api/side-events/:id/confirmacion-publica
// { nombre, acompanantes: string[], estado: 'confirmado' | 'rechazado', emoji?, perfil? }
router.post('/:id/confirmacion-publica', async (req, res) => {
    // Sin `trust proxy` en la app, req.ip es la del balanceador: se usa la
    // primera de x-forwarded-for (basta para un límite blando).
    const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.ip;
    if (!permitido(ip)) {
        return res.status(429).json({ ok: false, msg: 'Demasiados intentos. Inténtalo en unos minutos.' });
    }

    const nombre = limpiar(req.body?.nombre);
    const estado = req.body?.estado;
    const acompanantes = (Array.isArray(req.body?.acompanantes) ? req.body.acompanantes : [])
        .map(limpiar)
        .filter(Boolean);

    if (!nombre) return res.status(400).json({ ok: false, msg: 'Escribe tu nombre' });
    if (!ESTADOS.has(estado)) return res.status(400).json({ ok: false, msg: 'Respuesta inválida' });
    if (acompanantes.length > MAX_ACOMPANANTES) {
        return res.status(400).json({ ok: false, msg: `Máximo ${MAX_ACOMPANANTES} acompañantes` });
    }
    // Quien no va, no lleva acompañantes.
    const conAcompanantes = estado === 'confirmado' ? acompanantes : [];

    try {
        const { data: evento, error } = await supabase
            .from('side_events')
            .select('id, type')
            .eq('id', req.params.id)
            .maybeSingle();
        if (error) return res.status(500).json({ ok: false, msg: error.message });
        if (!evento) return res.status(404).json({ ok: false, msg: 'Evento no encontrado' });
        if (evento.type !== 'open') return res.status(403).json({ ok: false, msg: 'Este evento es privado' });

        const filaBase = {
            side_events_id: evento.id,
            phone_number: null,
            tier: null,
            tag: null,
            table: null,
            state: estado,
            last_action: estado,
            notes: 'Se registró desde el link público',
            meal: null,
            ticket: true,
            last_action_by: false,
        };

        const { data: titular, error: titularError } = await supabase
            .from('side_events_guests')
            .insert({
                ...filaBase, password: nuevoCodigo(), name: nombre, companion_id: null, has_companion: conAcompanantes.length > 0,
                emoji: estado === 'confirmado' ? emojiValido(req.body?.emoji) : null,
                profile: estado === 'confirmado' ? perfilValido(req.body?.perfil) : null,
            })
            .select('*')
            .single();
        if (titularError) return res.status(500).json({ ok: false, msg: titularError.message });

        let filasAcompanantes = [];
        if (conAcompanantes.length) {
            const { data, error: acompError } = await supabase
                .from('side_events_guests')
                .insert(conAcompanantes.map(n => ({ ...filaBase, password: nuevoCodigo(), name: n, companion_id: titular.id, has_companion: false })))
                .select('*');
            if (acompError) {
                // Sin sus acompañantes el pase queda a medias: se deshace.
                await supabase.from('side_events_guests').delete().eq('id', titular.id);
                return res.status(500).json({ ok: false, msg: acompError.message });
            }
            filasAcompanantes = data ?? [];
        }

        return res.json({ ok: true, invitado: titular, acompanantes: filasAcompanantes });
    } catch (err) {
        console.error('Error en POST /api/side-events/:id/confirmacion-publica:', err);
        return res.status(500).json({ ok: false, msg: 'Error interno del servidor' });
    }
});

module.exports = router;
