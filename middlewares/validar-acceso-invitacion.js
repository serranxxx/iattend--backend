const { response } = require('express');
const supabase = require('../config/supabase');

// Deja pasar solo a quien puede gestionar la invitación: el dueño, el planner
// asignado (con el rol vigente y activo) o Administration. Es la misma regla
// que can_manage_invitation() en la base (migrations/2026-09-24_planner_role.sql);
// aquí se repite porque el backend usa la service role y auth.uid() no existe.
//
// El id sale de req.params.invitationId o de req.body.invitation_id. Sin esto,
// cualquiera con el UUID (va en la página pública de la invitación) podía usar
// a Lia como si fuera el organizador.
const validarAccesoInvitacion = async (req, res = response, next) => {
    const authHeader = req.header('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const invitationId = req.params?.invitationId || req.body?.invitation_id;

    if (!token) {
        return res.status(401).json({ success: false, error: 'No hay token de sesión en la petición' });
    }
    if (!invitationId) {
        return res.status(400).json({ success: false, error: 'invitation_id requerido' });
    }

    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    const userId = userData?.user?.id;

    if (userError || !userId) {
        return res.status(401).json({ success: false, error: 'Token no válido' });
    }

    const [{ data: invitation, error: invError }, { data: profile, error: profileError }] = await Promise.all([
        supabase.from('invitations').select('id, user_id, planner_id, plan').eq('id', invitationId).maybeSingle(),
        supabase.from('profiles').select('role, active').eq('user_id', userId).maybeSingle(),
    ]);

    if (invError || profileError) {
        return res.status(500).json({ success: false, error: 'No se pudo validar el acceso' });
    }
    if (!invitation) {
        return res.status(404).json({ success: false, error: 'Invitación no encontrada' });
    }

    const activo = profile?.active ?? true;
    const puede = invitation.user_id === userId
        || (activo && profile?.role === 'Administration')
        || (activo && profile?.role === 'planner' && invitation.planner_id === userId);

    if (!puede) {
        return res.status(403).json({ success: false, error: 'No tienes acceso a esta invitación' });
    }

    req.userId = userId;
    req.invitation = invitation;
    next();
};

module.exports = { validarAccesoInvitacion };
