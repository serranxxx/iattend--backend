const { response } = require('express');
const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');

/**
 * Auth para /api/prospectos. A diferencia de validar-vendedor-o-admin.js,
 * también acepta un usuario de sesión normal (Supabase Auth) con
 * profiles.role === 'sales' — lo resuelve a su fila en `vendedores` haciendo
 * match por email, ya que hoy no existe ninguna columna que los vincule.
 */
const validarProspectosAuth = async (req, res = response, next) => {
    const vendorToken = req.header('vendor-token');

    if (vendorToken) {
        try {
            const { vendedorId } = jwt.verify(vendorToken, process.env.SECRET_JWT_SEED);
            req.vendedorId = vendedorId;
            return next();
        } catch (error) {
            return res.status(401).json({ ok: false, msg: 'Token de vendedor no válido' });
        }
    }

    const authHeader = req.header('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
        return res.status(401).json({ ok: false, msg: 'No hay token de sesión en la petición' });
    }

    const { data: userData, error: userError } = await supabase.auth.getUser(token);

    if (userError || !userData?.user) {
        return res.status(401).json({ ok: false, msg: 'Token no válido' });
    }

    const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role, user_email')
        .eq('user_id', userData.user.id)
        .maybeSingle();

    if (profileError) {
        return res.status(500).json({ ok: false, msg: profileError.message });
    }

    if (profile?.role === 'Administration') {
        req.isAdmin = true;
        req.adminUserId = userData.user.id;
        return next();
    }

    if (profile?.role === 'sales') {
        const emailNormalizado = profile.user_email ? profile.user_email.trim().toLowerCase() : null;

        const { data: vendedor, error: vendedorError } = await supabase
            .from('vendedores')
            .select('id')
            .eq('email', emailNormalizado)
            .maybeSingle();

        if (vendedorError) {
            return res.status(500).json({ ok: false, msg: vendedorError.message });
        }

        if (!vendedor) {
            return res.status(403).json({ ok: false, msg: 'Tu cuenta no está vinculada a ningún vendedor' });
        }

        req.vendedorId = vendedor.id;
        return next();
    }

    return res.status(403).json({ ok: false, msg: 'No tienes permisos para esta sección' });
};

module.exports = { validarProspectosAuth };
