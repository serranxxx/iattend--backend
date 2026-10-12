/*
    Stripe en el Admin (solo lectura)
    host + /api/admin
*/

const { Router } = require('express');
const { validarAdmin } = require('../middlewares/validar-admin');
const { validarDuenio } = require('../middlewares/validar-duenio');
const { resumenStripe, comisionesStripe } = require('../controllers/adminStripe');

const router = Router();

// Saldo, depósitos, pagos y disputas: solo el dueño (Ventas › Stripe y el
// recuadro "Saldo en Stripe" de Hoy).
router.get('/stripe/resumen', validarAdmin, validarDuenio, resumenStripe);
// Comisión del mes por día: cualquier admin, porque la pantalla Hoy (punto de
// equilibrio) la descuenta y Hoy completo es para todos.
router.get('/stripe/comisiones', validarAdmin, comisionesStripe);

module.exports = router;
