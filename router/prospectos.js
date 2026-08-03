/*
    Rutas de Prospectos (Instagram)
    host + /api/prospectos
*/

const { Router } = require('express');
const { validarProspectosAuth } = require('../middlewares/validarProspectosAuth');
const {
    listarProspectos,
    misProspectos,
    asignarVendedor,
    actualizarEstado,
    actualizarDetalles,
    solicitarActivacion,
} = require('../controllers/prospectos');

const router = Router();

router.use(validarProspectosAuth);

router.get('/', listarProspectos);
router.get('/mis-prospectos', misProspectos);
router.patch('/:id/asignar', asignarVendedor);
router.patch('/:id/estado', actualizarEstado);
router.post('/:id/solicitar-activacion', solicitarActivacion);
router.patch('/:id', actualizarDetalles);

module.exports = router;
