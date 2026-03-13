const { Router } = require('express');
const { verifyWhatsappWebhook, receiveWhatsappWebhook } = require('../controllers/whatsappWebhook');


const router = Router();

router.get('/whatsapp', verifyWhatsappWebhook);
router.post('/whatsapp', receiveWhatsappWebhook);

module.exports = router;