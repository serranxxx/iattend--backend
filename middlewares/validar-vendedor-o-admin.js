const { response } = require('express');
const jwt = require('jsonwebtoken');
const { resolveAdminUserId } = require('../helpers/adminAuth');

/**
 * Acepta un token de vendedor (header `vendor-token`) o una sesión de
 * admin (header `Authorization: Bearer <access_token>`). Usado por
 * endpoints que ambos roles necesitan tocar (pagos, configuración de cobro).
 */
const validarVendedorOAdmin = async (req, res = response, next) => {
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
    const result = await resolveAdminUserId(token);

    if (!result.ok) {
        return res.status(result.status).json({ ok: false, msg: result.msg });
    }

    req.isAdmin = true;
    req.adminUserId = result.userId;
    next();
}

module.exports = {
    validarVendedorOAdmin
}
