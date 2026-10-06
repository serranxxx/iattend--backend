const express = require('express');
const supabase = require('../config/supabase');
const { validarAccesoInvitacion } = require('../middlewares/validar-acceso-invitacion');

const router = express.Router();

// DELETE /api/save-the-date/:invitationId/reactions/:reactionId
// El organizador borra un mensaje (o emoji) que le dejaron en su Save the Date.
// La tabla no tiene GRANT de DELETE para anon (es pública para insertar), por
// eso el borrado pasa por aquí con la service role, tras validar el acceso.
router.delete('/:invitationId/reactions/:reactionId', validarAccesoInvitacion, async (req, res) => {
    try {
        const { invitationId, reactionId } = req.params;

        const { data: reaction, error: fetchError } = await supabase
            .from('save_the_date_reactions')
            .select('id, save_the_dates!inner(invitation_id)')
            .eq('id', reactionId)
            .maybeSingle();

        if (fetchError) throw fetchError;
        if (!reaction) {
            return res.status(404).json({ success: false, error: 'Mensaje no encontrado' });
        }
        // El mensaje tiene que ser del Save the Date de esta invitación
        if (String(reaction.save_the_dates?.invitation_id) !== String(invitationId)) {
            return res.status(403).json({ success: false, error: 'No tienes acceso a este mensaje' });
        }

        const { error: deleteError } = await supabase
            .from('save_the_date_reactions')
            .delete()
            .eq('id', reactionId);

        if (deleteError) throw deleteError;

        return res.json({ success: true });
    } catch (err) {
        console.error('Error en DELETE /api/save-the-date/:invitationId/reactions/:reactionId:', err);
        return res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

module.exports = router;
