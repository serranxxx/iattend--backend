const express = require('express');

const { validarJWT } = require('../middlewares/validar-jwt');
const { createGuest, getGuests, updateGuestInArray, deleteGuestInArray, getGuestByInvitationId, updateGuestByInvitationId, deleteGuestByInvitationId, getUpdatesByInvitationID, guestLogin } = require('../controllers/guests');

const router = express.Router();

router.post('/', validarJWT, createGuest)
router.get('/', validarJWT, getGuests)
router.get('/:id', validarJWT, getGuestByInvitationId)
router.patch('/:id', validarJWT, updateGuestByInvitationId)
router.delete('/:id', validarJWT, deleteGuestByInvitationId)

router.patch('/:id/guests', validarJWT, updateGuestInArray)
router.delete('/:id/guests', validarJWT, deleteGuestInArray)
router.get('/:id/updates', validarJWT, getUpdatesByInvitationID)

router.post('/login', guestLogin)

module.exports = router;