const { response } = require('express');
const supabase = require('../config/supabase');

const MAX_CONCEPTOS = 40;
const MAX_NOMBRE = 60;

// Un concepto es fijo (monto absoluto del mes) o por venta (costo unitario que
// se multiplica por las invitaciones vendidas, ej. MetaAPI a $60 por invitación).
// `conceptos` es jsonb, así que agregar `tipo` no requiere migración: las filas
// viejas no lo traen y se leen como fijas.
const TIPOS_CONCEPTO = ['fijo', 'por_venta'];

// Baseline: reproduce la meta fija de $15,318 que estaba hardcodeada en el front
// antes de la calculadora. Solo se usa si no hay ningún periodo guardado todavía.
const BASELINE = {
    conceptos: [
        { nombre: 'Renta y servicios', monto: 4200, tipo: 'fijo' },
        { nombre: 'Nómina y colaboradores', monto: 6500, tipo: 'fijo' },
        { nombre: 'Software e infraestructura', monto: 1800, tipo: 'fijo' },
        { nombre: 'Marketing y pauta', monto: 2100, tipo: 'fijo' },
        { nombre: 'Otros gastos fijos', monto: 718, tipo: 'fijo' },
    ],
    neto_venta: 2258,
};

const aNumero = (valor) => {
    const n = Number(valor);
    return Number.isFinite(n) && n >= 0 ? n : null;
};

const normalizarPeriodo = ({ anio, mes }) => {
    const year = Number(anio);
    const month = Number(mes);

    if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
    if (!Number.isInteger(month) || month < 1 || month > 12) return null;

    return { anio: year, mes: month };
};

// Los conceptos son libres: el admin decide nombre y monto. Se valida forma y
// tamaño, no el contenido.
const normalizarConceptos = (valor) => {
    if (!Array.isArray(valor)) return { error: 'conceptos debe ser un arreglo' };
    if (valor.length > MAX_CONCEPTOS) return { error: `máximo ${MAX_CONCEPTOS} conceptos` };

    const conceptos = [];

    for (const item of valor) {
        if (!item || typeof item !== 'object') {
            return { error: 'cada concepto debe ser un objeto { nombre, monto }' };
        }

        const nombre = String(item.nombre ?? '').trim().slice(0, MAX_NOMBRE);
        const monto = aNumero(item.monto);
        const tipo = TIPOS_CONCEPTO.includes(item.tipo) ? item.tipo : 'fijo';

        if (monto === null) {
            return { error: `el monto de "${nombre || 'sin nombre'}" debe ser un número mayor o igual a 0` };
        }

        // Una fila en blanco es ruido de la UI (el usuario agregó y no llenó):
        // se descarta en vez de rechazar el guardado entero.
        if (!nombre && monto === 0) continue;

        conceptos.push({ nombre, monto, tipo });
    }

    return { conceptos };
};

const serializar = (row, periodo, guardado) => ({
    anio: periodo.anio,
    mes: periodo.mes,
    conceptos: (Array.isArray(row?.conceptos) ? row.conceptos : BASELINE.conceptos)
        .map(c => ({ ...c, tipo: TIPOS_CONCEPTO.includes(c?.tipo) ? c.tipo : 'fijo' })),
    neto_venta: Number(row?.neto_venta ?? BASELINE.neto_venta),
    // `guardado` le dice al front si el periodo ya tiene fila propia o solo trae
    // valores heredados/baseline que todavía no se confirman con un PUT. Es un
    // argumento explícito y no `Boolean(row)` justamente porque una fila heredada
    // de otro mes también llega con datos: tener valores no es estar guardado.
    guardado,
});

// Si el mes pedido no existe, hereda los gastos del periodo guardado más
// reciente anterior a él: abrir un mes nuevo no debe arrancar la meta en cero.
const heredarPeriodoAnterior = async (periodo) => {
    const { data, error } = await supabase
        .from('admin_gastos_fijos')
        .select('conceptos, neto_venta, anio, mes')
        .or(`anio.lt.${periodo.anio},and(anio.eq.${periodo.anio},mes.lt.${periodo.mes})`)
        .order('anio', { ascending: false })
        .order('mes', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) throw new Error(error.message);
    return data;
};

const getGastosFijos = async (req, res = response) => {
    const periodo = normalizarPeriodo(req.query);

    if (!periodo) {
        return res.status(400).json({ ok: false, msg: 'anio y mes son requeridos' });
    }

    try {
        const { data, error } = await supabase
            .from('admin_gastos_fijos')
            .select('conceptos, neto_venta')
            .eq('anio', periodo.anio)
            .eq('mes', periodo.mes)
            .maybeSingle();

        if (error) {
            return res.status(500).json({ ok: false, msg: error.message });
        }

        if (data) {
            return res.status(200).json({ gastos: serializar(data, periodo, true) });
        }

        const heredado = await heredarPeriodoAnterior(periodo);

        return res.status(200).json({ gastos: serializar(heredado, periodo, false) });

    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
};

const guardarGastosFijos = async (req, res = response) => {
    const periodo = normalizarPeriodo(req.body);

    if (!periodo) {
        return res.status(400).json({ ok: false, msg: 'anio y mes son requeridos' });
    }

    const { conceptos, error: errorConceptos } = normalizarConceptos(req.body.conceptos);

    if (errorConceptos) {
        return res.status(400).json({ ok: false, msg: errorConceptos });
    }

    const netoVenta = aNumero(req.body.neto_venta);

    if (netoVenta === null) {
        return res.status(400).json({ ok: false, msg: 'neto_venta debe ser un número mayor o igual a 0' });
    }

    try {
        const { data, error } = await supabase
            .from('admin_gastos_fijos')
            .upsert({ ...periodo, conceptos, neto_venta: netoVenta }, { onConflict: 'anio,mes' })
            .select('conceptos, neto_venta')
            .single();

        if (error) {
            return res.status(500).json({ ok: false, msg: error.message });
        }

        return res.status(200).json({ gastos: serializar(data, periodo, true) });

    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
};

module.exports = {
    getGastosFijos,
    guardarGastosFijos,
};
