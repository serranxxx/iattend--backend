const { Router } = require('express');
const { normalizeGuests, confirmImport } = require('../controllers/guestImport');
const { validarAccesoEvento } = require('../middlewares/validar-acceso-evento');

const router = Router();

// Sesión de quien gestiona la invitación / side event del body. Sin esto
// cualquiera insertaba invitados en cualquier evento (va con la service role,
// así que la RLS no lo frena).
router.post('/normalize', validarAccesoEvento, normalizeGuests);
router.post('/confirm', validarAccesoEvento, confirmImport);

module.exports = router;
