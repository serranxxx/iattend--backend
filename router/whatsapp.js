const { Router } = require('express');
const { sendWhatsappTemplate } = require('../controllers/whatsapp');

const router = Router();

router.post('/', sendWhatsappTemplate);

module.exports = router;