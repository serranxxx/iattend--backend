const { response } = require('express');
const supabase = require('../config/supabase');
const { usuarioDeRequest } = require('../helpers/plannerBenefits');
const { tieneFuncionesDePlanner } = require('../helpers/roles');

// Rutas del planner: sesión de Supabase (Authorization: Bearer) de un perfil
// con funciones de planner (planner o Administración, helpers/roles.js).
// Deja req.plannerId y req.plannerEmail.
const validarPlanner = async (req, res = response, next) => {
    const user = await usuarioDeRequest(req);
    if (!user) return res.status(401).json({ ok: false, msg: 'Sesión no válida' });

    const { data: perfil, error } = await supabase
        .from('profiles').select('role, user_email, active').eq('user_id', user.id).maybeSingle();
    if (error) return res.status(500).json({ ok: false, msg: error.message });
    if (!tieneFuncionesDePlanner(perfil?.role)) return res.status(403).json({ ok: false, msg: 'Solo para cuentas de planner' });
    // Cuenta desactivada desde Admin → Usuarios: ya no opera (igual que
    // validar-acceso-invitacion.js).
    if (perfil.active === false) return res.status(403).json({ ok: false, msg: 'Tu cuenta está desactivada' });

    req.plannerId = user.id;
    req.plannerEmail = perfil.user_email || user.email;
    // Administración crea sin costo: no gasta eventos gratis (controllers/planner.js).
    req.esAdmin = perfil.role === 'Administration';
    next();
};

// Cualquier cuenta activa (cliente, planner o Administración): lo que también
// puede usar un cliente, hoy sus Pops gratis (Admin → Usuarios › Clientes).
// Deja lo mismo que validarPlanner más req.esPlanner.
const validarCuenta = async (req, res = response, next) => {
    const user = await usuarioDeRequest(req);
    if (!user) return res.status(401).json({ ok: false, msg: 'Sesión no válida' });

    const { data: perfil, error } = await supabase
        .from('profiles').select('role, user_email, active').eq('user_id', user.id).maybeSingle();
    if (error) return res.status(500).json({ ok: false, msg: error.message });
    if (perfil?.active === false) return res.status(403).json({ ok: false, msg: 'Tu cuenta está desactivada' });

    req.plannerId = user.id;
    req.plannerEmail = perfil?.user_email || user.email;
    req.esPlanner = tieneFuncionesDePlanner(perfil?.role);
    req.esAdmin = perfil?.role === 'Administration';
    next();
};

module.exports = { validarPlanner, validarCuenta };
