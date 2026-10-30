const crypto = require('crypto');
const supabase = require('../config/supabase');
const { generateWalletPass } = require('../services/wallet/walletService');
const { datosPaseInvitacion, datosPaseSide, datosPorSerie } = require('../services/wallet/datosPase');
const { avisarPases, tocarPases } = require('../services/wallet/avisos');

/*
  Pases de Apple Wallet que se actualizan (ver services/wallet/datosPase.js).

  Descarga (la piden iattend-events /api/wallet/pass y /api/wallet/side-pass):
    GET /api/wallet/pase/invitacion/:invitationId/:guestId
    GET /api/wallet/pase/side/:eventId/:guestId

  Servicio web de PassKit (lo llama Wallet en el iPhone, con
  "Authorization: ApplePass <token>"; la base es WALLET_WEB_SERVICE_URL):
    POST   /v1/devices/:device/registrations/:passType/:serial   registrar
    GET    /v1/devices/:device/registrations/:passType           qué cambió
    DELETE /v1/devices/:device/registrations/:passType/:serial   dar de baja
    GET    /v1/passes/:passType/:serial                          pase nuevo
    POST   /v1/log                                               errores

  Bienvenida (la manda el lector de pases de iattend-vite al marcar la
  llegada): POST /api/wallet/bienvenida { kind, eventoId, guestIds }.
*/

const enviarPase = (res, buffer, extra = {}) => {
    res.set({
        'Content-Type': 'application/vnd.apple.pkpass',
        'Content-Disposition': 'attachment; filename="i-attend-pass.pkpass"',
        'Content-Length': buffer.length,
        'Cache-Control': 'no-store',
        ...extra,
    });
    res.send(buffer);
};

const generar = async (res, resultado) => {
    if (!resultado) return res.status(404).json({ ok: false, msg: 'Evento o invitado no encontrado' });
    try {
        const buffer = await generateWalletPass(resultado.datos);
        return enviarPase(res, buffer);
    } catch (err) {
        console.error('[wallet] error al generar el pase:', err);
        return res.status(500).json({ ok: false, msg: 'No se pudo generar el pase' });
    }
};

const paseInvitacion = async (req, res) => generar(res, await datosPaseInvitacion(req.params.invitationId, req.params.guestId));
const paseSide = async (req, res) => generar(res, await datosPaseSide(req.params.eventId, req.params.guestId));

// ── Servicio web de PassKit ────────────────────────────────────────────────

const tipoValido = (req) => req.params.passType === process.env.APPLE_PASS_TYPE_ID;

// El pase por su serie, si el token de "ApplePass <token>" coincide.
async function paseAutorizado(req) {
    const token = /^ApplePass\s+(.+)$/i.exec(req.get('Authorization') || '')?.[1];
    if (!token || !tipoValido(req)) return null;
    const { data } = await supabase.from('wallet_passes').select('*').eq('serial_number', req.params.serial).maybeSingle();
    if (!data) return null;
    const a = Buffer.from(token);
    const b = Buffer.from(data.auth_token);
    return a.length === b.length && crypto.timingSafeEqual(a, b) ? data : null;
}

const registrar = async (req, res) => {
    const pase = await paseAutorizado(req);
    if (!pase) return res.sendStatus(401);
    const pushToken = req.body?.pushToken;
    if (!pushToken) return res.sendStatus(400);
    const device = req.params.device;
    await supabase.from('wallet_devices').upsert({ device_library_id: device, push_token: pushToken, updated_at: new Date().toISOString() });
    const { data: previo } = await supabase.from('wallet_registrations').select('device_library_id')
        .eq('device_library_id', device).eq('serial_number', pase.serial_number).maybeSingle();
    if (previo) return res.sendStatus(200);
    const { error } = await supabase.from('wallet_registrations').insert({ device_library_id: device, serial_number: pase.serial_number });
    if (error) return res.sendStatus(500);
    return res.sendStatus(201);
};

const seriesActualizadas = async (req, res) => {
    if (!tipoValido(req)) return res.sendStatus(404);
    const { data: regs } = await supabase.from('wallet_registrations').select('serial_number').eq('device_library_id', req.params.device);
    const series = (regs ?? []).map((r) => r.serial_number);
    if (!series.length) return res.sendStatus(204);
    let consulta = supabase.from('wallet_passes').select('serial_number, updated_at').in('serial_number', series);
    const desde = req.query.passesUpdatedSince;
    if (desde && !isNaN(new Date(desde))) consulta = consulta.gt('updated_at', new Date(desde).toISOString());
    const { data } = await consulta;
    if (!data?.length) return res.sendStatus(204);
    const lastUpdated = data.map((p) => p.updated_at).sort().pop();
    return res.json({ serialNumbers: data.map((p) => p.serial_number), lastUpdated });
};

