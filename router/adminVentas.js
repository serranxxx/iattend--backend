/*
    Rutas de administración de ventas
    host + /api/admin
*/

const { Router } = require('express');
const { validarAdmin } = require('../middlewares/validar-admin');
const { listarVentas, editarVenta, pagosPendientesComprobante, listarVendedores, crearVendedor, editarVendedor, buscarInvitacionesSinVenta, crearVentaManual } = require('../controllers/adminVentas');

const router = Router();

router.get('/ventas', validarAdmin, listarVentas);
router.post('/ventas', validarAdmin, crearVentaManual);
router.patch('/ventas/:venta_id', validarAdmin, editarVenta);
router.get('/pagos', validarAdmin, pagosPendientesComprobante);
router.get('/vendedores', validarAdmin, listarVendedores);
router.post('/vendedores', validarAdmin, crearVendedor);
router.patch('/vendedores/:vendedor_id', validarAdmin, editarVendedor);
router.get('/invitaciones-disponibles', validarAdmin, buscarInvitacionesSinVenta);

module.exports = router;
