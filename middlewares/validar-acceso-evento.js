const { response } = require('express');
const supabase = require('../config/supabase');
const { tieneFuncionesDePlanner } = require('../helpers/roles');

// Deja pasar solo a quien puede gestionar el evento del envío: el dueño, el
// planner asignado (rol vigente y activo) o Administration. Misma regla que
// validar-acceso-invitacion.js y conOrganizador de router/sideEventChat.js,
// pero para las rutas que reciben el evento en el body (/api/whats/*,
// /api/guests/import/*):
//   · invitationId | invitation_id → invitación.
//   · sideEventId | side_events_id → side event. Si cuelga de una invitación,
//     manda la regla de esa invitación; si no (Pop), la del propio side event.
// Si viene guestId (o items[].guestId), también revisa que esos invitados sean
// de ese evento: el worker marca el estado del invitado por su id.
//
// Antes /api/whats no pedía sesión: cualquiera podía mandar plantillas de
// WhatsApp con cualquier sideEventId / to y gastar la cuenta de Meta.

const sesionDe = async (req) => {
    const auth = req.header('Authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return null;
    const { data } = await supabase.auth.getUser(token);
    return data?.user?.id ?? null;
};

const puedeConPerfil = (perfil, userId, { user_id, planner_id }) => {
    const activo = perfil?.active ?? true;
    return user_id === userId
        || (activo && perfil?.role === 'Administration')
        || (activo && tieneFuncionesDePlanner(perfil?.role) && planner_id === userId);
};

// Ids de invitados que no son de este evento (vacío = todos son suyos).
const invitadosAjenos = async (ids, { sideEventId, invitationId }) => {
    const unicos = [...new Set(ids.filter(v => v != null && v !== '').map(String))];
    if (!unicos.length) return [];
    const consulta = sideEventId
        ? supabase.from('side_events_guests').select('id').eq('side_events_id', sideEventId).in('id', unicos)
        : supabase.from('guests').select('id').eq('invitation_id', invitationId).in('id', unicos);
    const { data, error } = await consulta;
    if (error) throw error;
    const suyos = new Set((data ?? []).map(g => String(g.id)));
    return unicos.filter(id => !suyos.has(id));
};

const validarAccesoEvento = async (req, res = response, next) => {
    try {
        const body = req.body || {};
        const sideEventId = body.sideEventId ?? body.side_events_id ?? null;
        let invitationId = body.invitationId || body.invitation_id || null;

        if (!sideEventId && !invitationId) {
            return res.status(400).json({ ok: false, msg: 'invitationId o sideEventId requerido' });
        }

        const userId = await sesionDe(req);
        if (!userId) return res.status(401).json({ ok: false, msg: 'Inicia sesión' });

        const { data: perfil, error: errPerfil } = await supabase
            .from('profiles').select('role, active').eq('user_id', userId).maybeSingle();
        if (errPerfil) throw errPerfil;

        let evento;
        if (sideEventId) {
            const { data: side, error } = await supabase
                .from('side_events')
                .select('id, invitation_id, user_id, planner_id')
                .eq('id', sideEventId)
                .maybeSingle();
            if (error) throw error;
            if (!side) return res.status(404).json({ ok: false, msg: 'Evento no encontrado' });
            // Un side event de boda se gestiona con los permisos de su invitación;
            // no se acepta un invitationId de otra invitación junto a él.
            if (side.invitation_id) {
                if (invitationId && String(invitationId) !== String(side.invitation_id)) {
                    return res.status(400).json({ ok: false, msg: 'El side event no es de esa invitación' });
                }
                invitationId = side.invitation_id;
            } else {
                if (invitationId) {
                    return res.status(400).json({ ok: false, msg: 'Un Pop no lleva invitationId' });
                }
                evento = side;
            }
        }

        if (!evento) {
            const { data: inv, error } = await supabase
                .from('invitations')
                .select('id, user_id, planner_id')
                .eq('id', invitationId)
                .maybeSingle();
            if (error) throw error;
            if (!inv) return res.status(404).json({ ok: false, msg: 'Invitación no encontrada' });
            evento = inv;
        }

        if (!puedeConPerfil(perfil, userId, evento)) {
            return res.status(403).json({ ok: false, msg: 'No tienes acceso a este evento' });
        }

        const guestIds = [
            body.guestId,
            ...(Array.isArray(body.items) ? body.items.map(i => i?.guestId) : []),
        ];
        const ajenos = await invitadosAjenos(guestIds, { sideEventId, invitationId });
        if (ajenos.length) {
            return res.status(403).json({ ok: false, msg: 'Hay invitados que no son de este evento' });
        }

        req.userId = userId;
        next();
    } catch (err) {
        console.error('Error validando el acceso al evento:', err);
        return res.status(500).json({ ok: false, msg: 'No se pudo validar el acceso' });
    }
};

module.exports = { validarAccesoEvento };
