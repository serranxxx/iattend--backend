const { response } = require('express');
const supabase = require('../config/supabase');

// Pantallas del admin reservadas al dueño (hoy: Admin → Planes). Espejo de
// CORREO_DEL_DUENIO en iattend-vite src/pages/Admin/AdminLayout.jsx: allá se
// oculta la pestaña, aquí se bloquea la API para cualquier otro admin.
// Va después de validarAdmin: el token ya está validado como Administration.
const CORREO_DEL_DUENIO = 'albserrano8@gmail.com';

const validarDuenio = async (req, res = response, next) => {
    const authHeader = req.header('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    const { data, error } = await supabase.auth.getUser(token);
    const email = data?.user?.email?.toLowerCase();

    if (error || email !== CORREO_DEL_DUENIO) {
        return res.status(403).json({ ok: false, msg: 'Solo el dueño puede ver y editar los planes' });
    }

    next();
};

module.exports = { validarDuenio };
