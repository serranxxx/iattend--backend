const { response } = require('express');
const jwt = require('jsonwebtoken');

const validarVendedorJWT = (req, res = response, next) => {

    const token = req.header('vendor-token');

    if (!token) {
        return res.status(401).json({
            ok: false,
            msg: 'No hay token de vendedor en la petición'
        });
    }

    try {

        const { vendedorId } = jwt.verify(
            token,
            process.env.SECRET_JWT_SEED
        );

        req.vendedorId = vendedorId;

    } catch (error) {
        return res.status(401).json({
            ok: false,
            msg: 'Token de vendedor no válido'
        });
    }

    next();
}

module.exports = {
    validarVendedorJWT
}
