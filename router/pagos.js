/*
    Rutas de Pagos
    host + /api/pagos
*/

const { Router } = require('express');
const multer = require('multer');
const { validarVendedorOAdmin } = require('../middlewares/validar-vendedor-o-admin');
const { registrarPago, historialPagos, subirComprobante } = require('../controllers/pagos');

const router = Router();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
});

router.get('/', validarVendedorOAdmin, historialPagos);
router.post('/', validarVendedorOAdmin, registrarPago);
router.post('/:pago_id/comprobante', validarVendedorOAdmin, upload.single('archivo'), subirComprobante);

module.exports = router;
