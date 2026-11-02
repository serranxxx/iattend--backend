const express = require('express');
const supabase = require('../config/supabase');
const { crearLimite } = require('../helpers/limiteMemoria');

const router = express.Router();

/*
  Lector de pases de un Pop (iattend-vite /scanner?pop=<id>, sin sesión).
  Antes leía y escribía side_events_guests directo con la anon key (y con
  ?pop=<id> entraba sin clave). Ahora pasa por aquí con la clave de acceso
  del lector en x-clave-lector: los mismos 4 caracteres de siempre
  (`clavePop` de iattend-vite pages/Scanner/scannerUtils.js, copia exacta
  abajo), para no romper las claves que ya se compartieron.
  Ojo: esa clave sale del id con una fórmula que va en el bundle de vite;
  falta una clave al azar por evento (ver el reporte de esta sesión).
*/

const ESTADOS_LISTA = ['confirmado', 'asistente'];
const limite = crearLimite({ max: 120, ventanaMs: 60 * 1000 });

// Igual que clavePop en scannerUtils.js (FNV-1a de "flash-<id>", base 36, 4 caracteres).
const clavePop = (id) => {
    let h = 2166136261;
    for (const c of `flash-${id}`) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36).padStart(4, '0').slice(-4);
};

const conClave = async (req, res, next) => {
    const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.ip;
    if (!limite(`l:${ip}`)) return res.status(429).json({ ok: false, msg: 'Demasiados intentos' });
    const id = String(req.params.id ?? '');
    const clave = String(req.header('x-clave-lector') ?? '').trim().toLowerCase();
    if (!/^\d{1,18}$/.test(id) || !clave || clave !== clavePop(id)) {
        return res.status(403).json({ ok: false, msg: 'Clave incorrecta' });
    }
    try {
        const { data: evento, error } = await supabase.from('side_events')
            .select('id, name, invitation_id, hour:body->>hour').eq('id', id).maybeSingle();
        if (error) throw error;
        if (!evento || evento.invitation_id) return res.status(404).json({ ok: false, msg: 'Evento no encontrado' });
        req.evento = evento;
        next();
    } catch (err) {
        console.error('Error validando el lector del Pop:', err);
        return res.status(500).json({ ok: false, msg: 'Error interno del servidor' });
    }
};

// GET /api/lector/pop/:id → { ok, nombre, hora, invitados }
router.get('/pop/:id', conClave, async (req, res) => {
    try {
        const { data, error } = await supabase.from('side_events_guests')
            .select('id, name, state, table, companion_id, arrived_at')
            .eq('side_events_id', req.evento.id).in('state', ESTADOS_LISTA).order('name');
        if (error) throw error;
        res.set('Cache-Control', 'no-store');
        return res.json({ ok: true, nombre: req.evento.name, hora: req.evento.hour, invitados: data ?? [] });
    } catch (err) {
        console.error('Error en GET /api/lector/pop/:id:', err);
        return res.status(500).json({ ok: false, msg: 'No se pudo cargar la lista' });
    }
});

// POST /api/lector/pop/:id/llegadas { cambios: [{ id, state: 'asistente' | 'confirmado', arrived_at }] }
// Marcar / quitar la llegada (y deshacer). Solo invitados del Pop que están en la lista.
router.post('/pop/:id/llegadas', conClave, async (req, res) => {
    const cambios = Array.isArray(req.body?.cambios) ? req.body.cambios.slice(0, 60) : [];
    if (!cambios.length || cambios.some((c) => !ESTADOS_LISTA.includes(c?.state) || !/^\d{1,18}$/.test(String(c?.id ?? '')))) {
        return res.status(400).json({ ok: false, msg: 'Cambios inválidos' });
    }
    try {
        for (const c of cambios) {
            const llegada = c.state === 'asistente' ? (c.arrived_at && !Number.isNaN(Date.parse(c.arrived_at)) ? c.arrived_at : new Date().toISOString()) : null;
            const { error } = await supabase.from('side_events_guests')
                .update({ state: c.state, arrived_at: llegada })
                .eq('id', c.id).eq('side_events_id', req.evento.id).in('state', ESTADOS_LISTA);
            if (error) throw error;
        }
        return res.json({ ok: true });
    } catch (err) {
        console.error('Error en POST /api/lector/pop/:id/llegadas:', err);
        return res.status(500).json({ ok: false, msg: 'No se pudo guardar' });
    }
});

module.exports = router;
