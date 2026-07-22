const { response } = require('express');
const supabase = require('../config/supabase');

const getConfiguracionPagos = async (req, res = response) => {
    try {
        const { data: rows, error } = await supabase
            .from('configuracion_pagos')
            .select('plan, tipo, titular, banco, clabe, stripe_url')
            .eq('activo', true);

        if (error) {
            return res.status(500).json({ ok: false, msg: error.message });
        }

        const transferenciaRow = (rows || []).find(r => r.tipo === 'transferencia' && r.plan === 'general')
            || (rows || []).find(r => r.tipo === 'transferencia');

        const stripe_links = (rows || [])
            .filter(r => r.tipo === 'stripe_link')
            .reduce((acc, r) => {
                acc[r.plan] = r.stripe_url;
                return acc;
            }, {});

        return res.status(200).json({
            transferencia: transferenciaRow
                ? { banco: transferenciaRow.banco, clabe: transferenciaRow.clabe, titular: transferenciaRow.titular }
                : null,
            stripe_links,
        });

    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
}

module.exports = {
    getConfiguracionPagos
}
