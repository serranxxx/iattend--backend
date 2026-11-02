const Stripe = require('stripe');
const supabase = require('../config/supabase');
const { validarCliente, resolverCliente, enviarBienvenida } = require('./clientEvent');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Pops: un side event sin invitación (invitation_id vacío) que crea o
// compra un wedding planner. Puede quedar para él, mandárselo a un cliente o
// quedar "para enviar después" (user_id vacío). Migración
// 2026-10-10d_eventos_flash.sql. La página del invitado es la misma de los side
// events (iattend.events/side-event/:id).

const POP_LOOKUP_KEY = 'flash_event';
const POP_CREDITS = 30;
const DESTINOS = ['mio', 'ahora', 'despues'];

// Precio del producto "Pop" en Stripe, por su lookup key (cambiarlo
// en Stripe no pide tocar código). Cache de 5 minutos.
let cachePrecio = null;
async function precioPop() {
    if (cachePrecio && Date.now() - cachePrecio.at < 5 * 60 * 1000) return cachePrecio.precio;
    const { data } = await stripe.prices.list({ lookup_keys: [POP_LOOKUP_KEY], active: true, limit: 1 });
    const price = data?.[0];
    if (!price) throw new Error('No hay precio activo de Pop en Stripe');
    const precio = { priceId: price.id, amount: price.unit_amount / 100, currency: price.currency };
    cachePrecio = { at: Date.now(), precio };
    return precio;
}

/**
 * Valida el formulario: nombre, fecha (YYYY-MM-DD), hora opcional (HH:mm) y
 * destino ('mio' | 'ahora' | 'despues'; con 'ahora' pide el cliente).
 * @returns {{ error } | { datos }}
 */
function validarPop(body = {}) {
    const nombre = String(body.nombre || '').trim();
    const fecha = String(body.fecha || '');
    const hora = body.hora ? String(body.hora) : null;
    const destino = DESTINOS.includes(body.destino) ? body.destino : null;

    if (!nombre) return { error: 'Falta el nombre del evento' };
    if (nombre.length > 120) return { error: 'El nombre es demasiado largo' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { error: 'Falta la fecha del evento' };
    if (hora && !/^\d{2}:\d{2}$/.test(hora)) return { error: 'La hora no es válida' };
    if (!destino) return { error: 'Elige para quién es el evento' };

    let cliente = null;
    if (destino === 'ahora') {
        const r = validarCliente(body);
        if (r.error) return { error: r.error };
        cliente = r.cliente;
    }

    return { datos: { nombre, fecha, hora, destino, correo: cliente?.correo ?? null, nombreCliente: cliente?.nombre ?? '' } };
}

/**
 * Crea el Pop con los mismos valores por defecto que un side event
 * nuevo del editor (SideEvents.jsx → insertSideEvent) y 30 créditos propios.
 * La hora va como string "wall-clock" (ver helpers/assets/eventDateTime.js
 * en iattend-vite): nunca se convierte de zona horaria.
 * `sinPlanner`: lo crea un cliente con un Pop gratis (planner_id vacío).
 * @returns {{ sideEventId, clienteExistente, sinCliente, urlPublica }}
 */
async function crearPopEvent(datos, { plannerId, plannerEmail, sinPlanner = false }) {
    const { nombre, fecha, hora, destino, correo, nombreCliente } = datos;

    let dueno = { userId: null, correo: null };
    let cliente = null;
    if (destino === 'mio') dueno = { userId: plannerId, correo: plannerEmail || null };
    if (destino === 'ahora') {
        cliente = await resolverCliente({ correo, nombre: nombreCliente });
        dueno = { userId: cliente.userId, correo };
    }

    const { data: pop, error } = await supabase
        .from('side_events')
        .insert({
            invitation_id: null,
            // Pop gratis de un cliente: es suyo y no tiene planner.
            planner_id: sinPlanner ? null : plannerId,
            user_id: dueno.userId,
            user_email: dueno.correo,
            credits: POP_CREDITS,
            credits_included: POP_CREDITS,
            date: new Date().toISOString(),
            name: nombre,
            url_image: null,
            type: 'closed',
            body: {
                address: { street: null, number: null, neighborhood: null, zipcode: null, country: null, state: null, city: null, url: null },
                hour: `${fecha} ${hora || '00:00'}:00`,
                timezone: null,
                place_name: null,
                image: null,
                title: { font: 'Poppins', size: 36, weight: 600, opacity: 1, line_height: 1.4 },
                font: 'Poppins',
                color: '#000000',
                extras: null,
                hideWeather: false,
            },
        })
        // '*': también public_code (el link del Pop) sin romper si la
        // migración 2026-11-01b todavía no corre.
        .select('*')
        .single();

    if (error || !pop) {
        await cliente?.borrarCuenta();
        throw new Error(error?.message || 'No se pudo crear el Pop');
    }

    if (cliente?.cuentaNueva) await enviarBienvenida(correo, cliente.password);

    return {
        sideEventId: pop.id,
        clienteExistente: cliente ? !cliente.cuentaNueva : false,
        sinCliente: destino === 'despues',
        // El código al azar, no el número (que se puede adivinar).
        urlPublica: `https://iattend.events/side-event/${pop.public_code || pop.id}`,
    };
}

/**
 * Suma (o resta, con monto negativo) créditos a un Pop de un solo
 * golpe con el RPC increment_side_event_credits (migración
 * 2026-10-10g_planner_events_procesando.sql). Si el RPC todavía no existe,
 * cae a leer y escribir.
 * @returns {Promise<number|null>} créditos resultantes (null si no es un Pop)
 */
async function sumarCreditosPop(sideEventId, amount) {
    const { data, error } = await supabase.rpc('increment_side_event_credits', {
        p_side_event_id: Number(sideEventId),
        p_amount: amount,
    });
    if (!error) return Array.isArray(data) ? (data[0] ?? null) : data;
    if (error.code !== 'PGRST202') throw new Error(error.message);

    const { data: pop, error: readError } = await supabase
        .from('side_events').select('credits, invitation_id').eq('id', sideEventId).maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!pop || pop.invitation_id) return null;
    const credits = Math.max((pop.credits ?? 0) + amount, 0);
    const { error: updateError } = await supabase.from('side_events').update({ credits }).eq('id', sideEventId);
    if (updateError) throw new Error(updateError.message);
    return credits;
}

module.exports = { POP_CREDITS, precioPop, validarPop, crearPopEvent, sumarCreditosPop };
