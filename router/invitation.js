const { Router } = require('express');
const { updateInvitationActive, updateInvitationCredits, updateInvitationData } = require('../controllers/invitation');


const router = Router();

router.patch('/update-active', updateInvitationActive);
router.patch('/update-credits', updateInvitationCredits);
router.patch('/update-data', updateInvitationData);


module.exports = router;