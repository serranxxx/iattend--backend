/*
    Catálogo de planes
    host + /api/plans        (público)
    host + /api/admin/plans  (admin)
*/

const { Router } = require('express');
const { validarAdmin } = require('../middlewares/validar-admin');
const { validarDuenio } = require('../middlewares/validar-duenio');
const {
    listarPlanesPublicos,
    listarPlanesAdmin,
    actualizarPlan,
} = require('../controllers/plans');

const publicRouter = Router();
publicRouter.get('/', listarPlanesPublicos);

const adminRouter = Router();
adminRouter.get('/plans', validarAdmin, validarDuenio, listarPlanesAdmin);
adminRouter.patch('/plans/:id', validarAdmin, validarDuenio, actualizarPlan);

module.exports = { publicRouter, adminRouter };
