const express = require('express');
const supabase = require('../config/supabase');
const { crearLimite } = require('../helpers/limiteMemoria');
const { tieneFuncionesDePlanner } = require('../helpers/roles');

const router = express.Router();

/*
  Chat de asistentes de un Evento Flash (migración 2026-10-29b_flash_chat.sql;
  página: iattend-events components/SideEvent/Chat/). Reglas:
  · Existe si el Flash (side event sin invitación) tiene Asistentes visible
    (body.showAttendees) y el chat prendido (body.chat.enabled).
  · Solo los invitados que confirmaron leen y escriben. Se identifican con su
    código (header x-codigo-invitado = side_events_guests.password).
  · Lo que se escribe con un código sale a nombre de ese invitado (el titular
    de su pase).
  · El organizador (dueño, planner asignado o Administración) modera con su
    sesión: lista y borra mensajes.
  · Tiempo real: un aviso SIN contenido por broadcast al canal side_chat_<id>;
    la página vuelve a pedir los mensajes con su código. Así el texto nunca
    viaja por un canal que cualquiera podría escuchar.
*/

const MAX_TEXTO = 500;
const POR_PAGINA = 50;
const REACCIONES = ['❤️', '😂', '🔥', '👏', '🎉'];
const limiteMensajes = crearLimite({ max: 20, ventanaMs: 60 * 1000 });
const limiteReacciones = crearLimite({ max: 60, ventanaMs: 60 * 1000 });

