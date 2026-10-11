const crypto = require('crypto');
const supabase = require('../config/supabase');
const { planEntitlements } = require('../config/plans');
const { sendMail } = require('../controllers/mailer');
const { vendorWelcomeEmailTemplate } = require('../controllers/templates/vendorWelcomeEmail');
const { isValidPhone } = require('./validatePhone');

// Alta de un evento para un cliente: misma lógica que /sales (crearVenta en
// controllers/ventas.js) pero sin la venta, para el alta de eventos de
// planners. ventas.js conserva su propia copia del flujo a propósito: no se
// tocó el alta de vendedores, que ya está en producción.

const TIPO_EVENTO_LABELS = {
    boda: 'wedding',
    xv: 'xv',
};

/**
 * Plantilla default de una invitación nueva — duplicada intencionalmente
 * de `createInvitationWithPlan` (controllers/supabase.js) en vez de
 * reutilizar esa función, para no tocar el código ya usado en vivo por el
 * webhook de Stripe y las rutas /create-free. La usan /sales (ventas.js) y el
 * alta de eventos de planners (controllers/planner.js).
 */
const buildDefaultInvitationData = (name, label) => ({
    cover: {
        date: { type: null, color: "#FFFFFF", value: "2026-05-20T00:00:00.000Z", active: true },
        image: { dev: null, blur: false, prod: "https://jblcqcxckefmydvtrxbi.supabase.co/storage/v1/object/public/user_images/14376896-4930-4429-b427-96e047695396/1769460961115-couple.jpeg", zoom: 1, position: { x: 0, y: 0 }, background: true },
        title: { text: { size: 54, color: "#ffffff", value: "Andrés & Julieta", weight: 1000, opacity: 0.95, typeFace: "WindSong" }, position: { align_x: "center", align_y: "flex-end", column_reverse: "column" } },
    },
    gifts: {
        cards: [
            { url: "https://www.amazon.com.mx/", bank: null, kind: "store", name: null, brand: "Palacio de hierro", number: null },
            { url: "https://www.amazon.com.mx/", bank: null, kind: "store", name: null, brand: "Sears", number: null },
            { url: null, bank: "BBVA", kind: "bank", name: "Luis Serrano", brand: null, number: "4242424242424242" },
        ],
        title: "MESA DE REGALOS", active: true, inverted: true, separator: false, background: false,
        description: "¡Tu presencia es el mejor regalo, pero tus buenos deseos se hacen aún más especiales con un toque personal!",
        dynamic_separator: { type: "single", image: { zoom: 1, value: null, width: 100, height: 300, position: { x: 0, y: 0 } }, active: false, single: { color: "#252525", value: 5 } },
        dynamic_background: { color: "#939faf", shape: "square", width: 90, active: false, shadow: true, texture: null, border_radius: 0 },
    },
    quote: {
        text: { font: { size: 18, color: "#ffffff", value: "Nuestro amor es el comienzo de un 'para siempre' que no tiene final.", weight: 500, opacity: 0.87, typeFace: "Noto Sans" }, align: "flex-start", width: 90, shadow: false, justify: "center" },
        image: { dev: null, prod: "https://firebasestorage.googleapis.com/v0/b/iattend-df79a.appspot.com/o/invitations%2F66a31dc63d724e3f40549b95%2Fquote%2FLyPl6vhxCk?alt=media&token=17b6cda0-8146-4100-8f19-2f86f306883a", active: true },
        active: true, inverted: false, separator: false, background: false,
        dynamic_separator: { type: "single", image: { zoom: 1, value: null, width: 100, height: 300, position: { x: 0, y: 0 } }, active: false, single: { color: "#252525", value: 5 } },
        dynamic_background: { color: "#939faf", shape: "square", width: 90, active: false, shadow: true, texture: null, border_radius: 0 },
    },
    people: {
        title: "Nuestros padres", active: true, inverted: true, separator: false, background: false,
        personas: [
            { title: "Padre del novio", description: "Manuel Velázquez " },
            { title: "Madre del novio", description: "María Lourdes " },
            { title: "Padre de la novia", description: "Edgar González " },
            { title: "Madre de la novia", description: "Ericka Gutiérrez " },
        ],
        dynamic_separator: { type: "single", image: { zoom: 1, value: null, width: 100, height: 300, position: { x: 0, y: 0 } }, active: false, single: { color: "#252525", value: 5 } },
        dynamic_background: { color: "#939faf", shape: "square", width: 90, active: true, shadow: true, texture: null, border_radius: 0 },
    },
    gallery: {
        dev: null,
        prod: [
            "https://firebasestorage.googleapis.com/v0/b/iattend-df79a.appspot.com/o/invitations%2F66a31dc63d724e3f40549b95%2Fgallery%2FeFLO43QYMc?alt=media&token=b7898198-6597-4d73-9f02-099a3bd29144",
            "https://firebasestorage.googleapis.com/v0/b/iattend-df79a.appspot.com/o/invitations%2F66a31dc63d724e3f40549b95%2Fgallery%2F1IFd1jvgfo?alt=media&token=71bf153e-7a96-43d3-afa0-f9698f3b7a88",
            "https://firebasestorage.googleapis.com/v0/b/iattend-df79a.appspot.com/o/invitations%2F66a31dc63d724e3f40549b95%2Fgallery%2FToBhZMReXW?alt=media&token=61079e78-25a0-4cf8-92de-1fb1e84ff945",
        ],
        title: "GALERÍA", active: true, inverted: false, separator: false, background: false,
        dynamic_separator: { type: "single", image: { zoom: 1, value: null, width: 100, height: 300, position: { x: 0, y: 0 } }, active: false, single: { color: "#252525", value: 5 } },
        dynamic_background: { color: "#939faf", shape: "square", width: 90, active: false, shadow: true, texture: null, border_radius: 0 },
    },
    notices: {
        title: "AVISOS", active: false, notices: [], inverted: false, separator: false, background: false,
        dynamic_separator: { type: "single", image: { zoom: 1, value: null, width: 100, height: 300, position: { x: 0, y: 0 } }, active: false, single: { color: "#252525", value: 5 } },
        dynamic_background: { color: "#939faf", shape: "square", width: 90, active: false, shadow: true, texture: null, border_radius: 0 },
    },
    generals: {
        event: { name: name || null, label: label || null },
        fonts: {
            body: { size: 0, color: "#000000", value: "Noto Sans", weight: 0, opacity: 1, typeFace: "Noto Sans" },
            titles: { size: 0, color: "#000000", value: "Noto Sans", weight: 0, opacity: 1, typeFace: "Noto Sans" },
        },
        colors: { accent: "#252525", actions: "#87bee9", primary: "#ffffff", secondary: "#939faf" },
        texture: 9, positions: [1, 2, 3, 4, 5, 6, 7, 8, 9], separator: 5,
    },
    greeting: {
        title: "¡Nos casamos!", active: true, inverted: false, separator: true, background: false,
        description: "Con mucha ilusión y amor, les invitamos a compartir con nosotros uno de los días más importantes de nuestras vidas.",
        dynamic_separator: { type: "single", image: { zoom: 1, value: null, width: 100, height: 300, position: { x: 0, y: 0 } }, active: false, single: { color: "#252525", value: 5 } },
        dynamic_background: { color: "#939faf", shape: "square", width: 90, active: false, shadow: true, texture: null, border_radius: 0 },
    },
    dresscode: {
        dev: null,
        prod: [
            "https://firebasestorage.googleapis.com/v0/b/iattend-df79a.appspot.com/o/invitations%2F66a31dc63d724e3f40549b95%2Fdresscode%2FeaEBaR4QgL?alt=media&token=eba80adb-0251-45b9-b225-3e96d965d49b",
            "https://firebasestorage.googleapis.com/v0/b/iattend-df79a.appspot.com/o/invitations%2F66a31dc63d724e3f40549b95%2Fdresscode%2FdSRYh8q9dX?alt=media&token=2ebda00a-25a8-4d35-aa78-59588fe8f5ff",
        ],
        links: [], title: "Dress code", active: true, colors: ["#e9e9e9", "#79abd1"], inverted: true, separator: false, background: false,
        description: "Sigue el código de vestimenta formal con tu propio toque. Encuentra opciones que se ajusten a tu estilo en nuestra galería de Pinterest.",
        links_active: false, images_active: true,
        dynamic_separator: { type: "single", image: { zoom: 1, value: null, width: 100, height: 300, position: { x: 0, y: 0 } }, active: false, single: { color: "#252525", value: 5 } },
        dynamic_background: { color: "#939faf", shape: "square", width: 90, active: true, shadow: true, texture: null, border_radius: 0 },
    },
    itinerary: {
        type: "cards", title: "ITINERARIO", active: true, inverted: true, separator: false, background: false,
        object: [
            { id: null, icon: 55, name: "Ceremonia", time: "5:00 pm", image: null, music: null, subtext: "San Antonio de Padua" },
            { id: null, icon: 16, name: "Recepción", time: "8:00 pm", image: null, music: null, subtext: "Los Aduanales" },
        ],
        dynamic_separator: { type: "single", image: { zoom: 1, value: null, width: 100, height: 300, position: { x: 0, y: 0 } }, active: false, single: { color: "#252525", value: 5 } },
        dynamic_background: { color: "#939faf", shape: "square", width: 90, active: false, shadow: true, texture: null, border_radius: 0 },
    },
    destinations: {
        cards: [
            { url: "sadcdacc", name: "Sheraton", type: "hotel", image: "https://firebasestorage.googleapis.com/v0/b/iattend-df79a.appspot.com/o/invitations%2F66a31dc63d724e3f40549b95%2Fdestinations%2FcRvWs5A1fe?alt=media&token=92798d5a-e561-46c4-9607-3029db188f5f", description: null },
            { url: "sodded", name: "Hotel One", type: "hotel", image: "https://firebasestorage.googleapis.com/v0/b/iattend-df79a.appspot.com/o/invitations%2F66a31dc63d724e3f40549b95%2Fdestinations%2FzrYoKKvOVx?alt=media&token=4dc56c12-b329-4c97-ab1a-0bdc4f8ef5b4", description: null },
        ],
        title: "DESTINOS", active: true, inverted: false, separator: false, background: false,
        description: "Sabemos que este viaje es especial y queremos que lo disfrutes al máximo. Aquí encontrarás una selección de lugares para hospedarte",
        dynamic_separator: { type: "single", image: { zoom: 1, value: null, width: 100, height: 300, position: { x: 0, y: 0 } }, active: false, single: { color: "#252525", value: 5 } },
        dynamic_background: { color: "#939faf", shape: "square", width: 90, active: false, shadow: true, texture: null, border_radius: 0 },
    },
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Valida el cliente (correo y nombre). `opcional`: el planner eligió
 * "enviar después" y todavía no hay cliente.
 * @returns {{ error: string } | { cliente: { correo, nombre } | null }}
 */
function validarCliente({ correo_cliente, nombre_cliente } = {}, { opcional = false } = {}) {
    if (opcional && !correo_cliente) return { cliente: null };
    if (!correo_cliente || !EMAIL_RE.test(String(correo_cliente).trim())) return { error: 'Correo del cliente inválido' };
    return {
        cliente: {
            correo: String(correo_cliente).trim().toLowerCase(),
            nombre: String(nombre_cliente || '').trim(),
        },
    };
}

/**
 * Valida y normaliza el formulario del evento. Con `enviar_despues` el evento
 * se crea sin cliente (`correo` null): el planner se lo manda más tarde.
 * @returns {{ error: string } | { datos: object }}
 */
function validarEvento(body = {}) {
    const { tipo_evento, url_evento, telefono, owners, fecha_evento, enviar_despues } = body;
    const label = TIPO_EVENTO_LABELS[tipo_evento];

    if (!label) return { error: 'Tipo de evento no soportado' };
    if (!url_evento || typeof url_evento !== 'string' || !/^[a-z0-9&-]+$/.test(url_evento)) {
        return { error: 'La URL del evento no es válida' };
    }
    if (!isValidPhone(telefono)) return { error: 'Teléfono inválido, formato esperado +[lada][número]' };
    const ownerNames = tipo_evento === 'boda'
        ? (Array.isArray(owners) ? owners.map(o => String(o || '').trim()).filter(Boolean) : [])
        : [];
    if (tipo_evento === 'boda' && ownerNames.length < 2) return { error: 'Faltan los nombres de los novios' };
    if (!fecha_evento) return { error: 'Falta la fecha del evento' };

    const { error, cliente } = validarCliente(enviar_despues ? {} : body, { opcional: Boolean(enviar_despues) });
    if (error) return { error };

    return {
        datos: {
            tipo_evento,
            label,
            url_evento,
            telefono,
            ownerNames,
            fecha_evento,
            correo: cliente?.correo ?? null,
            nombre: cliente?.nombre ?? '',
        },
    };
}

/** ¿La URL ya la usa otra invitación? (`name` es el slug público). */
async function urlOcupada(url_evento) {
    const { data, error } = await supabase.from('invitations').select('id').eq('name', url_evento).maybeSingle();
    if (error) throw new Error(error.message);
    return Boolean(data);
}

/**
 * Cuenta del cliente: la reutiliza si su correo ya tiene perfil o la crea con
 * una contraseña al azar. `borrarCuenta()` deshace solo una cuenta creada aquí.
 * @returns {{ userId, password, cuentaNueva, borrarCuenta }}
 */
// Busca una cuenta de auth.users por correo (la API admin no filtra por
// correo: se pagina).
async function usuarioAuthPorCorreo(correo) {
    const buscado = String(correo).toLowerCase();
    for (let page = 1; page <= 50; page += 1) {
        const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) throw new Error(error.message);
        const usuario = data?.users?.find(u => String(u.email).toLowerCase() === buscado);
        if (usuario) return usuario;
        if (!data?.users || data.users.length < 1000) return null;
    }
    return null;
}

async function resolverCliente({ correo, nombre, ownerNames = [] }) {
    const { data: perfil, error: perfilError } = await supabase
        .from('profiles').select('user_id').eq('user_email', correo).maybeSingle();
    if (perfilError) throw new Error(perfilError.message);

    if (perfil?.user_id) {
        return { userId: perfil.user_id, password: null, cuentaNueva: false, borrarCuenta: async () => {} };
    }

    const password = crypto.randomBytes(9).toString('base64url');
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email: correo, password, email_confirm: true,
    });
    if (authError && (authError.code === 'email_exists' || /already (been )?registered/i.test(authError.message))) {
        // Cuenta en auth.users sin fila en profiles: se usa esa cuenta (y se le
        // crea su perfil) en vez de fallar — en el webhook dejaría un evento
        // ya pagado sin crear.
        const existente = await usuarioAuthPorCorreo(correo);
        if (existente) {
            await supabase.from('profiles').upsert(
                { user_id: existente.id, user_email: correo, full_name: nombre || ownerNames.join(' & ') || null },
                { onConflict: 'user_id' }
            );
            return { userId: existente.id, password: null, cuentaNueva: false, borrarCuenta: async () => {} };
        }
    }
    if (authError || !authData?.user) throw new Error(authError?.message || 'No se pudo crear la cuenta del cliente');
    const userId = authData.user.id;

    // El trigger de auth.users crea el perfil con el prefijo del correo.
    const nombrePerfil = nombre || ownerNames.join(' & ');
    if (nombrePerfil) {
        await supabase.from('profiles').update({ full_name: nombrePerfil }).eq('user_id', userId);
    }

    return {
        userId,
        password,
        cuentaNueva: true,
        borrarCuenta: async () => {
            await supabase.from('profiles').delete().eq('user_id', userId);
            await supabase.auth.admin.deleteUser(userId);
        },
    };
}

