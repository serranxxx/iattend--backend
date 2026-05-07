const express = require('express');
const { generatePass } = require('../controllers/walletController');

const router = express.Router();

router.post('/pass', generatePass);

module.exports = router;
