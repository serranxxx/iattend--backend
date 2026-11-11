const supabase = require('../config/supabase');
const { tieneFuncionesDePlanner } = require('./roles');

// Quién puede gestionar un evento: el dueño, el planner asignado (rol vigente
// y activo) o Administration. Es la regla de can_manage_invitation() en la
// base; se repite aquí porque el backend usa la service role. La misma regla
// vive en middlewares/validar-acceso-invitacion.js y validar-acceso-evento.js.

/** Id del usuario de la sesión de Supabase (Authorization: Bearer), o null. */
const usuarioDeSesion = async (req) => {
    const auth = req.header('Authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return null;
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user?.id) return null;
    return { id: data.user.id, email: data.user.email ?? null };
};

const perfilDe = async (userId) => {
    const { data, error } = await supabase
        .from('profiles').select('role, active').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return data;
};

const esAdminActivo = (perfil) => (perfil?.active ?? true) && perfil?.role === 'Administration';

const puedeGestionar = (perfil, userId, { user_id, planner_id }) => {
    const activo = perfil?.active ?? true;
    return user_id === userId
        || (activo && perfil?.role === 'Administration')
        || (activo && tieneFuncionesDePlanner(perfil?.role) && planner_id === userId);
};

// Dueños de un evento por su id: una invitación (uuid) o un side event / Pop
// (número). Un side event de boda se gestiona con los permisos de su invitación.
const duenosDeEvento = async (eventId) => {
    const id = String(eventId ?? '').replace(/^flash-/, '');
    if (!id) return null;

    if (!/^\d+$/.test(id)) {
        const { data, error } = await supabase
            .from('invitations').select('id, user_id, planner_id').eq('id', id).maybeSingle();
        if (error) throw error;
        return data;
    }

    const { data: side, error } = await supabase
        .from('side_events').select('id, invitation_id, user_id, planner_id').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!side) return null;
    if (!side.invitation_id) return side;
    return duenosDeEvento(side.invitation_id);
};

module.exports = { usuarioDeSesion, perfilDe, esAdminActivo, puedeGestionar, duenosDeEvento };
