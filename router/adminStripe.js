/*
    Stripe en el Admin (solo lectura, solo el dueño)
    host + /api/admin
*/

const { Router } = require('express');
const { validarAdmin } = require('../middlewares/validar-admin');
const { validarDuenio } = require('../middlewares/validar-duenio');
const { resumenStripe, comisionesStripe } = require('../controllers/adminStripe');

const router = Router();

router.get('/stripe/resumen', validarAdmin, validarDuenio, resumenStripe);
router.get('/stripe/comisiones', validarAdmin, validarDuenio, comisionesStripe);

module.exports = router;
