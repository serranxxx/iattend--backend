/*
    Banco de recordatorios para invitados (iattend-vite)
    host + /api/admin
*/

const { Router } = require('express');
const { validarAdmin } = require('../middlewares/validar-admin');
const {
    listarPlantillas,
    crearPlantilla,
    actualizarPlantilla,
    eliminarPlantilla,
    reordenarPlantillas,
} = require('../controllers/reminderTemplates');

const router = Router();

router.get('/reminder-templates', validarAdmin, listarPlantillas);
router.post('/reminder-templates', validarAdmin, crearPlantilla);
router.post('/reminder-templates/reorder', validarAdmin, reordenarPlantillas);
router.patch('/reminder-templates/:id', validarAdmin, actualizarPlantilla);
router.delete('/reminder-templates/:id', validarAdmin, eliminarPlantilla);

module.exports = router;
