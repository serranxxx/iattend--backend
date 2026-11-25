const { Router } = require('express');
const { sendWhatsappTemplate, sendWhatsappReminder, createWhatsappBulk, sendWhatsappFreeText } = require('../controllers/whatsapp');
const { getWhatsappMediaUrl } = require('../controllers/whatsappWebhook');
const { crearLoteRecordatorio } = require('../controllers/reminderTemplates');
const { soloPopPlus } = require('../middlewares/solo-pop-plus');
const { validarAccesoEvento } = require('../middlewares/validar-acceso-evento');
const { conversacionesDePop, marcarLeidosPop } = require('../controllers/conversacionesPop');

const router = Router();

// Todo envío pide la sesión de Supabase (Authorization: Bearer) de quien
// gestiona la invitación / side event del body (dueño, planner o admin).
router.post('/', validarAccesoEvento, sendWhatsappTemplate);
router.post('/reminders', validarAccesoEvento, sendWhatsappReminder);
// Recordatorios del banco (Guest management → Recordatorios), envío masivo.
// Recordatorios de un Pop: solo Pops+ (soloPopPlus; una boda pasa).
router.post('/reminders/bulk', validarAccesoEvento, soloPopPlus, crearLoteRecordatorio);
router.post('/bulk', validarAccesoEvento, createWhatsappBulk);
router.post('/freetext', validarAccesoEvento, sendWhatsappFreeText);
// Buzón de un Pop (la boda usa la RPC get_conversations_by_invitation).
router.post('/conversaciones', validarAccesoEvento, conversacionesDePop);
router.post('/conversaciones/leidos', validarAccesoEvento, marcarLeidosPop);
// Sin sesión a propósito: lo piden <img> / <video> / <audio> del buzón, que no
// pueden mandar headers. El mediaId de Meta es largo y no secuencial.
router.get('/media/:mediaId', getWhatsappMediaUrl);

module.exports = router;
