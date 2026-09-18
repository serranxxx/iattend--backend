/*
    Rutas de gastos fijos del mes (meta de ingreso neto)
    host + /api/admin
*/

const { Router } = require('express');
const { validarAdmin } = require('../middlewares/validar-admin');
const { getGastosFijos, guardarGastosFijos } = require('../controllers/adminGastosFijos');

const router = Router();

router.get('/gastos-fijos', validarAdmin, getGastosFijos);
router.put('/gastos-fijos', validarAdmin, guardarGastosFijos);

module.exports = router;
