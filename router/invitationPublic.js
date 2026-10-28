const express = require('express');
const crypto = require('crypto');
const supabase = require('../config/supabase');
const { validarAccesoInvitacion } = require('../middlewares/validar-acceso-invitacion');

const router = express.Router();

/*
  Confirmación en una invitación pública (`invitations.type = 'open'`, el
  candado abierto del header del dashboard en iattend-vite). Sin código de
  invitado: quien abre el link da su nombre y el de sus acompañantes, y aquí
  se dan de alta en `guests` como un pase (titular + acompañantes con
  companion_id). Mismo flujo que los Flash públicos (sideEventPublic.js).
  Pasa por el backend (service role) para validar que la invitación de verdad
  sea pública: la anon key no tiene que poder insertar invitados en cualquier
  invitación. La página del invitado (iattend-events, Confirm.tsx) guarda el
  código del titular en localStorage para que al volver vea su respuesta.
*/

const MAX_ACOMPANANTES = 10;
const MAX_NOMBRE = 80;

// Límite sencillo por IP (en memoria): evita que llenen la lista con basura.
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

// POST /api/invitations/:id/confirmacion-publica
// { nombre, acompanantes: string[] }  → confirma asistencia
router.post('/:id/confirmacion-publica', async (req, res) => {
    const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.ip;
    if (!permitido(ip)) {
        return res.status(429).json({ ok: false, msg: 'Demasiados intentos. Inténtalo en unos minutos.' });
    }

    const nombre = limpiar(req.body?.nombre);
    const acompanantes = (Array.isArray(req.body?.acompanantes) ? req.body.acompanantes : [])
        .map(limpiar)
        .filter(Boolean);

    if (!nombre) return res.status(400).json({ ok: false, msg: 'Escribe tu nombre' });
    if (acompanantes.length > MAX_ACOMPANANTES) {
        return res.status(400).json({ ok: false, msg: `Máximo ${MAX_ACOMPANANTES} acompañantes` });
    }

    try {
        const { data: invitacion, error } = await supabase
            .from('invitations')
            .select('id, type')
            .eq('id', req.params.id)
            .maybeSingle();
        if (error) return res.status(500).json({ ok: false, msg: error.message });
        if (!invitacion) return res.status(404).json({ ok: false, msg: 'Invitación no encontrada' });
        if (invitacion.type !== 'open') return res.status(403).json({ ok: false, msg: 'Esta invitación es privada' });

        // Mismos campos que guardaba el flujo abierto de la invitación
        // (Confirm.tsx), para que se vean igual en la gestión de invitados.
        const ahora = new Date().toISOString();
        const filaBase = {
            invitation_id: invitacion.id,
            phone_number: '',
            tier: 'A',
            tag: '',
            table: null,
            state: 'confirmado',
            last_action: 'creado',
            notes: 'Se registró desde el link público',
            meal: null,
            ticket: true,
            last_action_by: 'guest',
            created_at: ahora,
            last_update_date: ahora,
            side: null,
            type: null,
            invitation_sent_at: null,
            reminder_count: 0,
            last_reminder_at: null,
            special_needs: null,
        };

        const { data: titular, error: titularError } = await supabase
            .from('guests')
            .insert({ ...filaBase, password: nuevoCodigo(), name: nombre, companion_id: null, has_companion: acompanantes.length > 0 })
            .select('*')
            .single();
        if (titularError) return res.status(500).json({ ok: false, msg: titularError.message });

        let filasAcompanantes = [];
        if (acompanantes.length) {
            const { data, error: acompError } = await supabase
                .from('guests')
                .insert(acompanantes.map(n => ({ ...filaBase, password: nuevoCodigo(), name: n, companion_id: titular.id, has_companion: false })))
                .select('*');
            if (acompError) {
                // Sin sus acompañantes el pase queda a medias: se deshace.
                await supabase.from('guests').delete().eq('id', titular.id);
                return res.status(500).json({ ok: false, msg: acompError.message });
            }
            filasAcompanantes = data ?? [];
        }

        return res.json({ ok: true, invitado: titular, acompanantes: filasAcompanantes });
    } catch (err) {
        console.error('Error en POST /api/invitations/:id/confirmacion-publica:', err);
        return res.status(500).json({ ok: false, msg: 'Error interno del servidor' });
    }
});

// PATCH /api/invitations/:invitationId/acceso — { type: 'open' | 'closed' }
// El candado del header de iattend-vite. Por aquí y no directo desde el front:
// con la anon key, si las políticas de la tabla no dejan actualizar la fila
// (planner, admin), Supabase no marca error y el cambio no se guardaba.
// Pueden cambiarlo el dueño, el planner asignado o Administración.
router.patch('/:invitationId/acceso', validarAccesoInvitacion, async (req, res) => {
    const type = req.body?.type;
    if (type !== 'open' && type !== 'closed') {
        return res.status(400).json({ success: false, error: 'type debe ser open o closed' });
    }
    try {
        const { data, error } = await supabase
            .from('invitations')
            .update({ type })
            .eq('id', req.params.invitationId)
            .select('id, type')
            .maybeSingle();
        if (error) return res.status(500).json({ success: false, error: error.message });
        if (!data) return res.status(404).json({ success: false, error: 'Invitación no encontrada' });
        return res.json({ success: true, type: data.type });
    } catch (err) {
        console.error('Error en PATCH /api/invitations/:id/acceso:', err);
        return res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

module.exports = router;
