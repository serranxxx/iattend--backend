const { Router } = require('express');
const { updateInvitationActive, updateInvitationCredits, updateInvitationData, updateInvitationFields, AddNewOwner, RemoveOwnerByIndex, createInvitationFromPreview, setPlan } = require('../controllers/invitation');
const { createInvitationWithPlan } = require('../controllers/supabase');
const supabase = require('../config/supabase');
const { validarAdmin } = require('../middlewares/validar-admin');
const { validarAccesoInvitacionPor } = require('../middlewares/validar-acceso-invitacion');
const { usuarioDeSesion, perfilDe, esAdminActivo } = require('../helpers/accesoEvento');


const router = Router();

// Antes ninguna de estas rutas pedía sesión: con el id de una invitación (va
// en su página pública) cualquiera podía reescribir `data`, cambiarle el
// nombre o los dueños, o crear invitaciones PRO sin pagar.
//   · Sobre una invitación existente → Bearer de Supabase y dueño / planner
//     asignado / Administration (validar-acceso-invitacion.js), con el id en
//     `id` (body) o en `:id`.
//   · El plan, los créditos y `active` los pone el pago (webhook) → solo admin.
//   · Crear → la sesión manda: un usuario solo crea para sí mismo y sin plan
//     (o `free`, el Save the Date); con plan o para otra cuenta, solo admin.
const accesoPorId = validarAccesoInvitacionPor((req) => req.body?.id);
const accesoPorParam = validarAccesoInvitacionPor((req) => req.params?.id);

// Sesión obligatoria; deja en req.sesion { id, email, admin }.
const conSesion = async (req, res, next) => {
    try {
        const usuario = await usuarioDeSesion(req);
        if (!usuario) return res.status(401).json({ ok: false, msg: 'Inicia sesión' });
        const perfil = await perfilDe(usuario.id);
        req.sesion = { ...usuario, admin: esAdminActivo(perfil) };
        next();
    } catch (err) {
        console.error('Error validando la sesión:', err);
        return res.status(500).json({ ok: false, msg: 'No se pudo validar la sesión' });
    }
};

// Un usuario normal solo crea para su propia cuenta.
const soloParaSiMismo = (campo) => (req, res, next) => {
    if (req.sesion.admin) return next();
    const pedido = req.body?.[campo];
    if (pedido && String(pedido) !== String(req.sesion.id)) {
        return res.status(403).json({ ok: false, msg: 'Solo puedes crear invitaciones para tu cuenta' });
    }
    req.body[campo] = req.sesion.id;
    next();
};

// Desde la vista previa la invitación nace sin plan; con plan (activa y con
// sus créditos) solo la crea Administración.
const previewSinPlan = (req, res, next) => {
    if (!req.sesion.admin) req.body.plan = null;
    next();
};

// create-free: un usuario solo crea el plan `free` (Save the Date); los demás
// planes sin pagar los da Administración (Admin → Eventos → Crear gratis).
const soloPlanFree = (req, res, next) => {
    if (req.sesion.admin || req.body?.plan === 'free') return next();
    return res.status(403).json({ ok: false, msg: 'Ese plan se activa con el pago' });
};

router.post('/create-from-preview', conSesion, soloParaSiMismo('user_id'), previewSinPlan, createInvitationFromPreview);
// Sin llamadas desde el front: el plan y `active` los pone el webhook de Stripe.
router.patch('/set-plan', validarAdmin, setPlan);
router.patch('/update-active', validarAdmin, updateInvitationActive);
// Solo Admin → Eventos recarga créditos a mano; sin esto cualquiera podía
// fijar los créditos de cualquier invitación.
router.patch('/update-credits', validarAdmin, updateInvitationCredits);
router.patch('/update-data', accesoPorId, updateInvitationData);
router.patch('/update-fields', accesoPorId, updateInvitationFields);
router.patch('/add-owner', accesoPorId, AddNewOwner);
router.patch('/remove-owner', accesoPorId, RemoveOwnerByIndex);

// Sin llamadas desde el front (la vista previa usa create-from-preview) y crea
// una invitación PRO: solo Administración.
router.post('/save-preview', validarAdmin, async (req, res) => {
    const { userId, userEmail, data } = req.body;

    if (!userId || !data) {
        return res.status(400).json({ ok: false, msg: 'userId y data son requeridos' });
    }

    const eventDate = data?.cover?.date?.value || null;

    const { data: inv, error } = await supabase
        .from('invitations')
        .insert({
            user_id: userId,
            user_email: userEmail || '',
            active: false,
            type: 'closed',
            plan: 'pro',
            data,
            started: false,
            label: '',
            name: '',
            tickets: 300,
            tags: ['Amigos', 'Familia', 'Trabajo'],
            credits: 0,
            owners: [],
            event_date: eventDate,
        })
        .select('id')
        .single();

    if (error) return res.status(400).json({ ok: false, msg: error.message });
    return res.status(201).json({ ok: true, id: inv.id });
});

router.patch('/save-preview/:id', accesoPorParam, async (req, res) => {
    const { id } = req.params;
    const { data } = req.body;

    if (!data) return res.status(400).json({ ok: false, msg: 'data es requerida' });

    const { error } = await supabase
        .from('invitations')
        .update({ data, updated_at: new Date().toISOString() })
        .eq('id', id);

    if (error) return res.status(400).json({ ok: false, msg: error.message });
    return res.status(200).json({ ok: true });
});

router.post('/create-free', conSesion, soloParaSiMismo('userId'), soloPlanFree, async (req, res) => {
    const { userId, userEmail, name, phoneNumber, label, plan, owners } = req.body;

    if (!userId || !plan || !name) {
        return res.status(400).json({ ok: false, msg: 'userId, plan y name son requeridos' });
    }

    try {
        const id = await createInvitationWithPlan(userId, plan, {
            userEmail: userEmail || '',
            name,
            phoneNumber: phoneNumber || '',
            label: label || '',
            owners: owners ? JSON.stringify(owners) : '[]',
        });

        if (!id) return res.status(500).json({ ok: false, msg: 'No se pudo crear la invitación' });

        return res.status(201).json({ ok: true, msg: 'Invitación creada', id });
    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
});


module.exports = router;