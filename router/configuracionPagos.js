/*
    Rutas de configuración de cobro
    host + /api/configuracion-pagos
*/

const { Router } = require('express');
const { validarVendedorOAdmin } = require('../middlewares/validar-vendedor-o-admin');
const { getConfiguracionPagos } = require('../controllers/configuracionPagos');

const router = Router();

router.get('/', validarVendedorOAdmin, getConfiguracionPagos);

module.exports = router;
