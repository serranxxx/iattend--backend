/*
    Rutas del catálogo de marcas de mesa de regalos (tiendas y bancos)
    host + /api/admin
*/

const { Router } = require('express');
const { validarAdmin } = require('../middlewares/validar-admin');
const {
    listarGiftBrands,
    crearGiftBrand,
    actualizarGiftBrand,
    eliminarGiftBrand,
} = require('../controllers/adminGiftBrands');

const router = Router();

router.get('/gift-brands', validarAdmin, listarGiftBrands);
router.post('/gift-brands', validarAdmin, crearGiftBrand);
router.patch('/gift-brands/:id', validarAdmin, actualizarGiftBrand);
router.delete('/gift-brands/:id', validarAdmin, eliminarGiftBrand);

module.exports = router;
