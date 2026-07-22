/*
    Rutas de Ventas
    host + /api/ventas
*/

const { Router } = require('express');
const { validarVendedorJWT } = require('../middlewares/validar-vendedor-jwt');
const { checkUrl, checkCliente, buscarClientes, crearVenta } = require('../controllers/ventas');

const router = Router();

router.get('/check-url', checkUrl);
router.get('/check-cliente', validarVendedorJWT, checkCliente);
router.get('/clientes', validarVendedorJWT, buscarClientes);
router.post('/', validarVendedorJWT, crearVenta);

module.exports = router;
