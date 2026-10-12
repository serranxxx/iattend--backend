const { response } = require('express');
const supabase = require('../config/supabase');
const crypto = require('crypto');
const { tieneFuncionesDePlanner } = require('../helpers/roles');
const { clonarPlantillaNuevoPlanner } = require('../helpers/plannerTemplate');
const { sendMail } = require('./mailer');
const { plannerWelcomeEmailTemplate } = require('./templates/plannerWelcomeEmail');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Edición de usuarios desde Admin → Usuarios. Solo nombre y rol: el correo es
// el login (auth.users) y no se cambia desde aquí.

// Los mismos que acepta createUser en controllers/auth.js. null = cliente.
const ROLES_ASIGNABLES = ['Administration', 'sales', 'planner', 'mkt', 'test'];

const editarUsuario = async (req, res = response) => {
    const { user_id } = req.params;
    const { full_name, role } = req.body || {};
    const cambios = {};

    if (full_name !== undefined) {
        if (typeof full_name !== 'string' || !full_name.trim()) {
            return res.status(400).json({ ok: false, msg: 'El nombre es requerido' });
        }
        cambios.full_name = full_name.trim();
    }

    if (role !== undefined) {
        const valor = role || null;
        if (valor !== null && !ROLES_ASIGNABLES.includes(valor)) {
            return res.status(400).json({ ok: false, msg: `Rol no válido: ${valor}` });
        }
        // Quitarse Administración a uno mismo lo dejaría fuera del admin.
        if (user_id === req.adminUserId && valor !== 'Administration') {
            return res.status(400).json({ ok: false, msg: 'No puedes quitarte el rol de Administración a ti mismo' });
        }
        cambios.role = valor;
    }

    if (!Object.keys(cambios).length) {
        return res.status(400).json({ ok: false, msg: 'No hay cambios' });
    }

    try {
        const { data: perfil, error } = await supabase
            .from('profiles')
            .update(cambios)
            .eq('user_id', user_id)
            .select('*')
            .maybeSingle();

        if (error) return res.status(500).json({ ok: false, msg: error.message });
        if (!perfil) return res.status(404).json({ ok: false, msg: 'Usuario no encontrado' });

        // El nombre también vive en los metadatos de la cuenta (se usa al
        // crearla); se mantiene igual para que no se desincronicen.
        if (cambios.full_name) {
            const { error: authError } = await supabase.auth.admin.updateUserById(user_id, {
                user_metadata: { full_name: cambios.full_name },
            });
            if (authError) console.error('No se pudo actualizar full_name en auth:', authError.message);
        }

        return res.status(200).json({ ok: true, perfil });
    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
};

// Cómo entra cada cuenta (Google, Apple o correo y contraseña). Vive en
// auth.users, que el frontend no puede leer con la anon key.
// GET /api/admin/usuarios/proveedores → { proveedores: { [user_id]: ['google'] } }
const POR_PAGINA = 1000;

const listarProveedores = async (req, res = response) => {
    try {
        const proveedores = {};
        for (let page = 1; ; page++) {
            const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: POR_PAGINA });
            if (error) return res.status(500).json({ ok: false, msg: error.message });

            (data?.users ?? []).forEach(u => {
                const lista = u.app_metadata?.providers ?? (u.app_metadata?.provider ? [u.app_metadata.provider] : []);
                proveedores[u.id] = lista;
            });

            if ((data?.users ?? []).length < POR_PAGINA) break;
        }
        return res.status(200).json({ ok: true, proveedores });
    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
};

// Beneficios de planners (tabla planner_benefits): eventos gratis y % de
// descuento en toda compra suya. Ver controllers/planner.js.
// GET /api/admin/planners/beneficios → { beneficios: { [user_id]: {...} }, usados: { [user_id]: n } }
const beneficiosPlanners = async (req, res = response) => {
    try {
        const [{ data: filas, error }, { data: eventos, error: eventosError }] = await Promise.all([
            supabase.from('planner_benefits').select('planner_id, free_events, free_flash_events, discount_pct, updated_at'),
            supabase.from('planner_events').select('planner_id, tipo, kind').eq('estado', 'completado'),
        ]);
        if (error || eventosError) return res.status(500).json({ ok: false, msg: (error || eventosError).message });

        const beneficios = Object.fromEntries((filas || []).map(f => [f.planner_id, f]));
        const usados = {};
        // gratis/compra: eventos regulares; flash: todos sus Flash; flash_gratis:
        // los Flash que salieron de sus beneficios (Admin → Usuarios › Planners).
        (eventos || []).forEach(e => {
            usados[e.planner_id] ??= { gratis: 0, compra: 0, flash: 0, flash_gratis: 0 };
            if (e.kind === 'flash') {
                usados[e.planner_id].flash += 1;
                if (e.tipo === 'gratis') usados[e.planner_id].flash_gratis += 1;
            } else usados[e.planner_id][e.tipo] += 1;
        });
        return res.json({ ok: true, beneficios, usados });
    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message });
    }
};

