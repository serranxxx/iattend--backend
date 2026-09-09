const { response } = require('express');
const supabase = require('../config/supabase');

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;
const TIPOS_VALIDOS = ['reales', 'pruebas'];
// Una invitación es "de prueba" cuando su owner tiene alguno de estos roles
const ROLES_PRUEBA = ['sales', 'test', 'Administration'];

// Listado paginado para el catálogo de invitaciones del admin.
// No devuelve `data` completo: solo las llaves de portada, extraídas en el select.
// `tipo=reales|pruebas` separa clientes reales de invitaciones internas,
// filtrando en el servidor para que la paginación no las mezcle.
const listarInvitaciones = async (req, res = response) => {
    const parsedLimit = parseInt(req.query.limit, 10);
    const parsedOffset = parseInt(req.query.offset, 10);
    const limit = Math.min(Math.max(Number.isNaN(parsedLimit) ? DEFAULT_LIMIT : parsedLimit, 1), MAX_LIMIT);
    const offset = Math.max(Number.isNaN(parsedOffset) ? 0 : parsedOffset, 0);
    const tipo = TIPOS_VALIDOS.includes(req.query.tipo) ? req.query.tipo : null;

    try {
        let testUserIds = [];
        if (tipo) {
            const { data: perfiles, error: perfilesError } = await supabase
                .from('profiles')
                .select('user_id')
                .in('role', ROLES_PRUEBA);

            if (perfilesError) {
                return res.status(500).json({ ok: false, msg: perfilesError.message });
            }

            testUserIds = (perfiles || []).map(p => p.user_id).filter(Boolean);
        }

        if (tipo === 'pruebas' && !testUserIds.length) {
            return res.status(200).json({ ok: true, total: 0, limit, offset, invitations: [] });
        }

        let query = supabase
            .from('invitations')
            .select(
                'id, label, name, plan, active, started, created_at, ' +
                'user_id, user_email, event_date, owners, ' +
                'cover_image:data->cover->image->prod, ' +
                'cover_zoom:data->cover->image->zoom, ' +
                'cover_position:data->cover->image->position',
                { count: 'exact' }
            );

        if (tipo === 'pruebas') {
            query = query.in('user_id', testUserIds);
        } else if (tipo === 'reales' && testUserIds.length) {
            // user_id nulo cuenta como real (NOT IN a secas lo excluiría)
            query = query.or(`user_id.is.null,user_id.not.in.(${testUserIds.join(',')})`);
        }

        const { data, error, count } = await query
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) {
            return res.status(500).json({ ok: false, msg: error.message });
        }

        // Nombre del dueño desde profiles, para mostrarlo en la UI del catálogo
        const userIds = [...new Set((data || []).map(inv => inv.user_id).filter(Boolean))];
        let namesByUserId = {};

        if (userIds.length) {
            const { data: duenios, error: dueniosError } = await supabase
                .from('profiles')
                .select('user_id, full_name')
                .in('user_id', userIds);

            if (dueniosError) {
                return res.status(500).json({ ok: false, msg: dueniosError.message });
            }

            namesByUserId = (duenios || []).reduce((acc, d) => { acc[d.user_id] = d.full_name; return acc; }, {});
        }

        const invitations = (data || []).map(({ user_id, ...inv }) => ({
            ...inv,
            owner_name: namesByUserId[user_id] ?? null,
        }));

        return res.status(200).json({
            ok: true,
            total: count ?? 0,
            limit,
            offset,
            invitations,
        });

    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
}

// `data` completo de una sola invitación, para mandarlo por postMessage a /host
// al montar el iframe. Read-only: este módulo nunca escribe en `invitations`.
const obtenerInvitacionData = async (req, res = response) => {
    const { invitation_id } = req.params;

    try {
        const { data, error } = await supabase
            .from('invitations')
            .select('id, data')
            .eq('id', invitation_id)
            .single();

        if (error) {
            const status = error.code === 'PGRST116' ? 404 : 500;
            return res.status(status).json({ ok: false, msg: error.message });
        }

        return res.status(200).json({ ok: true, id: data.id, data: data.data });

    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
}

module.exports = {
    listarInvitaciones,
    obtenerInvitacionData,
}