const darDeBaja = async (req, res) => {
    const pase = await paseAutorizado(req);
    if (!pase) return res.sendStatus(401);
    await supabase.from('wallet_registrations').delete()
        .eq('device_library_id', req.params.device).eq('serial_number', pase.serial_number);
    const { count } = await supabase.from('wallet_registrations').select('serial_number', { count: 'exact', head: true })
        .eq('device_library_id', req.params.device);
    if (!count) await supabase.from('wallet_devices').delete().eq('device_library_id', req.params.device);
    return res.sendStatus(200);
};

const ultimoPase = async (req, res) => {
    const pase = await paseAutorizado(req);
    if (!pase) return res.sendStatus(401);
    const resultado = await datosPorSerie(pase);
    // El invitado o el evento ya no existen: Wallet conserva el que tiene.
    if (!resultado) return res.sendStatus(404);
    try {
        const buffer = await generateWalletPass(resultado.datos);
        return enviarPase(res, buffer, { 'Last-Modified': new Date(pase.updated_at).toUTCString() });
    } catch (err) {
        console.error('[wallet] error al regenerar el pase:', err);
        return res.sendStatus(500);
    }
};

const registroErrores = (req, res) => {
    (req.body?.logs ?? []).forEach((l) => console.warn('[wallet/log]', l));
    return res.sendStatus(200);
};

// ── Bienvenida al escanear el pase ─────────────────────────────────────────

const nombreDe = (nombre) => String(nombre ?? '').trim().split(/\s+/)[0] || '';

const bienvenida = async (req, res) => {
    const { kind, eventoId, guestIds } = req.body ?? {};
    const ids = (Array.isArray(guestIds) ? guestIds : []).map(Number).filter(Number.isFinite).slice(0, 30);
    if (!['invitacion', 'side'].includes(kind) || !eventoId || !ids.length) return res.status(400).json({ ok: false });

    const tabla = kind === 'side' ? 'side_events_guests' : 'guests';
    const padre = kind === 'side' ? 'side_events_id' : 'invitation_id';
    // Solo quien ya quedó como asistente en ese evento y aún no la recibe.
    const { data: llegaron } = await supabase.from(tabla).select('id, name').in('id', ids).eq(padre, eventoId).eq('state', 'asistente');
    const porId = new Map((llegaron ?? []).map((g) => [Number(g.id), g]));
    const { data: pases } = await supabase.from('wallet_passes').select('serial_number, guest_id')
        .eq(kind === 'side' ? 'side_event_id' : 'invitation_id', eventoId).in('guest_id', [...porId.keys()]).is('bienvenida_at', null);

    let enviados = 0;
    for (const p of pases ?? []) {
        const nombre = nombreDe(porId.get(Number(p.guest_id))?.name);
        const mensaje = nombre ? `¡Qué alegría recibirte, ${nombre}! Disfruta la celebración.` : '¡Qué alegría recibirte! Disfruta la celebración.';
        const r = await avisarPases([p.serial_number], mensaje, { bienvenida_at: new Date().toISOString() });
        enviados += r.enviados ?? 0;
    }
    return res.json({ ok: true, pases: pases?.length ?? 0, enviados });
};

// ── Actualizar los pases de un evento (al publicar la invitación) ───────────
// Wallet vuelve a pedir el pase y ve la foto, el título, las direcciones o el
// horario nuevos, sin notificación. Solo los pases con iPhone registrado, y
// una vez por minuto por evento.
const ultimaActualizacion = new Map();
const actualizarEvento = async (req, res) => {
    const { kind, eventoId } = req.body ?? {};
    if (!['invitacion', 'side'].includes(kind) || !eventoId) return res.status(400).json({ ok: false });
    const clave = `${kind}:${eventoId}`;
    if (Date.now() - (ultimaActualizacion.get(clave) ?? 0) < 60000) return res.json({ ok: true, omitido: true });
    ultimaActualizacion.set(clave, Date.now());
    const { data } = await supabase.from('wallet_passes').select('serial_number, wallet_registrations!inner(device_library_id)')
        .eq(kind === 'side' ? 'side_event_id' : 'invitation_id', eventoId);
    const series = [...new Set((data ?? []).map((p) => p.serial_number))];
    const r = series.length ? await tocarPases(series) : { enviados: 0 };
    return res.json({ ok: true, pases: series.length, enviados: r.enviados ?? 0 });
};

module.exports = { paseInvitacion, paseSide, registrar, seriesActualizadas, darDeBaja, ultimoPase, registroErrores, bienvenida, actualizarEvento };
