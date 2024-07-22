/*
    Rutas de Usuarios / Auth
    host + /api/auth
*/

const { Router } = require('express');
const { validarJWT } = require('../middlewares/validar-jwt');
const { postInvitations, putInvitations, getInvitations, getIvitationbyID, deleteInvitation, getIvitationsbyUserID, getDominios } = require('../controllers/wedInvitation');


const router = Router();

router.post('/', validarJWT, postInvitations);
router.put('/:id', validarJWT, putInvitations);
router.get('/', getInvitations);
router.post('/dominios', validarJWT, getDominios);
router.get('/:id', getIvitationbyID);
router.get('/user/:id', validarJWT, getIvitationsbyUserID);
router.delete('/:id', validarJWT, deleteInvitation)


module.exports = router;