// PUT /api/admin/planners/:user_id/beneficios  { free_events, free_flash_events, discount_pct }
const editarBeneficiosPlanner = async (req, res = response) => {
    const { user_id } = req.params;
    const freeEvents = Number(req.body?.free_events);
    const freeFlashEvents = Number(req.body?.free_flash_events ?? 0);
    const discountPct = Number(req.body?.discount_pct);

    if (!Number.isInteger(freeEvents) || freeEvents < 0 || freeEvents > 100) {
        return res.status(400).json({ ok: false, msg: 'Eventos gratis debe ser un entero entre 0 y 100' });
    }
    if (!Number.isInteger(freeFlashEvents) || freeFlashEvents < 0 || freeFlashEvents > 100) {
        return res.status(400).json({ ok: false, msg: 'Eventos Flash gratis debe ser un entero entre 0 y 100' });
    }
    if (!Number.isInteger(discountPct) || discountPct < 0 || discountPct > 90) {
        return res.status(400).json({ ok: false, msg: 'El descuento debe ser un entero entre 0 y 90' });
    }

    try {
        const { data: perfil } = await supabase.from('profiles').select('role').eq('user_id', user_id).maybeSingle();
        if (!tieneFuncionesDePlanner(perfil?.role)) return res.status(400).json({ ok: false, msg: 'Solo se asignan beneficios a cuentas de planner o Administración' });

        const { data, error } = await supabase
            .from('planner_benefits')
            .upsert({
                planner_id: user_id,
                free_events: freeEvents,
                free_flash_events: freeFlashEvents,
                discount_pct: discountPct,
                updated_at: new Date().toISOString(),
                updated_by: req.adminUserId,
            }, { onConflict: 'planner_id' })
            .select('planner_id, free_events, free_flash_events, discount_pct, updated_at')
            .single();
        if (error) return res.status(500).json({ ok: false, msg: error.message });

        return res.json({ ok: true, beneficios: data });
    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message });
    }
};

/**
 * POST /api/admin/planners  { nombre, correo, genero: 'F' | 'M', enviar_correo }
 * Alta de un wedding planner desde Admin → Usuarios:
 *   1. Cuenta (Auth) con contraseña al azar y perfil con role 'planner'.
 *   2. Beneficios: 1 evento regular gratis y 1 Evento Flash gratis.
 *   3. Su invitación de ejemplo, copia de la plantilla (helpers/plannerTemplate.js).
 *   4. Con `enviar_correo`, el correo de bienvenida de planner con su acceso
 *      (templates/plannerWelcomeEmail.js). Si no, la contraseña regresa en la
 *      respuesta para que Admin se la comparta.
 * Los pasos 3 y 4 son best-effort: si fallan la cuenta queda creada y se avisa.
 */
const crearPlanner = async (req, res = response) => {
    const nombre = String(req.body?.nombre || '').trim();
    const correo = String(req.body?.correo || '').trim().toLowerCase();
    const genero = req.body?.genero === 'M' ? 'M' : 'F';
    const enviarCorreo = req.body?.enviar_correo !== false;

    if (!nombre) return res.status(400).json({ ok: false, msg: 'El nombre es requerido' });
    if (!EMAIL_RE.test(correo)) return res.status(400).json({ ok: false, msg: 'Correo inválido' });

    try {
        const { data: existente } = await supabase
            .from('profiles').select('user_id').ilike('user_email', correo).limit(1).maybeSingle();
        if (existente) return res.status(409).json({ ok: false, msg: 'Ya existe una cuenta con este correo' });

        const password = crypto.randomBytes(9).toString('base64url');
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
            email: correo, password, email_confirm: true, user_metadata: { full_name: nombre },
        });
        if (authError || !authData?.user) {
            return res.status(400).json({ ok: false, msg: authError?.message || 'No se pudo crear la cuenta' });
        }
        const userId = authData.user.id;

        const perfil = { user_id: userId, full_name: nombre, user_email: correo, role: 'planner' };
        const { error: perfilError } = await supabase.from('profiles').upsert(perfil, { onConflict: 'user_id' });
        if (perfilError) {
            await supabase.auth.admin.deleteUser(userId);
            return res.status(500).json({ ok: false, msg: perfilError.message });
        }
        // El trigger de auth.users resincroniza profiles un momento después y
        // pisa el rol (ver adminVentas.js): se reafirma pasados unos segundos.
        setTimeout(() => {
            supabase.from('profiles').upsert(perfil, { onConflict: 'user_id' })
                .then(({ error }) => { if (error) console.error('Error reafirmando perfil de planner:', error.message); });
        }, 3000);

        const { error: beneficiosError } = await supabase.from('planner_benefits').upsert({
            planner_id: userId,
            free_events: 1,
            free_flash_events: 1,
            discount_pct: 0,
            updated_at: new Date().toISOString(),
            updated_by: req.adminUserId,
        }, { onConflict: 'planner_id' });
        if (beneficiosError) console.error('No se pudieron asignar los beneficios del planner:', beneficiosError.message);

        let plantilla = null;
        try {
            plantilla = { ok: true, invitationId: await clonarPlantillaNuevoPlanner({ plannerId: userId, plannerEmail: correo, plannerName: nombre }) };
        } catch (error) {
            console.error('Error copiando la plantilla de planner:', error.message);
            plantilla = { ok: false, msg: error.message };
        }

        let correoEnviado = false;
        if (enviarCorreo) {
            try {
                const bienvenida = genero === 'M' ? 'Bienvenido' : 'Bienvenida';
                await sendMail(correo, `${bienvenida} a I attend`, plannerWelcomeEmailTemplate({
                    nombre: nombre.split(' ')[0], genero, email: correo, password, loginUrl: 'https://www.iattend.site/login',
                }));
                correoEnviado = true;
            } catch (error) {
                console.error('No se pudo mandar el correo de bienvenida del planner:', error.message);
            }
        }

        return res.status(201).json({
            ok: true,
            user_id: userId,
            correo_enviado: correoEnviado,
            // Si no le llegó el correo, Admin necesita la contraseña para dársela.
            password: correoEnviado ? undefined : password,
            beneficios: !beneficiosError,
            plantilla,
        });
    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message });
    }
};

module.exports = { editarUsuario, listarProveedores, beneficiosPlanners, editarBeneficiosPlanner, crearPlanner };
