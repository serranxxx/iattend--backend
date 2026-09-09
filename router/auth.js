/*
    Rutas de Usuarios / Auth
    host + /api/auth
*/

const { Router } = require('express');
const { validarJWT } = require('../middlewares/validar-jwt');
const { newUser, loginUsuario, revalidarToken, GetAllusers, getUserLogged, editUser, createUser, ensureAccount } = require('../controllers/auth');


const router = Router();

router.post('/new-user', newUser);
router.post('/create-user', createUser);
// Alta con Google/Apple: completa perfil y evento free (idempotente)
router.post('/ensure-account', ensureAccount);
router.put('/edit/:id', validarJWT, editUser);
router.post('/login', loginUsuario);
router.get('/renew', validarJWT, revalidarToken);
router.get('/', GetAllusers);
router.get('/user/info', validarJWT, getUserLogged)

module.exports = router;