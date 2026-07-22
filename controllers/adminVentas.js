const { response } = require('express');
const supabase = require('../config/supabase');
const { generateSimpleId } = require('../helpers/simpleId');

const TIPOS_VENDEDOR_VALIDOS = ['interno', 'externo'];
const PLANES_VALIDOS = ['PRO', 'Lite'];
const UNIQUE_VIOLATION = '23505';

const listarVentas = async (req, res = response) => {
    const { mes, anio, vendedor_id, plan, estado_pago } = req.query;

    try {
        let query = supabase
            .from('ventas')
            .select('id, plan, precio_acordado, descuento_pct, fecha_venta, comision_monto, comision_pagada, vendedor_id, vendedores ( nombre ), invitations ( owners, label, name )')
            .order('fecha_venta', { ascending: false });

        if (vendedor_id) {
            query = query.eq('vendedor_id', vendedor_id);
        }

        if (plan) {
            query = query.eq('plan', plan);
        }

        if (anio) {
            const year = Number(anio);
            const month = mes ? Number(mes) : null;

            const start = month
                ? new Date(year, month - 1, 1)
                : new Date(year, 0, 1);
            const end = month
                ? new Date(year, month, 1)
                : new Date(year + 1, 0, 1);

            query = query.gte('fecha_venta', start.toISOString()).lt('fecha_venta', end.toISOString());
        }

        const { data: ventas, error } = await query;

        if (error) {
            return res.status(500).json({ ok: false, msg: error.message });
        }

        const ventaIds = (ventas || []).map(v => v.id);
        let saldosByVentaId = {};
        let comprobantesPendientesByVentaId = {};

        if (ventaIds.length) {
            const [{ data: saldos, error: saldosError }, { data: pendientes, error: pendientesError }] = await Promise.all([
                supabase.from('ventas_saldo').select('venta_id, total_pagado, saldo_pendiente, estado_pago').in('venta_id', ventaIds),
                supabase.from('ventas_comprobante_pendiente').select('venta_id, abonos_sin_comprobante').in('venta_id', ventaIds),
            ]);

            if (saldosError) {
                return res.status(500).json({ ok: false, msg: saldosError.message });
            }

            if (pendientesError) {
                return res.status(500).json({ ok: false, msg: pendientesError.message });
            }

            saldosByVentaId = (saldos || []).reduce((acc, s) => { acc[s.venta_id] = s; return acc; }, {});
            comprobantesPendientesByVentaId = (pendientes || []).reduce((acc, p) => { acc[p.venta_id] = p.abonos_sin_comprobante; return acc; }, {});
        }

        let result = (ventas || []).map(v => {
            const owners = v.invitations?.owners;
            const evento = Array.isArray(owners) && owners.length
                ? owners.join(' & ')
                : (v.invitations?.name || v.invitations?.label || '');
            const saldo = saldosByVentaId[v.id] || {};

            return {
                venta_id: v.id,
                evento,
                fecha_venta: v.fecha_venta,
                vendedor_id: v.vendedor_id,
                vendedor: v.vendedores?.nombre || '',
                plan: v.plan,
                precio_acordado: v.precio_acordado,
                total_pagado: saldo.total_pagado ?? 0,
                saldo_pendiente: saldo.saldo_pendiente ?? v.precio_acordado,
                estado_pago: saldo.estado_pago ?? 'sin_pago',
                abonos_sin_comprobante: comprobantesPendientesByVentaId[v.id] || 0,
                comision_monto: v.comision_monto ?? 0,
                comision_pagada: v.comision_pagada ?? false,
            };
        });

        if (estado_pago) {
            result = result.filter(v => v.estado_pago === estado_pago);
        }

        return res.status(200).json({ ventas: result });

    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
}

const editarVenta = async (req, res = response) => {
    const { venta_id } = req.params;
    const { precio_acordado, plan, vendedor_id } = req.body;

    const updates = {};
    if (precio_acordado !== undefined) updates.precio_acordado = precio_acordado;
    if (plan !== undefined) updates.plan = plan;
    if (vendedor_id !== undefined) updates.vendedor_id = vendedor_id;

    if (!Object.keys(updates).length) {
        return res.status(400).json({ ok: false, msg: 'No hay campos para actualizar' });
    }

    try {
        const { data, error } = await supabase
            .from('ventas')
            .update(updates)
            .eq('id', venta_id)
            .select('id')
            .maybeSingle();

        if (error) {
            return res.status(500).json({ ok: false, msg: error.message });
        }

        if (!data) {
            return res.status(404).json({ ok: false, msg: 'Venta no encontrada' });
        }

        return res.status(200).json({ ok: true, venta_id: data.id });

    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
}

const buscarInvitacionesSinVenta = async (req, res = response) => {
    const { q } = req.query;

    if (!q || String(q).trim().length < 3) {
        return res.status(200).json({ invitations: [] });
    }

    const term = `%${String(q).trim()}%`;

    try {
        const [{ data: byName, error: e1 }, { data: byEmail, error: e2 }] = await Promise.all([
            supabase.from('invitations').select('id, name, label, owners, plan, user_email').ilike('name', term).limit(20),
            supabase.from('invitations').select('id, name, label, owners, plan, user_email').ilike('user_email', term).limit(20),
        ]);

        if (e1) return res.status(500).json({ ok: false, msg: e1.message });
        if (e2) return res.status(500).json({ ok: false, msg: e2.message });

        const byId = new Map();
        [...(byName || []), ...(byEmail || [])].forEach(inv => byId.set(inv.id, inv));

        const candidates = [...byId.values()];

        if (!candidates.length) {
            return res.status(200).json({ invitations: [] });
        }

        const { data: existingVentas, error: e3 } = await supabase
            .from('ventas')
            .select('invitation_id')
            .in('invitation_id', candidates.map(c => c.id));

        if (e3) return res.status(500).json({ ok: false, msg: e3.message });

        const takenIds = new Set((existingVentas || []).map(v => v.invitation_id));
        const available = candidates.filter(c => !takenIds.has(c.id)).slice(0, 20);

        return res.status(200).json({ invitations: available });

    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
}

const crearVentaManual = async (req, res = response) => {
    const { invitation_id, vendedor_id, plan, precio_acordado, descuento_pct, fecha_venta } = req.body;

    if (!invitation_id) {
        return res.status(400).json({ ok: false, msg: 'invitation_id es requerido' });
    }

    if (!vendedor_id) {
        return res.status(400).json({ ok: false, msg: 'vendedor_id es requerido' });
    }

    if (!PLANES_VALIDOS.includes(plan)) {
        return res.status(400).json({ ok: false, msg: 'plan inválido' });
    }

    if (typeof precio_acordado !== 'number' || precio_acordado <= 0) {
        return res.status(400).json({ ok: false, msg: 'precio_acordado inválido' });
    }

    try {
        const { data: invitation, error: invError } = await supabase
            .from('invitations')
            .select('id')
            .eq('id', invitation_id)
            .maybeSingle();

        if (invError) return res.status(500).json({ ok: false, msg: invError.message });
        if (!invitation) return res.status(404).json({ ok: false, msg: 'Invitación no encontrada' });

        const { data: existing, error: existingError } = await supabase
            .from('ventas')
            .select('id')
            .eq('invitation_id', invitation_id)
            .maybeSingle();

        if (existingError) return res.status(500).json({ ok: false, msg: existingError.message });
        if (existing) return res.status(409).json({ ok: false, msg: 'Esta invitación ya tiene una venta registrada' });

        const { data: vendedor, error: vendedorError } = await supabase
            .from('vendedores')
            .select('id')
            .eq('id', vendedor_id)
            .maybeSingle();

        if (vendedorError) return res.status(500).json({ ok: false, msg: vendedorError.message });
        if (!vendedor) return res.status(404).json({ ok: false, msg: 'Vendedor no encontrado' });

        const payload = {
            invitation_id,
            vendedor_id,
            plan,
            precio_acordado,
            descuento_pct: Number(descuento_pct) || 0,
        };

        if (fecha_venta) {
            payload.fecha_venta = fecha_venta;
        }

        const { data: venta, error: ventaError } = await supabase
            .from('ventas')
            .insert(payload)
            .select('id')
            .single();

        if (ventaError) return res.status(500).json({ ok: false, msg: ventaError.message });

        return res.status(201).json({ venta_id: venta.id });

    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
}

const pagosPendientesComprobante = async (req, res = response) => {
    try {
        const { data: pendientes, error } = await supabase
            .from('ventas_comprobante_pendiente')
            .select('venta_id, abonos_sin_comprobante');

        if (error) {
            return res.status(500).json({ ok: false, msg: error.message });
        }

        const ventaIds = (pendientes || []).map(p => p.venta_id);

        if (!ventaIds.length) {
            return res.status(200).json({ ventas: [] });
        }

        const { data: ventas, error: ventasError } = await supabase
            .from('ventas')
            .select('id, vendedores ( nombre ), invitations ( owners, label, name )')
            .in('id', ventaIds);

        if (ventasError) {
            return res.status(500).json({ ok: false, msg: ventasError.message });
        }

        const ventasById = (ventas || []).reduce((acc, v) => { acc[v.id] = v; return acc; }, {});

        const result = pendientes.map(p => {
            const venta = ventasById[p.venta_id];
            const owners = venta?.invitations?.owners;
            const evento = Array.isArray(owners) && owners.length
                ? owners.join(' & ')
                : (venta?.invitations?.name || venta?.invitations?.label || '');

            return {
                venta_id: p.venta_id,
                evento,
                vendedor: venta?.vendedores?.nombre || '',
                abonos_sin_comprobante: p.abonos_sin_comprobante,
            };
        });

        return res.status(200).json({ ventas: result });

    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
}

const listarVendedores = async (req, res = response) => {
    try {
        const { data, error } = await supabase
            .from('vendedores')
            .select('id, nombre, tipo, telefono, email, descuento_max_pct, codigo_acceso, activo')
            .order('nombre', { ascending: true });

        if (error) {
            return res.status(500).json({ ok: false, msg: error.message });
        }

        return res.status(200).json({ vendedores: data || [] });

    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
}

const crearVendedor = async (req, res = response) => {
    const { nombre, tipo, telefono, email, descuento_max_pct } = req.body;

    if (!nombre || typeof nombre !== 'string' || !nombre.trim()) {
        return res.status(400).json({ ok: false, msg: 'nombre es requerido' });
    }

    if (!TIPOS_VENDEDOR_VALIDOS.includes(tipo)) {
        return res.status(400).json({ ok: false, msg: 'tipo debe ser interno o externo' });
    }

    const descuento = Number(descuento_max_pct) || 0;

    if (descuento < 0 || descuento > 100) {
        return res.status(400).json({ ok: false, msg: 'descuento_max_pct inválido' });
    }

    try {
        let vendedor = null;
        let lastError = null;

        for (let attempt = 0; attempt < 5 && !vendedor; attempt++) {
            const { data, error } = await supabase
                .from('vendedores')
                .insert({
                    nombre: nombre.trim(),
                    tipo,
                    telefono: telefono || null,
                    email: email || null,
                    descuento_max_pct: descuento,
                    codigo_acceso: generateSimpleId().toUpperCase(),
                })
                .select('id, nombre, tipo, telefono, email, descuento_max_pct, codigo_acceso, activo')
                .single();

            if (!error) {
                vendedor = data;
            } else if (error.code === UNIQUE_VIOLATION) {
                lastError = error;
            } else {
                return res.status(500).json({ ok: false, msg: error.message });
            }
        }

        if (!vendedor) {
            return res.status(500).json({ ok: false, msg: lastError?.message || 'No se pudo generar un código de acceso único' });
        }

        return res.status(201).json({ vendedor });

    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
}

module.exports = {
    listarVentas,
    editarVenta,
    pagosPendientesComprobante,
    listarVendedores,
    crearVendedor,
    buscarInvitacionesSinVenta,
    crearVentaManual,
}
