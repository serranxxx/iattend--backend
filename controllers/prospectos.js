const { response } = require('express');
const supabase = require('../config/supabase');

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
    const { vendedor_id } = req.body;

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

// notas y favorito son ediciones libres del vendedor/admin sobre su propio prospecto —
// ninguna de las dos toca vendedor_id, así que comparten la misma validación de pertenencia.
const actualizarDetalles = async (req, res = response) => {
    const { id } = req.params;
    const { notas, favorito } = req.body;

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

module.exports = {
    listarProspectos,
    misProspectos,
    asignarVendedor,
    actualizarEstado,
    actualizarDetalles,
};
