/*
    Rutas de administración — catálogo de invitaciones (read-only)
    host + /api/admin
*/

const { Router } = require('express');
const { validarAdmin } = require('../middlewares/validar-admin');
const { listarInvitaciones, obtenerInvitacionData } = require('../controllers/adminInvitaciones');

const router = Router();

router.get('/invitaciones', validarAdmin, listarInvitaciones);
router.get('/invitaciones/:invitation_id/data', validarAdmin, obtenerInvitacionData);

module.exports = router;
