/*
    Ajustes generales que se prenden / apagan desde el admin (app_settings,
    migración 2026-10-28d_app_settings.sql).
    host + /api/admin
*/

const { Router } = require('express');
const supabase = require('../config/supabase');
const { validarAdmin } = require('../middlewares/validar-admin');

const router = Router();

// Solo estos ajustes se pueden escribir (cada uno con su forma).
const PERMITIDOS = {
    editor_design_styles: (v) => ({ enabled: Boolean(v?.enabled) }),
};

router.get('/settings', validarAdmin, async (_req, res) => {
    const { data, error } = await supabase.from('app_settings').select('key, value, updated_at');
    if (error) return res.status(500).json({ ok: false, msg: 'No se pudieron leer los ajustes' });
    return res.json({ ok: true, settings: data });
});

router.patch('/settings/:key', validarAdmin, async (req, res) => {
    const limpiar = PERMITIDOS[req.params.key];
    if (!limpiar) return res.status(400).json({ ok: false, msg: 'Ajuste desconocido' });
    const { data, error } = await supabase
        .from('app_settings')
        .upsert({ key: req.params.key, value: limpiar(req.body?.value), updated_at: new Date().toISOString(), updated_by: req.adminUserId })
        .select('key, value, updated_at')
        .single();
    if (error) return res.status(500).json({ ok: false, msg: 'No se pudo guardar el ajuste' });
    return res.json({ ok: true, setting: data });
});

module.exports = router;
