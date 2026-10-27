const { Router } = require('express');
const { sendWhatsappTemplate, sendWhatsappReminder, createWhatsappBulk, sendWhatsappFreeText } = require('../controllers/whatsapp');
const { getWhatsappMediaUrl } = require('../controllers/whatsappWebhook');
const { crearLoteRecordatorio } = require('../controllers/reminderTemplates');

const router = Router();

router.post('/', sendWhatsappTemplate);
router.post('/reminders', sendWhatsappReminder);
// Recordatorios del banco (Guest management → Recordatorios), envío masivo.
router.post('/reminders/bulk', crearLoteRecordatorio);
router.post('/bulk', createWhatsappBulk);
router.post('/freetext', sendWhatsappFreeText);
router.get('/media/:mediaId', getWhatsappMediaUrl);

module.exports = router;