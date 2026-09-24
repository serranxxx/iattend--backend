/*
    Rutas de administración — catálogo de invitaciones y asignación de planner
    host + /api/admin
*/

const { Router } = require('express');
const { validarAdmin } = require('../middlewares/validar-admin');
const { listarInvitaciones, obtenerInvitacionData, asignarPlanner } = require('../controllers/adminInvitaciones');

const router = Router();

router.get('/invitaciones', validarAdmin, listarInvitaciones);
router.get('/invitaciones/:invitation_id/data', validarAdmin, obtenerInvitacionData);
router.patch('/invitaciones/:invitation_id/planner', validarAdmin, asignarPlanner);

module.exports = router;
