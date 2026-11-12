const express = require('express');
const supabase = require('../config/supabase');
const { crearLimite } = require('../helpers/limiteMemoria');
const { buscarSideEventPorClave } = require('../helpers/sideEventClave');
const { tieneFuncionesDePlanner } = require('../helpers/roles');

const router = express.Router();

/*
  Pop en línea (handoff "Pop · Evento en línea"): el enlace (Zoom / Meet /
  YouTube), sus códigos y el material viven en la tabla side_event_acceso
  (migrations/2026-11-12c_acceso_en_tabla.sql). No en side_events: la RPC
  pública side_event_publico devuelve la fila completa (menos datos del
  dueño), así que una columna ahí se filtraba antes de confirmar.
  Aquí se entregan:
  · si el Pop no es "solo para confirmados", a cualquiera con su clave;
  · si lo es, al invitado confirmado (header x-codigo-invitado = su código)
    o al organizador (Authorization: Bearer, para "Ver en vivo").
  Los archivos van en el bucket privado pop-material y salen con un link
  firmado de 1 h.
*/

const limite = crearLimite({ max: 60, ventanaMs: 60 * 1000 });
const ipDe = (req) => String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.ip;
const FIRMA_SEG = 60 * 60;
const ESTADOS_CONFIRMADOS = new Set(['confirmado', 'asistente']);

const esOrganizador = async (req, evento) => {
    const auth = req.header('Authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return false;
    const { data } = await supabase.auth.getUser(token);
    const uid = data?.user?.id;
    if (!uid) return false;
    if (evento.user_id === uid) return true;
    const { data: perfil } = await supabase.from('profiles').select('role, active').eq('user_id', uid).maybeSingle();
    const activo = perfil?.active ?? true;
    return (activo && perfil?.role === 'Administration') || (activo && tieneFuncionesDePlanner(perfil?.role) && evento.planner_id === uid);
};

// El acceso del Pop: la tabla y, mientras no exista, la columna de antes.
const accesoDe = async (id) => {
    const { data, error } = await supabase.from('side_event_acceso').select('data').eq('side_event_id', id).maybeSingle();
    if (!error) return data?.data ?? null;
    if (!['42P01', 'PGRST205', 'PGRST106'].includes(error.code)) throw error;
    const { data: fila, error: e2 } = await supabase.from('side_events').select('acceso').eq('id', id).maybeSingle();
    if (e2) return null;
    return fila?.acceso ?? null;
};

const confirmado = async (req, evento) => {
    const codigo = String(req.header('x-codigo-invitado') ?? '').trim();
    if (!codigo) return false;
    const { data } = await supabase.from('side_events_guests').select('id, state')
        .eq('side_events_id', evento.id).eq('password', codigo).maybeSingle();
    return !!data && ESTADOS_CONFIRMADOS.has(data.state);
};

// Solo lo que la página necesita (nunca el path del archivo).
const paraInvitado = async (acceso) => {
    const material = await Promise.all((Array.isArray(acceso.material) ? acceso.material : []).map(async (m) => {
        if (m?.kind === 'link') return { id: m.id, kind: 'link', title: m.title || '', url: m.url || '' };
        if (m?.kind !== 'file' || !m.path) return null;
        const nombre = `${String(m.title || 'archivo').replace(/[\\/:*?"<>|]+/g, '')}.${String(m.path).split('.').pop()}`;
        const { data } = await supabase.storage.from('pop-material').createSignedUrl(m.path, FIRMA_SEG, { download: nombre });
        return { id: m.id, kind: 'file', title: m.title || '', mime: m.mime || null, size: m.size || 0, descarga: data?.signedUrl ?? null };
    }));
    return {
        url: acceso.url || '',
        meetingId: acceso.meetingId || '',
        passcode: acceso.passcode || '',
        material: material.filter(Boolean),
    };
};

// GET /api/side-events/:clave/acceso → { ok, acceso } | 403 { ok:false, bloqueado:true }
router.get('/:id/acceso', async (req, res) => {
    if (!limite(`a:${ipDe(req)}`)) return res.status(429).json({ ok: false, msg: 'Demasiados intentos. Inténtalo en unos minutos.' });
    try {
        const evento = await buscarSideEventPorClave(req.params.id, 'id, body, user_id, planner_id');
        if (!evento) return res.status(404).json({ ok: false, msg: 'Evento no encontrado' });
        const acceso = evento.body?.modo === 'online' ? await accesoDe(evento.id) : null;
        if (!acceso) return res.status(404).json({ ok: false, msg: 'Este evento no es en línea' });

        const abierto = acceso.onlyConfirmed === false;
        const puede = abierto || await confirmado(req, evento) || await esOrganizador(req, evento);
        if (!puede) return res.status(403).json({ ok: false, bloqueado: true, msg: 'Confirma tu asistencia para verlo' });

        res.set('Cache-Control', 'private, no-store');
        return res.json({ ok: true, acceso: await paraInvitado(acceso) });
    } catch (err) {
        console.error('Error en GET /api/side-events/:id/acceso:', err);
        return res.status(500).json({ ok: false, msg: 'Error interno del servidor' });
    }
});

module.exports = router;
