const { Router } = require('express');
const { sendWhatsappTemplate, sendWhatsappFreeText } = require('../controllers/whatsapp');
const { getWhatsappMediaUrl } = require('../controllers/whatsappWebhook');

const router = Router();

router.post('/', sendWhatsappTemplate);
router.post('/freetext', sendWhatsappFreeText);
router.get('/media/:mediaId', getWhatsappMediaUrl);

module.exports = router;