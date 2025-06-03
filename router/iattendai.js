/*
    Rutas de Usuarios / Auth
    host + /api/auth
*/

const { Router } = require('express');
const { generateInvitation } = require('../controllers/iattend-ai');
const { validarJWT } = require('../middlewares/validar-jwt');


const router = Router();

router.post('/generate-invitation', generateInvitation);


module.exports = router;