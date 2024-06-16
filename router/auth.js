/*
    Rutas de Usuarios / Auth
    host + /api/auth
*/

const { Router } = require('express');
const { validarJWT } = require('../middlewares/validar-jwt');
const { newUser, loginUsuario, revalidarToken, GetAllusers, getUserLogged } = require('../controllers/auth');


const router = Router();

router.post('/new-user', newUser);
router.post('/login', loginUsuario);
router.get('/renew', validarJWT, revalidarToken);
router.get('/', GetAllusers);
router.get('/user/info', validarJWT, getUserLogged)

module.exports = router;