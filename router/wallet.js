const express = require('express');
const { generatePass } = require('../controllers/walletController');
const servicio = require('../controllers/walletServicio');

const router = express.Router();

// Pase armado con los datos que manda quien llama (sin actualizaciones).
router.post('/pass', generatePass);

// Pase de un invitado leído de Supabase, con número de serie fijo (se actualiza).
router.get('/pase/invitacion/:invitationId/:guestId', servicio.paseInvitacion);
router.get('/pase/side/:eventId/:guestId', servicio.paseSide);

// Bienvenida al escanear (lector de pases de iattend-vite).
router.post('/bienvenida', servicio.bienvenida);

// Al publicar la invitación: los pases que ya están en los iPhone se actualizan.
router.post('/actualizar', servicio.actualizarEvento);

// Servicio web de PassKit (lo llama Wallet; webServiceURL = …/api/wallet).
router.post('/v1/devices/:device/registrations/:passType/:serial', servicio.registrar);
router.get('/v1/devices/:device/registrations/:passType', servicio.seriesActualizadas);
router.delete('/v1/devices/:device/registrations/:passType/:serial', servicio.darDeBaja);
router.get('/v1/passes/:passType/:serial', servicio.ultimoPase);
router.post('/v1/log', servicio.registroErrores);

module.exports = router;
