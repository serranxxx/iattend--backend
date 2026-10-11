/*
    Rutas del wedding planner — beneficios y alta de eventos de sus clientes
    host + /api/planner
*/

const { Router } = require('express');
const { validarPlanner } = require('../middlewares/validar-planner');
const {
    beneficios, crearEventoGratis, checkoutEvento, asignarCliente,
    precioEventoFlash, crearFlashGratis, checkoutFlash, asignarClienteFlash,
} = require('../controllers/planner');

const router = Router();

router.get('/beneficios', validarPlanner, beneficios);
router.post('/eventos', validarPlanner, crearEventoGratis);
router.post('/eventos/checkout', validarPlanner, checkoutEvento);
router.post('/eventos/:id/cliente', validarPlanner, asignarCliente);

// Eventos Flash (side events sin invitación)
router.get('/flash/precio', validarPlanner, precioEventoFlash);
router.post('/flash', validarPlanner, crearFlashGratis);
router.post('/flash/checkout', validarPlanner, checkoutFlash);
router.post('/flash/:id/cliente', validarPlanner, asignarClienteFlash);

module.exports = router;
