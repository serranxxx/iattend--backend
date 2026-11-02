/*
    Rutas de administración — edición de usuarios (nombre y rol)
    host + /api/admin
*/

const { Router } = require('express');
const { validarAdmin } = require('../middlewares/validar-admin');
const { editarUsuario, listarProveedores, beneficiosPlanners, editarBeneficiosPlanner, crearPlanner, creditosPopAdmin } = require('../controllers/adminUsuarios');

const router = Router();

router.get('/usuarios/proveedores', validarAdmin, listarProveedores);
router.patch('/usuarios/:user_id', validarAdmin, editarUsuario);
router.get('/planners/beneficios', validarAdmin, beneficiosPlanners);
router.put('/planners/:user_id/beneficios', validarAdmin, editarBeneficiosPlanner);
router.post('/planners', validarAdmin, crearPlanner);
// Créditos de un Pop (Admin → Eventos › Pop, "Agregar créditos").
router.post('/pops/:id/creditos', validarAdmin, creditosPopAdmin);

module.exports = router;
