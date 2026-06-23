const { Router } = require('express');
const { updateInvitationActive, updateInvitationCredits, updateInvitationData, AddNewOwner, RemoveOwnerByIndex, createInvitationFromPreview, setPlan } = require('../controllers/invitation');
const { createInvitationWithPlan } = require('../controllers/supabase');
const supabase = require('../config/supabase');


const router = Router();

router.post('/create-from-preview', createInvitationFromPreview);
router.patch('/set-plan', setPlan);
router.patch('/update-active', updateInvitationActive);
router.patch('/update-credits', updateInvitationCredits);
router.patch('/update-data', updateInvitationData);
router.patch('/add-owner', AddNewOwner);
router.patch('/remove-owner', RemoveOwnerByIndex);

router.post('/save-preview', async (req, res) => {
    const { userId, userEmail, data } = req.body;

    if (!userId || !data) {
        return res.status(400).json({ ok: false, msg: 'userId y data son requeridos' });
    }

    const eventDate = data?.cover?.date?.value || null;

    const { data: inv, error } = await supabase
        .from('invitations')
        .insert({
            user_id: userId,
            user_email: userEmail || '',
            active: false,
            type: 'closed',
            plan: 'pro',
            data,
            started: false,
            label: '',
            name: '',
            tickets: 300,
            tags: ['Amigos', 'Familia', 'Trabajo'],
            credits: 0,
            owners: [],
            event_date: eventDate,
        })
        .select('id')
        .single();

    if (error) return res.status(400).json({ ok: false, msg: error.message });
    return res.status(201).json({ ok: true, id: inv.id });
});

router.patch('/save-preview/:id', async (req, res) => {
    const { id } = req.params;
    const { data } = req.body;

    if (!data) return res.status(400).json({ ok: false, msg: 'data es requerida' });

    const { error } = await supabase
        .from('invitations')
        .update({ data, updated_at: new Date().toISOString() })
        .eq('id', id);

    if (error) return res.status(400).json({ ok: false, msg: error.message });
    return res.status(200).json({ ok: true });
});

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