const { Router } = require('express');
const { sendWhatsappTemplate, sendWhatsappFreeText } = require('../controllers/whatsapp');

const router = Router();

router.post('/', sendWhatsappTemplate);
router.post('/freetext', sendWhatsappFreeText);

module.exports = router;