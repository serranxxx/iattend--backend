const { Router } = require('express');
const { sendWhatsappTemplate, sendWhatsappReminder, createWhatsappBulk, sendWhatsappFreeText } = require('../controllers/whatsapp');
const { getWhatsappMediaUrl } = require('../controllers/whatsappWebhook');
const { crearLoteRecordatorio } = require('../controllers/reminderTemplates');
const { validarAccesoEvento } = require('../middlewares/validar-acceso-evento');

const router = Router();

// Todo envío pide la sesión de Supabase (Authorization: Bearer) de quien
// gestiona la invitación / side event del body (dueño, planner o admin).
router.post('/', validarAccesoEvento, sendWhatsappTemplate);
router.post('/reminders', validarAccesoEvento, sendWhatsappReminder);
// Recordatorios del banco (Guest management → Recordatorios), envío masivo.
router.post('/reminders/bulk', validarAccesoEvento, crearLoteRecordatorio);
router.post('/bulk', validarAccesoEvento, createWhatsappBulk);
router.post('/freetext', validarAccesoEvento, sendWhatsappFreeText);
// Sin sesión a propósito: lo piden <img> / <video> / <audio> del buzón, que no
// pueden mandar headers. El mediaId de Meta es largo y no secuencial.
router.get('/media/:mediaId', getWhatsappMediaUrl);

module.exports = router;
