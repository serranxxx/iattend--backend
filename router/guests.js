const express = require('express');

const { validarJWT } = require('../middlewares/validar-jwt');
const { createGuest, getGuests, updateGuestInArray, deleteGuestInArray, getGuestByInvitationId, updateGuestByInvitationId, deleteGuestByInvitationId, getUpdatesByInvitationID, guestLogin, addShareItem, deleteShareItemById, shareLogin } = require('../controllers/guests');

const router = express.Router();

router.post('/', validarJWT, createGuest)
router.get('/', validarJWT, getGuests)
router.get('/:id', getGuestByInvitationId)
router.patch('/:id', updateGuestByInvitationId)
router.delete('/:id', validarJWT, deleteGuestByInvitationId)

router.patch('/:id/guests', validarJWT, updateGuestInArray)
router.delete('/:id/guests', validarJWT, deleteGuestInArray)
router.get('/:id/updates', validarJWT, getUpdatesByInvitationID)

router.post('/login', guestLogin)
router.post('/shared/:id', validarJWT, addShareItem)
router.delete('/shared/:id', validarJWT, deleteShareItemById)
router.post('/shared/login/:id', shareLogin)

module.exports = router;