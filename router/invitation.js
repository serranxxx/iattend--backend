const { Router } = require('express');
const { updateInvitationActive, updateInvitationCredits, updateInvitationData, AddNewOwner, RemoveOwnerByIndex } = require('../controllers/invitation');
const { createInvitationWithPlan } = require('../controllers/supabase');


const router = Router();

router.patch('/update-active', updateInvitationActive);
router.patch('/update-credits', updateInvitationCredits);
router.patch('/update-data', updateInvitationData);
router.patch('/add-owner', AddNewOwner);
router.patch('/remove-owner', RemoveOwnerByIndex);

router.post('/create-free', async (req, res) => {
    const { userId, userEmail, name, phoneNumber, label, plan, owners } = req.body;

    if (!userId || !plan || !name) {
        return res.status(400).json({ ok: false, msg: 'userId, plan y name son requeridos' });
    }

    try {
        await createInvitationWithPlan(userId, plan, {
            userEmail: userEmail || '',
            name,
            phoneNumber: phoneNumber || '',
            label: label || '',
            owners: owners ? JSON.stringify(owners) : '[]',
        });

        return res.status(201).json({ ok: true, msg: 'Invitación creada' });
    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
});


module.exports = router;