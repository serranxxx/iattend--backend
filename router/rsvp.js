/*
    Rutas de Usuarios / Auth
    host + /api/auth
*/

const { Router } = require('express');
const { validarJWT } = require('../middlewares/validar-jwt');
const { newInvitation, editInv, getAll, getNames, getByID, getByUserID } = require('../controllers/rsvp');


const router = Router();

router.post('/', validarJWT, newInvitation);
router.put('/:id', validarJWT, editInv);
router.get('/', getAll);
router.post('/dominios', validarJWT, getNames);
router.get('/:id', getByID);
router.get('/user/:id', validarJWT, getByUserID);
// router.delete('/:id', validarJWT, deleteInvitation)


module.exports = router;