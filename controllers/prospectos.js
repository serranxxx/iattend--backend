const { response } = require('express');
const supabase = require('../config/supabase');
const { sendMail } = require('./mailer');
const { activationRequestEmailTemplate } = require('./templates/activationRequestEmail');
const { prospectAssignedEmailTemplate } = require('./templates/prospectAssignedEmail');

const ADMIN_NOTIFICATION_EMAIL = 'albserrano8@gmail.com';

const ESTADOS_VALIDOS = [
    'sin_asignar',
    'asignado',
    'en_conversacion',
    'finalizado',
    'volver_a_contactar',
];

const listarProspectos = async (req, res = response) => {
    if (!req.isAdmin) {
        return res.status(403).json({ ok: false, msg: 'Requiere permisos de administrador' });
    }

    try {
        const { data, error } = await supabase
            .from('prospectos_ig')
            .select('*, vendedores ( id, nombre )')
            .order('created_at', { ascending: false });

        if (error) {
            return res.status(500).json({ ok: false, msg: error.message });
        }

        return res.status(200).json({ prospectos: data || [] });
    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
};

const misProspectos = async (req, res = response) => {
    if (!req.vendedorId) {
        return res.status(403).json({ ok: false, msg: 'Esta ruta es solo para vendedores' });
    }

    try {
        const { data, error } = await supabase
            .from('prospectos_ig')
            .select('*')
            .eq('vendedor_id', req.vendedorId)
            .neq('estado', 'sin_asignar')
            .order('created_at', { ascending: false });

        if (error) {
            return res.status(500).json({ ok: false, msg: error.message });
        }

        return res.status(200).json({ prospectos: data || [] });
    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
};

const asignarVendedor = async (req, res = response) => {
    if (!req.isAdmin) {
        return res.status(403).json({ ok: false, msg: 'Requiere permisos de administrador' });
    }

    const { id } = req.params;
    const { vendedor_id, notificar } = req.body;

    if (!vendedor_id) {
        return res.status(400).json({ ok: false, msg: 'vendedor_id es requerido' });
    }

    try {
        const { data, error } = await supabase
            .from('prospectos_ig')
            .update({
                vendedor_id,
                estado: 'asignado',
                asignado_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .eq('id', id)
            .select()
            .single();

        if (error) {
            return res.status(500).json({ ok: false, msg: error.message });
        }

        if (notificar) {
            const { data: vendedor, error: vendedorError } = await supabase
                .from('vendedores')
                .select('nombre, email')
                .eq('id', vendedor_id)
                .maybeSingle();

            if (vendedorError) {
                console.error('[prospectos_ig] error buscando vendedor para notificar:', vendedorError);
            } else if (vendedor?.email) {
                try {
                    const html = prospectAssignedEmailTemplate({
                        vendedorNombre: vendedor.nombre,
                        username: data.instagram_username,
                    });
                    await sendMail(vendedor.email, 'Nuevo prospecto de Instagram asignado', html);
                } catch (mailError) {
                    console.error('[prospectos_ig] error enviando correo de asignación:', mailError);
                }
            }
        }

        return res.status(200).json({ prospecto: data });
    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
};

const actualizarEstado = async (req, res = response) => {
    const { id } = req.params;
    const { estado, motivo_finalizado } = req.body;

    if (!ESTADOS_VALIDOS.includes(estado)) {
        return res.status(400).json({ ok: false, msg: 'estado inválido' });
    }

    if (estado === 'finalizado' && !motivo_finalizado?.trim()) {
        return res.status(400).json({ ok: false, msg: 'motivo_finalizado es requerido para finalizar un prospecto' });
    }

    if (!req.isAdmin && estado === 'sin_asignar') {
        return res.status(403).json({ ok: false, msg: 'No puedes desasignarte un prospecto' });
    }

    try {
        if (!req.isAdmin) {
            const { data: existente, error: existenteError } = await supabase
                .from('prospectos_ig')
                .select('vendedor_id')
                .eq('id', id)
                .maybeSingle();

            if (existenteError) {
                return res.status(500).json({ ok: false, msg: existenteError.message });
            }

            if (!existente || existente.vendedor_id !== req.vendedorId) {
                return res.status(403).json({ ok: false, msg: 'Este prospecto no te pertenece' });
            }
        }

        const updatePayload = { estado, updated_at: new Date().toISOString() };
        if (estado === 'finalizado') {
            updatePayload.motivo_finalizado = motivo_finalizado.trim();
        }

        const { data, error } = await supabase
            .from('prospectos_ig')
            .update(updatePayload)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            return res.status(500).json({ ok: false, msg: error.message });
        }

        return res.status(200).json({ prospecto: data });
    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
};

// notas, favorito, email, teléfono, post_contexto y nivel_interes son ediciones libres del
// vendedor/admin sobre su propio prospecto — ninguna toca vendedor_id, comparten la misma
// validación de pertenencia.
const actualizarDetalles = async (req, res = response) => {
    const { id } = req.params;
    const { notas, favorito, email, telefono, post_contexto, nivel_interes } = req.body;

    try {
        if (!req.isAdmin) {
            const { data: existente, error: existenteError } = await supabase
                .from('prospectos_ig')
                .select('vendedor_id')
                .eq('id', id)
                .maybeSingle();

            if (existenteError) {
                return res.status(500).json({ ok: false, msg: existenteError.message });
            }

            if (!existente || existente.vendedor_id !== req.vendedorId) {
                return res.status(403).json({ ok: false, msg: 'Este prospecto no te pertenece' });
            }
        }

        const updatePayload = { updated_at: new Date().toISOString() };
        if (notas !== undefined) updatePayload.notas = notas ?? null;
        if (favorito !== undefined) updatePayload.favorito = !!favorito;
        if (email !== undefined) updatePayload.email = email ?? null;
        if (telefono !== undefined) updatePayload.telefono = telefono ?? null;
        if (post_contexto !== undefined) updatePayload.post_contexto = Array.isArray(post_contexto) ? post_contexto : [];
        if (nivel_interes !== undefined) updatePayload.nivel_interes = nivel_interes ?? null;

        const { data, error } = await supabase
            .from('prospectos_ig')
            .update(updatePayload)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            return res.status(500).json({ ok: false, msg: error.message });
        }

        return res.status(200).json({ prospecto: data });
    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
};

// Solo tiene sentido mientras el prospecto está 'asignado' y aún no arrancó la conversación —
// el vendedor no tiene acceso directo a Instagram, así que le pide a Alberto por correo.
const solicitarActivacion = async (req, res = response) => {
    if (!req.vendedorId) {
        return res.status(403).json({ ok: false, msg: 'Esta acción es solo para vendedores' });
    }

    const { id } = req.params;

    try {
        const { data: prospecto, error: prospectoError } = await supabase
            .from('prospectos_ig')
            .select('instagram_username, estado, vendedor_id')
            .eq('id', id)
            .maybeSingle();

        if (prospectoError) {
            return res.status(500).json({ ok: false, msg: prospectoError.message });
        }

        if (!prospecto || prospecto.vendedor_id !== req.vendedorId) {
            return res.status(403).json({ ok: false, msg: 'Este prospecto no te pertenece' });
        }

        if (prospecto.estado !== 'asignado') {
            return res.status(400).json({ ok: false, msg: 'Solo se puede solicitar activación mientras está asignado' });
        }

        const { data: vendedor, error: vendedorError } = await supabase
            .from('vendedores')
            .select('nombre')
            .eq('id', req.vendedorId)
            .maybeSingle();

        if (vendedorError) {
            return res.status(500).json({ ok: false, msg: vendedorError.message });
        }

        const html = activationRequestEmailTemplate({
            vendedorNombre: vendedor?.nombre || 'Un vendedor',
            username: prospecto.instagram_username,
        });

        await sendMail(ADMIN_NOTIFICATION_EMAIL, `${vendedor?.nombre || 'Un vendedor'} solicita activar @${prospecto.instagram_username}`, html);

        return res.status(200).json({ ok: true });
    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
};

module.exports = {
    listarProspectos,
    misProspectos,
    asignarVendedor,
    actualizarEstado,
    actualizarDetalles,
    solicitarActivacion,
};
