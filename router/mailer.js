const { Router } = require('express');
const { handleSendMail, handleSendGiftMail } = require('../controllers/mailer');

const router = Router();

router.post('/send-mail', handleSendMail);
router.post('/send-gift', handleSendGiftMail);

module.exports = router;