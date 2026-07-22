const { response } = require('express');
const supabase = require('../config/supabase');
const { generarVendedorJWT } = require('../helpers/jwt');

const CODIGO_ACCESO_REGEX = /^[A-Za-z0-9]{3}-[A-Za-z0-9]{3}$/;

const loginVendedor = async (req, res = response) => {
    const { codigo_acceso } = req.body;

    if (!codigo_acceso || !CODIGO_ACCESO_REGEX.test(codigo_acceso)) {
        return res.status(401).json({ ok: false, msg: 'Código de acceso inválido' });
    }

    try {
        const { data: vendedor, error } = await supabase
            .from('vendedores')
            .select('id, nombre, tipo, activo, descuento_max_pct')
            .eq('codigo_acceso', codigo_acceso.toUpperCase())
            .maybeSingle();

        if (error) {
            return res.status(500).json({ ok: false, msg: error.message });
        }

        if (!vendedor || !vendedor.activo) {
            return res.status(401).json({ ok: false, msg: 'Código de acceso inválido' });
        }

        const token = await generarVendedorJWT(vendedor.id, vendedor.tipo);

        return res.status(200).json({
            token,
            vendedor: {
                id: vendedor.id,
                nombre: vendedor.nombre,
                tipo: vendedor.tipo,
                descuento_max_pct: Number(vendedor.descuento_max_pct) || 0,
            }
        });

    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
}

const miResumen = async (req, res = response) => {
    const vendedorId = req.vendedorId;

    try {
        const { data: metricas, error: metricasError } = await supabase
            .from('vendedores_metricas')
            .select('ventas_mes, ventas_totales')
            .eq('vendedor_id', vendedorId)
            .maybeSingle();

        if (metricasError) {
            return res.status(500).json({ ok: false, msg: metricasError.message });
        }

        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const { data: ventasMes, error: ventasError } = await supabase
            .from('ventas')
            .select('comision_monto, comision_pagada')
            .eq('vendedor_id', vendedorId)
            .gte('fecha_venta', startOfMonth.toISOString());

        if (ventasError) {
            return res.status(500).json({ ok: false, msg: ventasError.message });
        }

        const comision_generada_mes = (ventasMes || [])
            .reduce((sum, v) => sum + Number(v.comision_monto || 0), 0);
        const comision_pagada_mes = (ventasMes || [])
            .filter(v => v.comision_pagada)
            .reduce((sum, v) => sum + Number(v.comision_monto || 0), 0);
        const comision_pendiente_mes = comision_generada_mes - comision_pagada_mes;

        return res.status(200).json({
            ventas_mes: metricas?.ventas_mes || 0,
            ventas_totales: metricas?.ventas_totales || 0,
            comision_generada_mes,
            comision_pagada_mes,
            comision_pendiente_mes,
        });

    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
}

const misVentas = async (req, res = response) => {
    const vendedorId = req.vendedorId;

    try {
        const { data: ventas, error } = await supabase
            .from('ventas')
            .select('id, plan, precio_acordado, descuento_pct, fecha_venta, created_at, invitations ( owners, label, name )')
            .eq('vendedor_id', vendedorId)
            .order('fecha_venta', { ascending: false });

        if (error) {
            return res.status(500).json({ ok: false, msg: error.message });
        }

        const ventaIds = (ventas || []).map(v => v.id);
        let saldosByVentaId = {};

        if (ventaIds.length) {
            const { data: saldos, error: saldosError } = await supabase
                .from('ventas_saldo')
                .select('venta_id, total_pagado, saldo_pendiente, estado_pago')
                .in('venta_id', ventaIds);

            if (saldosError) {
                return res.status(500).json({ ok: false, msg: saldosError.message });
            }

            saldosByVentaId = (saldos || []).reduce((acc, s) => {
                acc[s.venta_id] = s;
                return acc;
            }, {});
        }

        const result = (ventas || []).map(v => {
            const owners = v.invitations?.owners;
            const evento = Array.isArray(owners) && owners.length
                ? owners.join(' & ')
                : (v.invitations?.name || v.invitations?.label || '');
            const saldo = saldosByVentaId[v.id] || {};

            return {
                venta_id: v.id,
                evento,
                plan: v.plan,
                precio_acordado: v.precio_acordado,
                descuento_pct: v.descuento_pct ?? 0,
                total_pagado: saldo.total_pagado ?? 0,
                saldo_pendiente: saldo.saldo_pendiente ?? v.precio_acordado,
                estado_pago: saldo.estado_pago ?? 'sin_pago',
                fecha_venta: v.fecha_venta || v.created_at || null,
            };
        });

        return res.status(200).json({ ventas: result });

    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
}

module.exports = {
    loginVendedor,
    miResumen,
    misVentas,
}