/** Correo de bienvenida con usuario y contraseña. Best-effort: nunca lanza. */
async function enviarBienvenida(correo, password) {
    try {
        await sendMail(correo, 'Tu cuenta de I attend está lista 🎉', vendorWelcomeEmailTemplate({
            email: correo, password, loginUrl: 'https://www.iattend.site/login',
        }));
    } catch (mailError) {
        console.error('Error enviando correo de bienvenida:', mailError.message);
    }
}

/**
 * Crea la invitación con los beneficios del plan y, si viene el correo del
 * cliente, su cuenta (o reutiliza la existente) y le manda su usuario y
 * contraseña si la cuenta es nueva. Sin correo ("enviar después") la
 * invitación queda sin dueño, solo con el planner. Con `plannerId`, el planner
 * queda asignado.
 *
 * Si la invitación no se puede crear, borra la cuenta que acaba de crear (una
 * cuenta que ya existía nunca se toca).
 * Devuelve `{ invitationId, userId, clienteExistente, urlPublica }`.
 */
async function crearEventoDeCliente(datos, { plan, plannerId = null }) {
    const { label, url_evento, telefono, ownerNames, fecha_evento, correo, nombre } = datos;
    const planLower = String(plan).toLowerCase();
    const entitlements = await planEntitlements(planLower);

    if (await urlOcupada(url_evento)) throw Object.assign(new Error('La URL del evento ya está en uso'), { status: 409 });

    const cliente = correo ? await resolverCliente({ correo, nombre, ownerNames }) : null;

    const { data: invitation, error: invitationError } = await supabase
        .from('invitations')
        .insert({
            user_id: cliente?.userId ?? null,
            user_email: correo,
            planner_id: plannerId,
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
        await cliente?.borrarCuenta();
        throw new Error(invitationError?.message || 'No se pudo crear la invitación');
    }

    if (cliente?.cuentaNueva) await enviarBienvenida(correo, cliente.password);

    return {
        invitationId: invitation.id,
        userId: cliente?.userId ?? null,
        clienteExistente: cliente ? !cliente.cuentaNueva : false,
        sinCliente: !cliente,
        urlPublica: `https://iattend.events/${label}/${url_evento}`,
    };
}

module.exports = {
    TIPO_EVENTO_LABELS,
    buildDefaultInvitationData,
    validarCliente,
    validarEvento,
    urlOcupada,
    resolverCliente,
    enviarBienvenida,
    crearEventoDeCliente,
};
