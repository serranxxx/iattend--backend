const { response } = require('express');
const crypto = require('crypto');
const supabase = require('../config/supabase');
const { planEntitlements } = require('../config/plans');
const { sendMail } = require('./mailer');
const { vendorWelcomeEmailTemplate } = require('./templates/vendorWelcomeEmail');
const { isValidPhone } = require('../helpers/validatePhone');
const { buildDefaultInvitationData } = require('../helpers/clientEvent');

const TIPO_EVENTO_LABELS = {
    boda: 'wedding',
    xv: 'xv',
};

const PLANES_VALIDOS = ['PRO', 'Lite'];

const checkCliente = async (req, res = response) => {
    const { correo } = req.query;

    if (!correo || typeof correo !== 'string') {
        return res.status(400).json({ ok: false, msg: 'correo es requerido' });
    }

    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('full_name')
            .eq('user_email', correo.toLowerCase().trim())
            .maybeSingle();

        if (error) {
            return res.status(500).json({ ok: false, msg: error.message });
        }

        return res.status(200).json({ existe: !!data, nombre: data?.full_name || null });

    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
}

const buscarClientes = async (req, res = response) => {
    const { q } = req.query;

    if (!q || String(q).trim().length < 2) {
        return res.status(200).json({ clientes: [] });
    }

    const term = `%${String(q).trim()}%`;

    try {
        const [{ data: byName, error: e1 }, { data: byEmail, error: e2 }] = await Promise.all([
            supabase.from('profiles').select('user_id, full_name, user_email').ilike('full_name', term).limit(15),
            supabase.from('profiles').select('user_id, full_name, user_email').ilike('user_email', term).limit(15),
        ]);

        if (e1) return res.status(500).json({ ok: false, msg: e1.message });
        if (e2) return res.status(500).json({ ok: false, msg: e2.message });

        const byId = new Map();
        [...(byName || []), ...(byEmail || [])].forEach(p => byId.set(p.user_id, p));

        const clientes = [...byId.values()]
            .slice(0, 15)
            .map(p => ({ user_id: p.user_id, nombre: p.full_name, correo: p.user_email }));

        return res.status(200).json({ clientes });

    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
}

const checkUrl = async (req, res = response) => {
    const { url } = req.query;

    if (!url) {
        return res.status(400).json({ ok: false, msg: 'url es requerido' });
    }

    try {
        const { data, error } = await supabase
            .from('invitations')
            .select('id')
            .eq('name', url)
            .maybeSingle();

        if (error) {
            return res.status(500).json({ ok: false, msg: error.message });
        }

        return res.status(200).json({ url, disponible: !data });

    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
}

const crearVenta = async (req, res = response) => {
    const vendedorId = req.vendedorId;
    const {
        tipo_evento,
        url_evento,
        telefono,
        owners,
        fecha_evento,
        plan,
        precio_acordado,
        descuento_pct = 0,
        correo_cliente,
        nombre_cliente,
        cliente_id,
    } = req.body;

    const label = TIPO_EVENTO_LABELS[tipo_evento];

    if (!label) {
        return res.status(400).json({ ok: false, msg: 'tipo_evento no soportado' });
    }

    if (!url_evento || typeof url_evento !== 'string') {
        return res.status(400).json({ ok: false, msg: 'url_evento es requerido' });
    }

    if (!isValidPhone(telefono)) {
        return res.status(400).json({ ok: false, msg: 'telefono inválido, formato esperado +[lada][número]' });
    }

    if (tipo_evento === 'boda' && (!Array.isArray(owners) || owners.length < 2)) {
        return res.status(400).json({ ok: false, msg: 'owners es requerido para bodas' });
    }

    if (!fecha_evento) {
        return res.status(400).json({ ok: false, msg: 'fecha_evento es requerida' });
    }

    if (!PLANES_VALIDOS.includes(plan)) {
        return res.status(400).json({ ok: false, msg: 'plan inválido' });
    }

    if (typeof precio_acordado !== 'number' || precio_acordado <= 0) {
        return res.status(400).json({ ok: false, msg: 'precio_acordado inválido' });
    }

    if (!cliente_id && (!correo_cliente || typeof correo_cliente !== 'string')) {
        return res.status(400).json({ ok: false, msg: 'correo_cliente es requerido' });
    }

    const descuento = Number(descuento_pct) || 0;
    const ownerNames = tipo_evento === 'boda' ? owners : [];

    try {
        // 0. Lo que incluye el plan, antes de crear nada: si el catálogo no
        // responde, mejor fallar aquí que después de dar de alta al cliente.
        const planLower = plan.toLowerCase();
        const entitlements = await planEntitlements(planLower);

        // 1. Validar el vendedor y su tope de descuento
        const { data: vendedor, error: vendedorError } = await supabase
            .from('vendedores')
            .select('descuento_max_pct')
            .eq('id', vendedorId)
            .maybeSingle();

        if (vendedorError || !vendedor) {
            return res.status(401).json({ ok: false, msg: 'Vendedor no encontrado' });
        }

        if (descuento > 0 && descuento > Number(vendedor.descuento_max_pct)) {
            return res.status(400).json({ ok: false, msg: 'descuento_pct excede el máximo permitido para este vendedor' });
        }

        // 2. Última línea de defensa contra slug duplicado
        const { data: existing, error: existingError } = await supabase
            .from('invitations')
            .select('id')
            .eq('name', url_evento)
            .maybeSingle();

        if (existingError) {
            return res.status(500).json({ ok: false, msg: existingError.message });
        }

        if (existing) {
            return res.status(409).json({ ok: false, msg: 'La URL del evento ya está en uso' });
        }

        // 3. Resolver el cliente: (a) el vendedor lo eligió explícitamente de la
        // lista de clientes existentes, (b) su correo ya tiene cuenta (compra más
        // de una vez), o (c) es un cliente nuevo. En (a)/(b) se reutiliza la cuenta
        // existente en vez de intentar crear una nueva.
        let userId;
        let email;
        let password = null;
        let isNewUser = false;

        if (cliente_id) {
            const { data: profile, error: profileError } = await supabase
                .from('profiles')
                .select('user_id, user_email')
                .eq('user_id', cliente_id)
                .maybeSingle();

            if (profileError) {
                return res.status(500).json({ ok: false, msg: profileError.message });
            }

            if (!profile) {
                return res.status(404).json({ ok: false, msg: 'Cliente no encontrado' });
            }

            userId = profile.user_id;
            email = profile.user_email;

        } else {
            email = correo_cliente.toLowerCase();

            const { data: existingProfile, error: profileLookupError } = await supabase
                .from('profiles')
                .select('user_id')
                .eq('user_email', email)
                .maybeSingle();

            if (profileLookupError) {
                return res.status(500).json({ ok: false, msg: profileLookupError.message });
            }

            isNewUser = !existingProfile;

            if (existingProfile) {
                userId = existingProfile.user_id;
            } else {
                password = crypto.randomBytes(9).toString('base64url');

                const { data: authData, error: authError } = await supabase.auth.admin.createUser({
                    email,
                    password,
                    email_confirm: true,
                });

                if (authError || !authData?.user) {
                    return res.status(400).json({ ok: false, msg: authError?.message || 'No se pudo crear el usuario' });
                }

                userId = authData.user.id;

                // Supabase ya crea el registro en profiles automáticamente vía trigger al
                // insertar en auth.users — aquí solo corregimos full_name con el nombre
                // real del cliente (el trigger lo llena con el prefijo del correo).
                const nombreParaPerfil = (nombre_cliente && nombre_cliente.trim()) || ownerNames.join(' & ');
                if (nombreParaPerfil) {
                    const { error: profileUpdateError } = await supabase
                        .from('profiles')
                        .update({ full_name: nombreParaPerfil })
                        .eq('user_id', userId);

                    if (profileUpdateError) {
                        await supabase.from('profiles').delete().eq('user_id', userId);
                        await supabase.auth.admin.deleteUser(userId);
                        return res.status(500).json({ ok: false, msg: profileUpdateError.message });
                    }
                }
            }
        }

        // 5. Crear invitación — si falla, rollback de profiles + usuario (solo si
        // los creamos en este request; si el cliente ya existía, su cuenta nunca se toca)
        const { data: invitation, error: invitationError } = await supabase
            .from('invitations')
            .insert({
                user_id: userId,
                user_email: email,
                plan: planLower,
                label,
                name: url_evento,
                phone_number: telefono,
                event_date: fecha_evento,
                type: 'closed',
                active: true,
                ...entitlements,
                tickets: 300,
                owners: ownerNames,
                url_image: null,
                data: buildDefaultInvitationData(url_evento, label),
            })
            .select('id')
            .single();

        if (invitationError || !invitation) {
            if (isNewUser) {
                await supabase.from('profiles').delete().eq('user_id', userId);
                await supabase.auth.admin.deleteUser(userId);
            }
            return res.status(500).json({ ok: false, msg: invitationError?.message || 'No se pudo crear la invitación' });
        }

        // 6. Crear venta — si falla, rollback de invitación + profiles + usuario
        const { data: venta, error: ventaError } = await supabase
            .from('ventas')
            .insert({
                invitation_id: invitation.id,
                vendedor_id: vendedorId,
                plan,
                precio_acordado,
                descuento_pct: descuento,
            })
            .select('id')
            .single();

        if (ventaError || !venta) {
            await supabase.from('invitations').delete().eq('id', invitation.id);
            if (isNewUser) {
                await supabase.from('profiles').delete().eq('user_id', userId);
                await supabase.auth.admin.deleteUser(userId);
            }
            return res.status(500).json({ ok: false, msg: ventaError?.message || 'No se pudo crear la venta' });
        }

        // 7. Correo de bienvenida — solo para cuentas nuevas (un cliente existente ya
        // tiene sus credenciales). Best-effort, no forma parte del rollback.
        if (isNewUser) {
            try {
                const nombreEvento = ownerNames.length ? ownerNames.join(' & ') : url_evento;
                const html = vendorWelcomeEmailTemplate({
                    nombreEvento,
                    email,
                    password,
                    loginUrl: 'https://www.iattend.site/login',
                });
                await sendMail(email, 'Tu cuenta de I attend está lista 🎉', html);
            } catch (mailError) {
                console.error('Error enviando correo de bienvenida:', mailError.message);
            }
        }

        return res.status(200).json({
            invitation_id: invitation.id,
            venta_id: venta.id,
            url_publica: `https://iattend.events/${label}/${url_evento}`,
            cliente_existente: !isNewUser,
        });

    } catch (error) {
        return res.status(500).json({ ok: false, msg: error.message || 'Internal Server Error' });
    }
}

module.exports = {
    checkUrl,
    checkCliente,
    buscarClientes,
    crearVenta,
}
