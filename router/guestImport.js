const { Router } = require('express');
const { normalizeGuests, mapColumns, existingGuests, confirmImport } = require('../controllers/guestImport');
const { listarEventos, invitadosDeEvento } = require('../controllers/importarDeEvento');
const { validarAccesoEvento } = require('../middlewares/validar-acceso-evento');

const router = Router();

// Sesión de quien gestiona la invitación / side event del body. Sin esto
// cualquiera insertaba invitados en cualquier evento (va con la service role,
// así que la RLS no lo frena).
// /normalize = el camino viejo (toda la lista a la IA); queda mientras haya
// pestañas con el front anterior. El front nuevo usa /map + /existentes.
router.post('/normalize', validarAccesoEvento, normalizeGuests);
router.post('/map', validarAccesoEvento, mapColumns);
router.post('/existentes', validarAccesoEvento, existingGuests);
router.post('/confirm', validarAccesoEvento, confirmImport);
// Importar a un Pop desde otro evento del organizador: la lista de sus
// eventos y los invitados de uno (controllers/importarDeEvento.js).
router.post('/eventos', validarAccesoEvento, listarEventos);
router.post('/desde-evento', validarAccesoEvento, invitadosDeEvento);

module.exports = router;
