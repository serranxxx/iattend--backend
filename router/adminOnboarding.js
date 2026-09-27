/*
    Slides del onboarding wizard (iattend-vite)
    host + /api/admin
*/

const { Router } = require('express');
const { validarAdmin } = require('../middlewares/validar-admin');
const {
    listarSlides,
    crearSlide,
    actualizarSlide,
    eliminarSlide,
    reordenarSlides,
} = require('../controllers/adminOnboarding');

const router = Router();

router.get('/onboarding-slides', validarAdmin, listarSlides);
router.post('/onboarding-slides', validarAdmin, crearSlide);
router.post('/onboarding-slides/reorder', validarAdmin, reordenarSlides);
router.patch('/onboarding-slides/:id', validarAdmin, actualizarSlide);
router.delete('/onboarding-slides/:id', validarAdmin, eliminarSlide);

module.exports = router;
