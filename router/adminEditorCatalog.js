/*
    Catálogo del panel lateral del editor (Elementos / Fotos)
    host + /api/admin
*/

const { Router } = require('express');
const multer = require('multer');
const { validarAdmin } = require('../middlewares/validar-admin');
const {
    listarCatalogo,
    crearCategoria,
    actualizarCategoria,
    ordenarCategorias,
    eliminarCategoria,
    crearAsset,
    actualizarAsset,
    ordenarAssets,
    usoAsset,
    eliminarAsset,
} = require('../controllers/adminEditorCatalog');

const router = Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

router.get('/editor-catalog', validarAdmin, listarCatalogo);

router.post('/editor-catalog/categories', validarAdmin, crearCategoria);
router.post('/editor-catalog/categories/reorder', validarAdmin, ordenarCategorias);
router.patch('/editor-catalog/categories/:id', validarAdmin, actualizarCategoria);
router.delete('/editor-catalog/categories/:id', validarAdmin, eliminarCategoria);

router.post('/editor-catalog/assets', validarAdmin, upload.single('file'), crearAsset);
router.post('/editor-catalog/assets/reorder', validarAdmin, ordenarAssets);
router.get('/editor-catalog/assets/:id/usage', validarAdmin, usoAsset);
router.patch('/editor-catalog/assets/:id', validarAdmin, actualizarAsset);
router.delete('/editor-catalog/assets/:id', validarAdmin, eliminarAsset);

module.exports = router;
