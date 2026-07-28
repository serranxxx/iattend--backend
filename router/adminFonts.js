/*
    Rutas de administración de fonts
    host + /api/admin
*/

const { Router } = require('express');
const { validarAdmin } = require('../middlewares/validar-admin');
const { listarFonts, instalarFont, actualizarFont, buscarGoogleFonts } = require('../controllers/adminFonts');

const router = Router();

router.get('/fonts', validarAdmin, listarFonts);
router.get('/fonts/google-search', validarAdmin, buscarGoogleFonts);
router.post('/fonts', validarAdmin, instalarFont);
router.patch('/fonts/:id', validarAdmin, actualizarFont);

module.exports = router;
