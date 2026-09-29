/*
    Datos de Lia para la analítica del admin
    host + /api/admin
*/

const { Router } = require('express');
const { validarAdmin } = require('../middlewares/validar-admin');
const { getDatosLia } = require('../controllers/adminLia');

const router = Router();

router.get('/lia/datos', validarAdmin, getDatosLia);

module.exports = router;