const primerNombre = (n) => String(n ?? '').trim().split(/\s+/)[0] || '';
const inicialesDe = (n) => String(n ?? '').trim().split(/\s+/).map(p => p.match(/\p{L}/u)?.[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';

const cargarEvento = async (id) => {
    const { data, error } = await supabase
        .from('side_events')
        .select('id, invitation_id, body, user_id, planner_id')
        .eq('id', id)
        .maybeSingle();
    if (error) throw error;
    return data;
};

const chatActivo = (evento) => Boolean(evento && !evento.invitation_id && evento.body?.showAttendees && evento.body?.chat?.enabled);

// Invitado confirmado dueño del código, o null.
const invitadoDe = async (req, evento) => {
    const codigo = String(req.header('x-codigo-invitado') ?? '').trim();
    if (!codigo) return null;
    const { data } = await supabase
        .from('side_events_guests')
        .select('id, name, emoji, profile, companion_id, state')
        .eq('side_events_id', evento.id)
        .eq('password', codigo)
        .maybeSingle();
    return data?.state === 'confirmado' ? data : null;
};

// Aviso sin contenido: "hay algo nuevo, vuelve a pedirlo".
const avisar = async (eventoId) => {
    try {
        const canal = supabase.channel(`side_chat_${eventoId}`);
        await canal.httpSend('cambio', { t: Date.now() });
        supabase.removeChannel(canal);
    } catch (err) {
        console.error('No se pudo avisar al chat', eventoId, err?.message ?? err);
    }
};

const autorPublico = (g) => ({
    id: String(g.id),
    nombre: primerNombre(g.name),
    iniciales: inicialesDe(g.name),
    emoji: g.emoji || null,
    perfil: Number.isInteger(g.profile) ? g.profile : null,
    titular: g.companion_id ? String(g.companion_id) : null,
});

// Middleware: el evento existe, es Flash, tiene el chat prendido y quien
// pide es un invitado confirmado.
const conInvitado = async (req, res, next) => {
    try {
        const evento = await cargarEvento(req.params.id);
        if (!chatActivo(evento)) return res.status(404).json({ ok: false, msg: 'Este evento no tiene chat' });
        const invitado = await invitadoDe(req, evento);
        if (!invitado) return res.status(403).json({ ok: false, msg: 'Solo los confirmados pueden entrar al chat' });
        req.evento = evento;
        req.invitado = invitado;
        next();
    } catch (err) {
        console.error('Error validando el chat:', err);
        return res.status(500).json({ ok: false, msg: 'Error interno del servidor' });
    }
};

// Middleware: sesión del organizador del Flash (dueño, planner asignado o Administración).
const conOrganizador = async (req, res, next) => {
    const auth = req.header('Authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ ok: false, msg: 'Inicia sesión' });
    try {
        const { data: userData } = await supabase.auth.getUser(token);
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
        console.error('Error validando al organizador del chat:', err);
        return res.status(500).json({ ok: false, msg: 'Error interno del servidor' });
    }
};

// GET /api/side-events/:id/chat?antes=<iso>
// → { ok, yo, fijado, mensajes (viejo → nuevo), hayMas, autores, reacciones }
router.get('/:id/chat', conInvitado, async (req, res) => {
    try {
        let consulta = supabase
            .from('side_event_messages')
            .select('id, guest_id, text, created_at')
            .eq('side_event_id', req.evento.id)
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .limit(POR_PAGINA + 1);
        if (req.query.antes) consulta = consulta.lt('created_at', String(req.query.antes));
        const { data: filas, error } = await consulta;
        if (error) throw error;

        const hayMas = filas.length > POR_PAGINA;
        const mensajes = filas.slice(0, POR_PAGINA).reverse();
        const ids = mensajes.map(m => m.id);
        const autoresIds = [...new Set(mensajes.map(m => m.guest_id))];

        const [{ data: autores }, { data: reacciones }] = await Promise.all([
            autoresIds.length
                ? supabase.from('side_events_guests').select('id, name, emoji, profile, companion_id').in('id', autoresIds)
                : Promise.resolve({ data: [] }),
            ids.length
                ? supabase.from('side_event_reactions').select('message_id, guest_id, emoji').in('message_id', ids)
                : Promise.resolve({ data: [] }),
        ]);

        const yo = String(req.invitado.id);
        const porMensaje = {};
        for (const r of reacciones ?? []) {
            const m = (porMensaje[r.message_id] ??= {});
            const e = (m[r.emoji] ??= { count: 0, mine: false });
            e.count += 1;
            if (String(r.guest_id) === yo) e.mine = true;
        }

        res.set('Cache-Control', 'no-store');
        return res.json({
            ok: true,
            yo,
            fijado: req.evento.body?.chat?.pinned?.text ? { text: String(req.evento.body.chat.pinned.text).slice(0, 500) } : null,
            hayMas,
            mensajes: mensajes.map(m => ({ id: m.id, autor: String(m.guest_id), text: m.text, created_at: m.created_at })),
            autores: Object.fromEntries((autores ?? []).map(a => [String(a.id), autorPublico(a)])),
            reacciones: porMensaje,
        });
    } catch (err) {
        console.error('Error en GET /api/side-events/:id/chat:', err);
        return res.status(500).json({ ok: false, msg: 'No se pudo cargar el chat' });
    }
});

// POST /api/side-events/:id/chat { texto }
router.post('/:id/chat', conInvitado, async (req, res) => {
    const texto = String(req.body?.texto ?? '').replace(/\s+$/g, '').trim().slice(0, MAX_TEXTO);
    if (!texto) return res.status(400).json({ ok: false, msg: 'Escribe un mensaje' });
    if (!limiteMensajes(`m:${req.invitado.id}`)) {
        return res.status(429).json({ ok: false, msg: 'Vas muy rápido. Espera un momento.' });
    }
    try {
        const { data, error } = await supabase
            .from('side_event_messages')
            .insert({ side_event_id: req.evento.id, guest_id: req.invitado.id, text: texto })
            .select('id, guest_id, text, created_at')
            .single();
        if (error) throw error;
        avisar(req.evento.id);
        return res.json({ ok: true, mensaje: { id: data.id, autor: String(data.guest_id), text: data.text, created_at: data.created_at } });
    } catch (err) {
        console.error('Error en POST /api/side-events/:id/chat:', err);
        return res.status(500).json({ ok: false, msg: 'No se pudo enviar' });
    }
});

// POST /api/side-events/:id/chat/:msgId/reaccion { emoji } → prende / apaga la mía.
router.post('/:id/chat/:msgId/reaccion', conInvitado, async (req, res) => {
    const emoji = String(req.body?.emoji ?? '');
    if (!REACCIONES.includes(emoji)) return res.status(400).json({ ok: false, msg: 'Reacción no válida' });
    if (!limiteReacciones(`r:${req.invitado.id}`)) return res.status(429).json({ ok: false, msg: 'Espera un momento' });
    try {
        const { data: mensaje } = await supabase
            .from('side_event_messages')
            .select('id')
            .eq('id', req.params.msgId)
            .eq('side_event_id', req.evento.id)
            .is('deleted_at', null)
            .maybeSingle();
        if (!mensaje) return res.status(404).json({ ok: false, msg: 'Mensaje no encontrado' });

        const clave = { message_id: mensaje.id, guest_id: req.invitado.id, emoji };
        const { data: ya } = await supabase.from('side_event_reactions').select('message_id').match(clave).maybeSingle();
        const { error } = ya
            ? await supabase.from('side_event_reactions').delete().match(clave)
            : await supabase.from('side_event_reactions').insert(clave);
        if (error) throw error;
        avisar(req.evento.id);
        return res.json({ ok: true, mia: !ya });
    } catch (err) {
        console.error('Error en POST /api/side-events/:id/chat/:msgId/reaccion:', err);
        return res.status(500).json({ ok: false, msg: 'No se pudo reaccionar' });
    }
});

// ── Organizador ──

// GET /api/side-events/:id/chat-moderacion → los últimos 100 con nombre completo.
router.get('/:id/chat-moderacion', conOrganizador, async (req, res) => {
    try {
        const { data: filas, error } = await supabase
            .from('side_event_messages')
            .select('id, guest_id, text, created_at')
            .eq('side_event_id', req.evento.id)
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .limit(100);
        if (error) throw error;
        const ids = [...new Set(filas.map(f => f.guest_id))];
        const { data: autores } = ids.length
            ? await supabase.from('side_events_guests').select('id, name, emoji, profile').in('id', ids)
            : { data: [] };
        const porId = Object.fromEntries((autores ?? []).map(a => [String(a.id), a]));
        return res.json({
            ok: true,
            mensajes: filas.map(f => {
                const a = porId[String(f.guest_id)];
                return {
                    id: f.id,
                    autor: a?.name ?? '',
                    // Para su avatar en el editor (mismo color / emoji que en la página).
                    autorId: String(f.guest_id),
                    emoji: a?.emoji || null,
                    perfil: Number.isInteger(a?.profile) ? a.profile : null,
                    text: f.text,
                    created_at: f.created_at,
                };
            }),
        });
    } catch (err) {
        console.error('Error en GET /api/side-events/:id/chat-moderacion:', err);
        return res.status(500).json({ ok: false, msg: 'No se pudo cargar el chat' });
    }
});

// DELETE /api/side-events/:id/chat/:msgId → lo oculta (deleted_at).
router.delete('/:id/chat/:msgId', conOrganizador, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('side_event_messages')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', req.params.msgId)
            .eq('side_event_id', req.evento.id)
            .select('id')
            .maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ ok: false, msg: 'Mensaje no encontrado' });
        avisar(req.evento.id);
        return res.json({ ok: true });
    } catch (err) {
        console.error('Error en DELETE /api/side-events/:id/chat/:msgId:', err);
        return res.status(500).json({ ok: false, msg: 'No se pudo borrar' });
    }
});

// POST /api/side-events/:id/chat/:msgId/restaurar → deshace un borrado.
router.post('/:id/chat/:msgId/restaurar', conOrganizador, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('side_event_messages')
            .update({ deleted_at: null })
            .eq('id', req.params.msgId)
            .eq('side_event_id', req.evento.id)
            .select('id')
            .maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ ok: false, msg: 'Mensaje no encontrado' });
        avisar(req.evento.id);
        return res.json({ ok: true });
    } catch (err) {
        console.error('Error en POST /api/side-events/:id/chat/:msgId/restaurar:', err);
        return res.status(500).json({ ok: false, msg: 'No se pudo restaurar' });
    }
});

module.exports = router;
