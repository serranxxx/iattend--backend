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
// Vista previa del correo de acceso de un Pop (ventana "Enviar" de Make a Pop):
// el mismo template que se manda, con el correo escrito y la contraseña oculta.
router.get('/pop/correo-preview', validarCuenta, (req, res) => {
    const { popAccesoEmailTemplate } = require('../controllers/templates/popAccesoEmail');
    const correo = String(req.query.correo || '').slice(0, 200) || 'cliente@correo.com';
    res.json({ ok: true, html: popAccesoEmailTemplate({ correo, password: '********' }) });
});
// Rutas de antes del cambio de nombre (Flash → Pop), para el editor que
// todavía esté desplegado con ellas.
router.get('/flash/precio', validarPlanner, precioEventoPop);
router.post('/flash', validarCuenta, crearPopGratis);
router.post('/flash/checkout', validarPlanner, checkoutPop);
router.post('/flash/:id/cliente', validarPlanner, asignarClientePop);

module.exports = router;
