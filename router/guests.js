const express = require('express');

// const {} = require('../middlewares/validar-jwt');
const { createGuest, getGuests, updateGuestInArray, deleteGuestInArray, getGuestByInvitationId, updateGuestByInvitationId, deleteGuestByInvitationId, getUpdatesByInvitationID, guestLogin, addShareItem, deleteShareItemById, shareLogin, confirmGuests } = require('../controllers/guests');

const router = express.Router();

router.post('/', createGuest)
router.get('/', getGuests)
router.get('/:id', getGuestByInvitationId)
router.patch('/:id', updateGuestByInvitationId)
router.patch('/confirm/:id', confirmGuests)
router.delete('/:id', deleteGuestByInvitationId)

router.patch('/:id/guests', updateGuestInArray)
router.delete('/:id/guests', deleteGuestInArray)
router.get('/:id/updates', getUpdatesByInvitationID)

router.post('/login', guestLogin)
router.post('/shared/:id', addShareItem)
router.delete('/shared/:id', deleteShareItemById)
router.post('/shared/login/:id', shareLogin)

module.exports = router;