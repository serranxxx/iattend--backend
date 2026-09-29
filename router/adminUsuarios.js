/*
    Rutas de administración — edición de usuarios (nombre y rol)
    host + /api/admin
*/

const { Router } = require('express');
const { validarAdmin } = require('../middlewares/validar-admin');
const { editarUsuario, listarProveedores } = require('../controllers/adminUsuarios');

const router = Router();

router.get('/usuarios/proveedores', validarAdmin, listarProveedores);
router.patch('/usuarios/:user_id', validarAdmin, editarUsuario);

module.exports = router;
