const { Router } = require('express');
const { normalizeGuests, confirmImport } = require('../controllers/guestImport');

const router = Router();

router.post('/normalize', normalizeGuests);
router.post('/confirm', confirmImport);

module.exports = router;
