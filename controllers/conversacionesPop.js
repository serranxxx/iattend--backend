const supabase = require('../config/supabase');

/*
  Buzón de WhatsApp de un Pop (side event sin invitación). La boda usa la RPC
  get_conversations_by_invitation, que agrupa por invitations.id; un Pop no
  tiene invitación, así que aquí se arma lo mismo desde sus envíos:
  · respuestas ligadas a un envío del Pop (dispatch_id), y
  · respuestas que llegaron sin ligar (dispatch_id vacío) de un teléfono al
    que el Pop ya le mandó invitación, desde ese primer envío.
  Lo que el organizador contesta (whatsapp_freetext_dispatches.side_event_id,
  migración 2026-11-12d_whatsapp_freetext_pop.sql) sale como saliente.
  Mismo formato que la RPC: [{ phone, side_event_id, guest_name, messages }].
  validarAccesoEvento ya revisó que quien pide gestione el Pop.
*/

const LOTE = 200;
const SIN_COLUMNA = ['42703', 'PGRST204'];

const enLotes = async (valores, consulta) => {
    const filas = [];
    for (let i = 0; i < valores.length; i += LOTE) {
        const { data, error } = await consulta(valores.slice(i, i + LOTE));
        if (error) throw error;
        filas.push(...(data ?? []));
    }
    return filas;
};

const esPop = async (sideEventId) => {
    const { data } = await supabase.from('side_events').select('id, invitation_id').eq('id', sideEventId).maybeSingle();
    return !!data && !data.invitation_id;
};

// Mensajes entrantes del Pop (opcional: solo de un teléfono).
const entrantesDelPop = async (sideEventId, soloTelefono = null) => {
    let q = supabase.from('invitation_message_dispatches')
        .select('id, guest_phone, guest_name, created_at')
        .eq('side_event_id', sideEventId);
    if (soloTelefono) q = q.eq('guest_phone', soloTelefono);
    const { data: envios, error } = await q;
    if (error) throw error;
    if (!envios?.length) return { envios: [], mensajes: [] };

    const primero = new Map();
    envios.forEach(e => {
        const p = String(e.guest_phone ?? '');
        if (!p) return;
        if (!primero.has(p) || e.created_at < primero.get(p)) primero.set(p, e.created_at);
    });

    const CAMPOS = 'id, from_phone, contact_name, message_type, message_body, media_id, media_url, timestamp, read, dispatch_id';
    const ligados = await enLotes(envios.map(e => e.id), (ids) =>
        supabase.from('whatsapp_incoming_messages').select(CAMPOS).in('dispatch_id', ids));
    const sueltos = await enLotes([...primero.keys()], (tels) =>
        supabase.from('whatsapp_incoming_messages').select(CAMPOS).is('dispatch_id', null).in('from_phone', tels));

    const vistos = new Set();
    const mensajes = [...ligados, ...sueltos.filter(m => m.timestamp >= primero.get(String(m.from_phone)))]
        .filter(m => !vistos.has(m.id) && vistos.add(m.id));
    return { envios, mensajes };
};

// POST /api/whats/conversaciones { sideEventId }
const conversacionesDePop = async (req, res) => {
    try {
        const sideEventId = req.body.sideEventId ?? req.body.side_events_id;
        if (!(await esPop(sideEventId))) return res.status(400).json({ ok: false, msg: 'Solo para Pops' });

        const { envios, mensajes } = await entrantesDelPop(sideEventId);
        const nombres = new Map(envios.map(e => [String(e.guest_phone), e.guest_name]));
        const telefonos = [...new Set(mensajes.map(m => String(m.from_phone)))];

        let salientes = [];
        if (telefonos.length) {
            const { data, error } = await supabase.from('whatsapp_freetext_dispatches')
                .select('id, to_phone, message_body, status, sent_at')
                .eq('side_event_id', sideEventId)
                .in('to_phone', telefonos);
            if (error && !SIN_COLUMNA.includes(error.code)) throw error;
            salientes = data ?? [];
        }

        const porTelefono = new Map();
        const de = (tel) => {
            if (!porTelefono.has(tel)) {
                porTelefono.set(tel, { phone: tel, side_event_id: Number(sideEventId), guest_name: nombres.get(tel) ?? null, messages: [] });
            }
            return porTelefono.get(tel).messages;
        };
        mensajes.forEach(m => de(String(m.from_phone)).push({
            id: m.id,
            direction: 'inbound',
            body: m.message_body,
            message_type: m.message_type,
            contact_name: m.contact_name,
            media_id: m.media_id,
            media_url: m.media_url,
            timestamp: m.timestamp,
            read: !!m.read,
        }));
        salientes.forEach(s => de(String(s.to_phone)).push({
            id: s.id,
            direction: 'outbound',
            body: s.message_body,
            message_type: 'text',
            status: s.status,
            timestamp: s.sent_at,
            read: true,
        }));

        const ultimo = (c) => c.messages.reduce((max, m) => (m.timestamp > max ? m.timestamp : max), '');
        const conversaciones = [...porTelefono.values()]
            .map(c => ({ ...c, messages: c.messages.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp))) }))
            .sort((a, b) => ultimo(b).localeCompare(ultimo(a)));

        return res.json({ ok: true, conversaciones });
    } catch (err) {
        console.error('Error en POST /api/whats/conversaciones:', err);
        return res.status(500).json({ ok: false, msg: 'Error interno del servidor' });
    }
};

// POST /api/whats/conversaciones/leidos { sideEventId, phone }
const marcarLeidosPop = async (req, res) => {
    try {
        const sideEventId = req.body.sideEventId ?? req.body.side_events_id;
        const telefono = String(req.body.phone ?? '').replace(/\D/g, '');
        if (!telefono) return res.status(400).json({ ok: false, msg: 'phone requerido' });
        if (!(await esPop(sideEventId))) return res.status(400).json({ ok: false, msg: 'Solo para Pops' });

        const { mensajes } = await entrantesDelPop(sideEventId, telefono);
        const ids = mensajes.filter(m => !m.read).map(m => m.id);
        if (ids.length) {
            const { error } = await supabase.from('whatsapp_incoming_messages').update({ read: true }).in('id', ids);
            if (error) throw error;
        }
        return res.json({ ok: true, leidos: ids.length });
    } catch (err) {
        console.error('Error en POST /api/whats/conversaciones/leidos:', err);
        return res.status(500).json({ ok: false, msg: 'Error interno del servidor' });
    }
};

module.exports = { conversacionesDePop, marcarLeidosPop };
