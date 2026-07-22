/*
    Rutas de Vendedores
    host + /api/vendedores
*/

const { Router } = require('express');
const { validarVendedorJWT } = require('../middlewares/validar-vendedor-jwt');
const { loginVendedor, miResumen, misVentas } = require('../controllers/vendedores');

const router = Router();

router.post('/login', loginVendedor);
router.get('/me/resumen', validarVendedorJWT, miResumen);
router.get('/me/ventas', validarVendedorJWT, misVentas);

module.exports = router;
