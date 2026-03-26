const { Router } = require('express');
const { updateInvitationActive, updateInvitationCredits, updateInvitationData, AddNewOwner, RemoveOwnerByIndex } = require('../controllers/invitation');


const router = Router();

router.patch('/update-active', updateInvitationActive);
router.patch('/update-credits', updateInvitationCredits);
router.patch('/update-data', updateInvitationData);
router.patch('/add-owner', AddNewOwner);
router.patch('/remove-owner', RemoveOwnerByIndex);


module.exports = router;