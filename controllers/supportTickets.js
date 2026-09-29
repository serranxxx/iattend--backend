const { response } = require('express');
const supabase = require('../config/supabase');
const { sendMail } = require('./mailer');

// Reportes de soporte. Ver migrations/2026-09-28_create_support_tickets.sql.

const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'contacto.iattend@gmail.com';

const TOPICS = {
    help: 'Necesito ayuda',
    improvement: 'Quiero sugerir una mejora',
    question: 'Tengo una pregunta general',
};
const ESTADOS = ['open', 'in_progress', 'resolved'];
const MAX_BODY = 5000;
const MAX_NOTA = 2000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const escapeHtml = (value = '') => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const texto = (value, max = 200) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null);

// Quién manda el reporte: la sesión si viene (lo más confiable); si no, el
// dueño de la invitación desde la que se mandó; y al final lo que diga el body.
const resolverRemitente = async (req, invitationId) => {
    const authHeader = req.header('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    let userId = null;
    let email = null;

    if (token) {
        const { data } = await supabase.auth.getUser(token);
        if (data?.user) {
            userId = data.user.id;
            email = data.user.email ?? null;
        }
    }

    if (!userId && invitationId) {
        const { data: inv } = await supabase
            .from('invitations')
            .select('user_id, user_email')
            .eq('id', invitationId)
            .maybeSingle();
        userId = inv?.user_id ?? null;
        email = inv?.user_email ?? null;
    }

    let nombre = null;
    if (userId) {
        const { data: perfil } = await supabase
            .from('profiles')
            .select('full_name, user_email')
            .eq('user_id', userId)
            .maybeSingle();
        if (!perfil) userId = null; // la FK apunta a profiles
        nombre = perfil?.full_name ?? null;
        email = email ?? perfil?.user_email ?? null;
    }

    return {
        user_id: userId,
        user_email: email ?? texto(req.body?.user_email),
        user_name: nombre ?? texto(req.body?.user_name),
    };
};

const correoDelTicket = (ticket) => `
    <h2>${escapeHtml(TOPICS[ticket.topic])}</h2>
    <p style="white-space:pre-wrap">${escapeHtml(ticket.body)}</p>
    <hr />
    <p>
        <b>Usuario:</b> ${escapeHtml(ticket.user_name || '—')}<br />
        <b>Correo:</b> ${escapeHtml(ticket.user_email || '—')}<br />
        <b>ID de usuario:</b> ${escapeHtml(ticket.user_id || '—')}<br />
        <b>Invitación:</b> ${escapeHtml(ticket.event_name || '—')}<br />
        <b>ID de invitación:</b> ${escapeHtml(ticket.invitation_id || '—')}
    </p>
`;

// POST /api/support/tickets — público (lo manda cualquier organizador).
const crearTicket = async (req, res = response) => {
    const { topic, body, invitation_id, event_name } = req.body || {};

    if (!TOPICS[topic]) return res.status(400).json({ ok: false, msg: 'Tema no válido' });
    if (typeof body !== 'string' || !body.trim()) return res.status(400).json({ ok: false, msg: 'El mensaje es requerido' });
    if (body.length > MAX_BODY) return res.status(400).json({ ok: false, msg: `Máximo ${MAX_BODY} caracteres` });

    const invitationId = invitation_id && UUID.test(String(invitation_id)) ? String(invitation_id) : null;

    try {
        const remitente = await resolverRemitente(req, invitationId);
        const ticket = {
            topic,
            body: body.trim(),
            ...remitente,
            invitation_id: invitationId,
            event_name: texto(event_name),
        };

        const { data: guardado, error } = await supabase
            .from('support_tickets')
            .insert(ticket)
            .select('id')
            .maybeSingle();

        if (error) console.error('No se pudo guardar el reporte:', error.message);

        // El correo sale aunque no se haya podido guardar: el reporte no se pierde.
        let enviado = false;
        try {
            await sendMail(SUPPORT_EMAIL, `[Soporte] ${TOPICS[topic]}`, correoDelTicket(ticket));
            enviado = true;
        } catch (mailError) {
            console.error('No se pudo mandar el correo del reporte:', mailError.message);
        }

        if (!guardado && !enviado) {
            return res.status(500).json({ ok: false, msg: 'No se pudo enviar el reporte' });
        }

        if (guardado && enviado) {
            await supabase.from('support_tickets').update({ email_sent: true }).eq('id', guardado.id);
        }

        return res.status(201).json({ ok: true, id: guardado?.id ?? null });
    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
};

// GET /api/admin/support-tickets
const listarTickets = async (req, res = response) => {
    const { data, error } = await supabase
        .from('support_tickets')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);

    if (error) return res.status(500).json({ ok: false, msg: error.message });
    return res.status(200).json({ ok: true, tickets: data || [] });
};

// PATCH /api/admin/support-tickets/:id — estado y nota interna.
const actualizarTicket = async (req, res = response) => {
    const { id } = req.params;
    const { status, admin_note } = req.body || {};
    const cambios = {};

    if (status !== undefined) {
        if (!ESTADOS.includes(status)) return res.status(400).json({ ok: false, msg: 'Estado no válido' });
        cambios.status = status;
        cambios.resolved_at = status === 'resolved' ? new Date().toISOString() : null;
    }

    if (admin_note !== undefined) {
        if (admin_note !== null && typeof admin_note !== 'string') return res.status(400).json({ ok: false, msg: 'La nota debe ser texto' });
        cambios.admin_note = admin_note?.trim().slice(0, MAX_NOTA) || null;
    }

    if (!Object.keys(cambios).length) return res.status(400).json({ ok: false, msg: 'No hay cambios' });

    const { data, error } = await supabase
        .from('support_tickets')
        .update(cambios)
        .eq('id', id)
        .select('*')
        .maybeSingle();

    if (error) return res.status(500).json({ ok: false, msg: error.message });
    if (!data) return res.status(404).json({ ok: false, msg: 'Reporte no encontrado' });
    return res.status(200).json({ ok: true, ticket: data });
};

module.exports = { crearTicket, listarTickets, actualizarTicket };
