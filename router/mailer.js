const { Router } = require('express');
const { handleSendMail } = require('../controllers/mailer');

const router = Router();

router.post('/send-mail', handleSendMail);

module.exports = router;