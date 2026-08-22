const { Router } = require('express');
const { sendWhatsappTemplate, sendWhatsappReminder, createWhatsappBulk, sendWhatsappFreeText } = require('../controllers/whatsapp');
const { getWhatsappMediaUrl } = require('../controllers/whatsappWebhook');

const router = Router();

router.post('/', sendWhatsappTemplate);
router.post('/reminders', sendWhatsappReminder);
router.post('/bulk', createWhatsappBulk);
router.post('/freetext', sendWhatsappFreeText);
router.get('/media/:mediaId', getWhatsappMediaUrl);

module.exports = router;