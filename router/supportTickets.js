/*
    Reportes de soporte
    host + /api/support  (público: crear)
    host + /api/admin    (admin: listar y actualizar)
*/

const { Router } = require('express');
const { validarAdmin } = require('../middlewares/validar-admin');
const { crearTicket, listarTickets, actualizarTicket } = require('../controllers/supportTickets');

const publicRouter = Router();
publicRouter.post('/tickets', crearTicket);

const adminRouter = Router();
adminRouter.get('/support-tickets', validarAdmin, listarTickets);
adminRouter.patch('/support-tickets/:id', validarAdmin, actualizarTicket);

module.exports = { publicRouter, adminRouter };
