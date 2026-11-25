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

// Prueba gratis de Pops+ de una cuenta (Admin → Usuarios › Clientes).
// Body: { activar: boolean, dias?: number (1–90, 14 por omisión) }.
router.post('/usuarios/:user_id/pops-prueba', validarAdmin, async (req, res) => {
    const { activarPrueba, quitarPrueba, DIAS_PRUEBA } = require('../helpers/popsSuscripcion');
    try {
        const dias = Math.min(90, Math.max(1, Number(req.body?.dias) || DIAS_PRUEBA));
        const fila = req.body?.activar
            ? await activarPrueba(req.params.user_id, dias)
            : await quitarPrueba(req.params.user_id);
        return res.json({ ok: true, suscripcion: fila });
    } catch (err) {
        if (err.code === 'YA_PAGA') return res.status(409).json({ ok: false, code: 'YA_PAGA', msg: err.message });
        console.error('[pops+] Error con la prueba gratis:', err.message);
        return res.status(500).json({ ok: false, msg: 'No se pudo cambiar la prueba de Pops+' });
    }
});

module.exports = router;
