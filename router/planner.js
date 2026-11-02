/*
    Rutas del wedding planner — beneficios y alta de eventos de sus clientes
    host + /api/planner
*/

const { Router } = require('express');
const { validarPlanner, validarCuenta } = require('../middlewares/validar-planner');
const {
    beneficios, crearEventoGratis, checkoutEvento, asignarCliente,
    precioEventoPop, crearPopGratis, checkoutPop, asignarClientePop,
} = require('../controllers/planner');

const router = Router();

// Beneficios y Pop gratis: también los clientes con Pops gratis asignados.
router.get('/beneficios', validarCuenta, beneficios);
router.post('/eventos', validarPlanner, crearEventoGratis);
router.post('/eventos/checkout', validarPlanner, checkoutEvento);
router.post('/eventos/:id/cliente', validarPlanner, asignarCliente);

// Pops (side events sin invitación)
router.get('/pop/precio', validarPlanner, precioEventoPop);
router.post('/pop', validarCuenta, crearPopGratis);
router.post('/pop/checkout', validarPlanner, checkoutPop);
router.post('/pop/:id/cliente', validarPlanner, asignarClientePop);
// Rutas de antes del cambio de nombre (Flash → Pop), para el editor que
// todavía esté desplegado con ellas.
router.get('/flash/precio', validarPlanner, precioEventoPop);
router.post('/flash', validarCuenta, crearPopGratis);
router.post('/flash/checkout', validarPlanner, checkoutPop);
router.post('/flash/:id/cliente', validarPlanner, asignarClientePop);

module.exports = router;
