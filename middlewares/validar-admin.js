const { response } = require('express');
const { resolveAdminUserId } = require('../helpers/adminAuth');

const validarAdmin = async (req, res = response, next) => {
    const authHeader = req.header('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    const result = await resolveAdminUserId(token);

    if (!result.ok) {
        return res.status(result.status).json({ ok: false, msg: result.msg });
    }

    req.adminUserId = result.userId;
    next();
}

module.exports = {
    validarAdmin
}
