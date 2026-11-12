const supabase = require('../config/supabase');

// Importar invitados a un Pop desde otro evento del mismo organizador.
// Va detrás de validarAccesoEvento (sesión + acceso al evento destino, que
// deja req.userId). Aquí se revisa que el evento ORIGEN también sea suyo:
// dueño o planner asignado. Ni Administración ve los eventos de otros desde
// aquí: es la lista de "mis eventos".
//
// Eventos = sus invitaciones (bodas, XV, etc.), los side events de esas
// invitaciones y sus Pops; sin el evento destino y sin los que no tienen
// invitados.

const COLUMNAS_INVITADO = 'id, name, phone_number, tag, type, tier, side, notes, meal, companion_id, state';

const contar = (filas, campo) => {
    const m = new Map();
    (filas ?? []).forEach((f) => m.set(String(f[campo]), (m.get(String(f[campo])) ?? 0) + 1));
    return m;
};

async function listarEventos(req, res) {
    const uid = req.userId;
    const destino = String(req.body.side_events_id ?? req.body.sideEventId ?? '');
    try {
        const { data: invitaciones, error: e1 } = await supabase
            .from('invitations')
            .select('id, name, event_date, url_image')
            .or(`user_id.eq.${uid},planner_id.eq.${uid}`);
        if (e1) throw e1;
        const idsInv = (invitaciones ?? []).map((i) => i.id);

        const [{ data: deBoda, error: e2 }, { data: pops, error: e3 }] = await Promise.all([
            idsInv.length
                ? supabase.from('side_events').select('id, name, invitation_id, url_image, hour:body->>hour').in('invitation_id', idsInv)
                : Promise.resolve({ data: [] }),
            supabase.from('side_events').select('id, name, url_image, hour:body->>hour, emoji:body->>emoji')
                .is('invitation_id', null).or(`user_id.eq.${uid},planner_id.eq.${uid}`),
        ]);
        if (e2) throw e2;
        if (e3) throw e3;

        const sides = [...(deBoda ?? []), ...(pops ?? [])].filter((s) => String(s.id) !== destino);
        const idsSide = sides.map((s) => s.id);
        const [{ data: gInv, error: e4 }, { data: gSide, error: e5 }] = await Promise.all([
            idsInv.length ? supabase.from('guests').select('invitation_id').in('invitation_id', idsInv).limit(50000) : Promise.resolve({ data: [] }),
            idsSide.length ? supabase.from('side_events_guests').select('side_events_id').in('side_events_id', idsSide).limit(50000) : Promise.resolve({ data: [] }),
        ]);
        if (e4) throw e4;
        if (e5) throw e5;
        const porInv = contar(gInv, 'invitation_id');
        const porSide = contar(gSide, 'side_events_id');
        const nombreInv = new Map((invitaciones ?? []).map((i) => [i.id, i.name]));

        const eventos = [
            ...(invitaciones ?? []).map((i) => ({
                tipo: 'invitacion',
                id: i.id,
                nombre: i.name || '',
                fecha: i.event_date ?? null,
                imagen: i.url_image ?? null,
                invitados: porInv.get(String(i.id)) ?? 0,
            })),
            ...sides.map((s) => ({
                tipo: s.invitation_id ? 'side' : 'pop',
                id: s.id,
                nombre: s.name || '',
                de: s.invitation_id ? (nombreInv.get(s.invitation_id) ?? null) : null,
                fecha: s.hour ? String(s.hour).slice(0, 10) : null,
                imagen: s.url_image ?? null,
                emoji: s.emoji ?? null,
                invitados: porSide.get(String(s.id)) ?? 0,
            })),
        ]
            .filter((e) => e.invitados > 0)
            .sort((a, b) => String(b.fecha ?? '').localeCompare(String(a.fecha ?? '')));

        return res.json({ success: true, eventos });
    } catch (err) {
        console.error('Error en POST /api/guests/import/eventos:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
}

async function invitadosDeEvento(req, res) {
    const uid = req.userId;
    const { fuente } = req.body;
    if (!fuente || !['invitacion', 'side', 'pop'].includes(fuente.tipo) || !fuente.id) {
        return res.status(400).json({ success: false, error: 'fuente inválida' });
    }
    try {
        // El origen tiene que ser suyo (dueño o planner); un side event de boda,
        // por la invitación de la que cuelga.
        let invitacionId = null;
        let sideId = null;
        if (fuente.tipo === 'invitacion') {
            invitacionId = fuente.id;
        } else {
            const { data: se, error } = await supabase.from('side_events')
                .select('id, invitation_id, user_id, planner_id').eq('id', fuente.id).maybeSingle();
            if (error) throw error;
            if (!se) return res.status(404).json({ success: false, error: 'Evento no encontrado' });
            sideId = se.id;
            if (se.invitation_id) invitacionId = se.invitation_id;
            else if (se.user_id !== uid && se.planner_id !== uid) {
                return res.status(403).json({ success: false, error: 'No tienes acceso a ese evento' });
            }
        }
        if (invitacionId) {
            const { data: inv, error } = await supabase.from('invitations')
                .select('id, user_id, planner_id').eq('id', invitacionId).maybeSingle();
            if (error) throw error;
            if (!inv || (inv.user_id !== uid && inv.planner_id !== uid)) {
                return res.status(403).json({ success: false, error: 'No tienes acceso a ese evento' });
            }
        }

        const consulta = sideId
            ? supabase.from('side_events_guests').select(COLUMNAS_INVITADO).eq('side_events_id', sideId)
            : supabase.from('guests').select(COLUMNAS_INVITADO).eq('invitation_id', invitacionId);
        const { data, error } = await consulta.order('id', { ascending: true }).limit(10000);
        if (error) throw error;
        return res.json({ success: true, invitados: data ?? [] });
    } catch (err) {
        console.error('Error en POST /api/guests/import/desde-evento:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
}

module.exports = { listarEventos, invitadosDeEvento };
