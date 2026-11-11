/*
    Storage de "Subidos" de una invitación
    host + /api/storage

    Límite base de 10 MB (invitations.storage_limit_mb); se amplía a 30 MB por
    100 créditos I attend. El Photo Wall y el audio de la canción no cuentan
    (ver migración 2026-10-28c_storage_por_invitacion.sql). Única fuente del
    paquete: el front lo pide aquí.
*/

const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { validarAccesoInvitacion } = require('../middlewares/validar-acceso-invitacion');
const { tieneFuncionesDePlanner } = require('../helpers/roles');

const STORAGE_PACKAGE = { base_mb: 10, extra_mb: 30, cost: 100 };
// Pops: mismo precio por MB que la invitación (100 créditos / 20 MB = 5) y
// niveles 5 → 15 → 30 MB. Se cobra la diferencia con el límite actual
// (migración 2026-11-01_storage_pops.sql).
// Pops: base 10 MB (2026-11-11c_pops_storage_10mb.sql); 20 y 30 MB a 5 créditos por MB de diferencia.
const POP_STORAGE = { base_mb: 10, mb_cost: 5, levels: [20, 30] };

// GET /api/storage/package — qué se ofrece.
router.get('/package', (_req, res) => res.json({ success: true, package: STORAGE_PACKAGE, pop: POP_STORAGE }));

// Organizador del Pop (dueño, planner asignado o Administración), como el
// chat de asistentes (router/sideEventChat.js).
const validarOrganizadorPop = async (req, res, next) => {
    const auth = req.header('Authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ success: false, message: 'Inicia sesión' });
    try {
        const { data: userData } = await supabase.auth.getUser(token);
        const userId = userData?.user?.id;
        if (!userId) return res.status(401).json({ success: false, message: 'Sesión no válida' });
        const [{ data: pop }, { data: perfil }] = await Promise.all([
            supabase.from('side_events').select('id, invitation_id, user_id, planner_id, storage_limit_mb').eq('id', Number(req.body?.side_event_id)).maybeSingle(),
            supabase.from('profiles').select('role, active').eq('user_id', userId).maybeSingle(),
        ]);
        if (!pop || pop.invitation_id) return res.status(404).json({ success: false, message: 'Pop no encontrado' });
        const activo = perfil?.active ?? true;
        const puede = pop.user_id === userId
            || (activo && perfil?.role === 'Administration')
            || (activo && tieneFuncionesDePlanner(perfil?.role) && pop.planner_id === userId);
        if (!puede) return res.status(403).json({ success: false, message: 'No tienes acceso a este evento' });
        req.pop = pop;
        next();
    } catch (err) {
        console.error('[storage/pop] validar organizador', err?.message);
        return res.status(500).json({ success: false, message: 'No se pudo validar el acceso' });
    }
};

// POST /api/storage/pop-upgrade — { side_event_id, mb }: sube el límite del Pop
// a `mb` (15 o 30) cobrando 5 créditos por cada MB nuevo.
router.post('/pop-upgrade', validarOrganizadorPop, async (req, res) => {
    const mb = Number(req.body?.mb);
    if (!POP_STORAGE.levels.includes(mb)) return res.status(400).json({ success: false, message: 'Paquete no válido' });
    const actual = req.pop.storage_limit_mb ?? POP_STORAGE.base_mb;
    if (actual >= mb) return res.status(409).json({ success: false, code: 'ALREADY_UPGRADED', message: 'Este Pop ya tiene ese espacio' });
    const cost = (mb - actual) * POP_STORAGE.mb_cost;
    try {
        const { data, error } = await supabase.rpc('comprar_storage_pop', {
            p_side_event_id: req.pop.id,
            p_cost: cost,
            p_new_limit_mb: mb,
        });
        if (error) throw error;
        if (!data?.success) {
            const status = data?.code === 'NOT_ENOUGH_CREDITS' ? 402 : data?.code === 'ALREADY_UPGRADED' ? 409 : 400;
            const message = data?.code === 'NOT_ENOUGH_CREDITS' ? 'No tienes suficientes créditos'
                : data?.code === 'ALREADY_UPGRADED' ? 'Este Pop ya tiene ese espacio'
                : 'No se pudo ampliar el espacio';
            return res.status(status).json({ success: false, code: data?.code, message });
        }
        return res.json({ success: true, cost, ...data });
    } catch (err) {
        console.error('[storage/pop-upgrade]', err?.message);
        return res.status(500).json({ success: false, message: 'No se pudo ampliar el espacio' });
    }
});

// POST /api/storage/upgrade — { invitation_id }: 10 → 30 MB por 100 créditos.
router.post('/upgrade', validarAccesoInvitacion, async (req, res) => {
    const { invitation_id } = req.body;
    try {
        const { data, error } = await supabase.rpc('comprar_storage_extra', {
            p_invitation_id: invitation_id,
            p_cost: STORAGE_PACKAGE.cost,
            p_new_limit_mb: STORAGE_PACKAGE.extra_mb,
        });
        if (error) throw error;

        if (!data?.success) {
            const status = data?.code === 'NOT_ENOUGH_CREDITS' ? 402 : data?.code === 'ALREADY_UPGRADED' ? 409 : 400;
            const message = data?.code === 'NOT_ENOUGH_CREDITS' ? 'No tienes suficientes créditos I attend'
                : data?.code === 'ALREADY_UPGRADED' ? 'Este evento ya tiene el espacio ampliado'
                : 'No se pudo ampliar el espacio';
            return res.status(status).json({ success: false, code: data?.code, message });
        }
        return res.json({ success: true, ...data });
    } catch (err) {
        console.error('[storage/upgrade]', err?.message);
        return res.status(500).json({ success: false, message: 'No se pudo ampliar el espacio' });
    }
});

module.exports = router;
