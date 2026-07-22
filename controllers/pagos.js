const { response } = require('express');
const sharp = require('sharp');
const supabase = require('../config/supabase');

const METODOS_VALIDOS = ['transferencia', 'stripe', 'efectivo', 'otro'];
const COMPROBANTES_BUCKET = 'comprobantes-pago';

const registrarPago = async (req, res = response) => {
    const vendedorId = req.vendedorId;
    const { venta_id, monto, metodo, referencia, nota } = req.body;

    if (!venta_id) {
        return res.status(400).json({ ok: false, msg: 'venta_id es requerido' });
    }

    if (typeof monto !== 'number' || monto <= 0) {
        return res.status(400).json({ ok: false, msg: 'monto inválido' });
    }

    if (!METODOS_VALIDOS.includes(metodo)) {
        return res.status(400).json({ ok: false, msg: 'metodo inválido' });
    }

    try {
        const { data: venta, error: ventaError } = await supabase
            .from('ventas')
            .select('id, vendedor_id')
            .eq('id', venta_id)
            .maybeSingle();

        if (ventaError) {
            return res.status(500).json({ ok: false, msg: ventaError.message });
        }

        if (!venta) {
            return res.status(404).json({ ok: false, msg: 'Venta no encontrada' });
        }

        if (!req.isAdmin && venta.vendedor_id !== vendedorId) {
            return res.status(403).json({ ok: false, msg: 'Esta venta no pertenece al vendedor autenticado' });
        }

        const { data: pago, error: pagoError } = await supabase
            .from('pagos')
            .insert({
                venta_id,
                monto,
                metodo,
                referencia: referencia || null,
                nota: nota || null,
                registrado_por: vendedorId,
            })
            .select('id')
            .single();

        if (pagoError || !pago) {
            return res.status(500).json({ ok: false, msg: pagoError?.message || 'No se pudo registrar el pago' });
        }

        const { data: saldo, error: saldoError } = await supabase
            .from('ventas_saldo')
            .select('total_pagado, saldo_pendiente, estado_pago')
            .eq('venta_id', venta_id)
            .maybeSingle();

        if (saldoError) {
            return res.status(500).json({ ok: false, msg: saldoError.message });
        }

        return res.status(200).json({
            pago_id: pago.id,
            total_pagado: saldo?.total_pagado ?? monto,
            saldo_pendiente: saldo?.saldo_pendiente ?? null,
            estado_pago: saldo?.estado_pago ?? 'apartado',
            comprobante_url: null,
        });

    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
}

const historialPagos = async (req, res = response) => {
    const vendedorId = req.vendedorId;
    const { venta_id } = req.query;

    if (!venta_id) {
        return res.status(400).json({ ok: false, msg: 'venta_id es requerido' });
    }

    try {
        const { data: venta, error: ventaError } = await supabase
            .from('ventas')
            .select('id, vendedor_id')
            .eq('id', venta_id)
            .maybeSingle();

        if (ventaError) {
            return res.status(500).json({ ok: false, msg: ventaError.message });
        }

        if (!venta) {
            return res.status(404).json({ ok: false, msg: 'Venta no encontrada' });
        }

        if (!req.isAdmin && venta.vendedor_id !== vendedorId) {
            return res.status(403).json({ ok: false, msg: 'Esta venta no pertenece al vendedor autenticado' });
        }

        const { data: pagos, error: pagosError } = await supabase
            .from('pagos')
            .select('id, monto, metodo, referencia, nota, comprobante_url, comprobante_subido_at, created_at')
            .eq('venta_id', venta_id)
            .order('created_at', { ascending: false });

        if (pagosError) {
            return res.status(500).json({ ok: false, msg: pagosError.message });
        }

        const pagosConComprobante = await Promise.all((pagos || []).map(async (pago) => {
            if (!pago.comprobante_url) {
                return { ...pago, comprobante_signed_url: null };
            }

            const { data: signed } = await supabase.storage
                .from(COMPROBANTES_BUCKET)
                .createSignedUrl(pago.comprobante_url, 60 * 60);

            return { ...pago, comprobante_signed_url: signed?.signedUrl || null };
        }));

        return res.status(200).json({ pagos: pagosConComprobante });

    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
}

const subirComprobante = async (req, res = response) => {
    const vendedorId = req.vendedorId;
    const { pago_id } = req.params;

    if (!req.file) {
        return res.status(400).json({ ok: false, msg: 'archivo es requerido' });
    }

    try {
        const { data: pago, error: pagoError } = await supabase
            .from('pagos')
            .select('id, venta_id, ventas ( vendedor_id )')
            .eq('id', pago_id)
            .maybeSingle();

        if (pagoError) {
            return res.status(500).json({ ok: false, msg: pagoError.message });
        }

        if (!pago) {
            return res.status(404).json({ ok: false, msg: 'Pago no encontrado' });
        }

        if (!req.isAdmin && pago.ventas?.vendedor_id !== vendedorId) {
            return res.status(403).json({ ok: false, msg: 'Este pago no pertenece al vendedor autenticado' });
        }

        let buffer = req.file.buffer;
        let contentType = req.file.mimetype;
        let ext;

        if (contentType.startsWith('image/')) {
            buffer = await sharp(buffer).webp({ quality: 55 }).toBuffer();
            contentType = 'image/webp';
            ext = 'webp';
        } else if (contentType === 'application/pdf') {
            ext = 'pdf';
        } else {
            return res.status(400).json({ ok: false, msg: 'Formato de archivo no soportado, usa imagen o PDF' });
        }

        const path = `${pago.venta_id}/${pago_id}.${ext}`;

        const { error: uploadError } = await supabase.storage
            .from(COMPROBANTES_BUCKET)
            .upload(path, buffer, { contentType, upsert: true });

        if (uploadError) {
            return res.status(500).json({ ok: false, msg: uploadError.message });
        }

        const { error: updateError } = await supabase
            .from('pagos')
            .update({
                comprobante_url: path,
                comprobante_subido_at: new Date().toISOString(),
            })
            .eq('id', pago_id);

        if (updateError) {
            return res.status(500).json({ ok: false, msg: updateError.message });
        }

        return res.status(200).json({ pago_id, comprobante_url: `${COMPROBANTES_BUCKET}/${path}` });

    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
}

module.exports = {
    registrarPago,
    historialPagos,
    subirComprobante,
}
