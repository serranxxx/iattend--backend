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

const STORAGE_PACKAGE = { base_mb: 10, extra_mb: 30, cost: 100 };

// GET /api/storage/package — qué se ofrece.
router.get('/package', (_req, res) => res.json({ success: true, package: STORAGE_PACKAGE }));

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
