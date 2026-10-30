const crypto = require('crypto');
const supabase = require('../../config/supabase');
const { lugarDeLink } = require('./geocodificar');

/*
  Datos del pase de Apple Wallet de un invitado, leídos de Supabase (antes los
  armaba iattend-events en /api/wallet/pass y /api/wallet/side-pass). Viven en
  el backend porque Wallet vuelve a pedir el pase por su número de serie
  cuando cambia algo (GET /api/wallet/v1/passes/…), sin pasar por la página.

  · Número de serie fijo por invitado ("inv-<invitación>-<invitado>" o
    "side-<evento>-<invitado>") y su token en wallet_passes: el pase se puede
    actualizar y mandar avisos. Sin la tabla (migración sin correr) o sin
    WALLET_WEB_SERVICE_URL, el pase sale como antes, sin actualizaciones.
  · Diseño clásico de boleto (con QR): frente igual que siempre; en el
    reverso, el último aviso (changeMessage → notificación), cada dirección
    del itinerario con su link a Maps, el itinerario y el link a la
    invitación.
  · Varias direcciones (ej. misa y recepción): todas van en el reverso y en
    la pantalla de bloqueo (hasta 10). Wallet solo admite un "lugar del
    evento" (semantics.venueName / venueLocation): el que el organizador
    marcó como principal en el itinerario (`principal: true`, iattend-vite
    lugarPrincipal.js); sin marca, el ÚLTIMO con dirección, donde
    normalmente se escanea el pase.
  · Coordenadas y nombre del lugar: del link de Google Maps de cada
    dirección (geocodificar.js); sin link útil, el lugar va sin coordenadas.
*/

const URL_EVENTOS = (process.env.EVENTS_URL || 'https://iattend.events').replace(/\/$/, '');
const URL_SERVICIO = process.env.WALLET_WEB_SERVICE_URL ? process.env.WALLET_WEB_SERVICE_URL.replace(/\/$/, '') : null;
const ESTADOS_CON_PASE_SIDE = ['confirmado', 'asistente'];
const HORA = 60 * 60 * 1000;

// Mismo mapeo que iattend-events / iattend-vite (eventDateTime.js).
const STATE_TIMEZONES = {
    'baja california': 'America/Tijuana',
    'baja california sur': 'America/Mazatlan',
    sonora: 'America/Hermosillo',
    sinaloa: 'America/Mazatlan',
    'quintana roo': 'America/Cancun',
};
const zonaDe = (body) => body?.timezone || STATE_TIMEZONES[String(body?.address?.state ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()] || 'America/Mexico_City';

// "2026-11-14 19:30:00" (hora de pared en `zona`) → instante ISO real.
function instanteDePared(pared, zona) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(pared ?? ''));
    if (!m) return null;
    const comoUTC = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    // Diferencia entre la hora de pared de ese instante en la zona y UTC.
    const partes = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone: zona, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(comoUTC)).map((p) => [p.type, p.value]));
    const enZona = Date.UTC(+partes.year, +partes.month - 1, +partes.day, +partes.hour, +partes.minute);
    return new Date(comoUTC - (enZona - comoUTC)).toISOString();
}

// "20:00" → "8:00 pm" (como el boleto de la página y la invitación).
const hora12 = (hhmm) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm ?? ''));
    if (!m) return '';
    const h = Number(m[1]);
    return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'am' : 'pm'}`;
};

const escaparHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Dirección legible (las viejas traen calle / numero / colonia / ciudad / estado).
function textoDireccion(a) {
    if (!a) return '';
    const calle = [a.street ?? a.calle, a.number ?? a.numero].filter(Boolean).join(' ');
    const resto = [a.neighborhood ?? a.colonia, a.city ?? a.ciudad, a.state ?? a.estado].filter(Boolean).join(', ');
    return [calle, resto].filter(Boolean).join(', ').trim();
}

const enlace = (url, texto) => (url ? `<a href="${escaparHtml(url)}">${escaparHtml(texto)}</a>` : undefined);

// "4:00 pm", "4 pm", "16:30", "4:30 p.m." → "16:30"; si no se entiende, null.
function hora24(texto) {
    const m = /(\d{1,2})(?::(\d{2}))?\s*(a|p)?\.?\s*m?\.?/i.exec(String(texto ?? '').trim());
    if (!m) return null;
    let h = Number(m[1]);
    const min = Number(m[2] ?? 0);
    const ampm = m[3]?.toLowerCase();
    if (ampm === 'p' && h < 12) h += 12;
    if (ampm === 'a' && h === 12) h = 0;
    if (h > 23 || min > 59) return null;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

// Inicio de una invitación: la fecha de la portada suele venir sin hora
// (medianoche); en ese caso se toma la hora del primer momento del
// itinerario, en la zona del estado de su dirección.
function inicioInvitacion(fechaValor, momentos) {
    const fecha = fechaValor ? new Date(fechaValor) : null;
    if (!fecha || isNaN(fecha)) return null;
    const conDireccion = momentos.find((m) => m.address?.state || m.address?.estado);
    const zona = zonaDe({ address: { state: conDireccion?.address?.state ?? conDireccion?.address?.estado } });
    const partes = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone: zona, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(fecha).map((p) => [p.type, p.value]));
    const esMedianoche = partes.hour === '00' && partes.minute === '00';
    const hora = esMedianoche ? hora24(momentos.find((m) => hora24(m.time))?.time) : null;
    if (!hora) return fecha.toISOString();
    return instanteDePared(`${partes.year}-${partes.month}-${partes.day} ${hora}`, zona);
}

// Renglón de wallet_passes (número de serie y token). null si no hay tabla.
async function asegurarPase({ kind, invitationId, sideEventId, guestId, eventoFecha }) {
    const serial = `${kind === 'side' ? 'side' : 'inv'}-${kind === 'side' ? sideEventId : invitationId}-${guestId}`;
    const { data, error } = await supabase.from('wallet_passes').select('*').eq('serial_number', serial).maybeSingle();
    if (error) {
        console.warn('[wallet] sin wallet_passes (¿falta la migración 2026-10-31?):', error.message);
        return null;
    }
    if (data) {
        if (eventoFecha && data.evento_fecha !== eventoFecha) {
            await supabase.from('wallet_passes').update({ evento_fecha: eventoFecha }).eq('serial_number', serial);
        }
        return data;
    }
    const fila = {
        serial_number: serial,
        kind,
        invitation_id: kind === 'side' ? null : invitationId,
        side_event_id: kind === 'side' ? sideEventId : null,
        guest_id: guestId,
        auth_token: crypto.randomBytes(24).toString('hex'),
        evento_fecha: eventoFecha,
    };
    const { data: nueva, error: errInsert } = await supabase.from('wallet_passes').insert(fila).select().maybeSingle();
    if (errInsert) {
        // Dos descargas al mismo tiempo: la otra ya lo creó.
        const { data: otra } = await supabase.from('wallet_passes').select('*').eq('serial_number', serial).maybeSingle();
        return otra ?? null;
    }
    return nueva;
}

// Lo común de los dos tipos: actualizaciones, reverso, fechas y lugares.
async function completar(base, { fila, eventoFecha, lugares, itinerario, linkInvitacion, grupo, fechas }) {
    const conServicio = Boolean(URL_SERVICIO && fila);

    const backFields = [];
    if (conServicio) {
        backFields.push({
            key: 'aviso',
            label: 'Avisos del evento',
            value: fila.aviso || 'Aquí te llegarán los avisos del evento.',
            changeMessage: '%@',
        });
    }
    // Nombre y coordenadas de cada lugar, del link de Google Maps (caché).
    const conLink = [];
    for (const l of lugares.slice(0, 10)) conLink.push({ ...l, maps: await lugarDeLink(l.url) });

    conLink.forEach((l, i) => {
        const texto = l.maps?.nombre ? `${l.maps.nombre}\n${l.direccion}` : l.direccion;
        backFields.push({
            key: `lugar${i}`,
            label: [l.nombre, l.hora].filter(Boolean).join(' · ') || 'Lugar',
            value: texto,
            attributedValue: l.url ? `<a href="${escaparHtml(l.url)}">${escaparHtml(texto)}</a>` : undefined,
        });
    });
    if (itinerario.length) {
        // Sin detectores: Wallet subrayaba las horas como fechas.
        backFields.push({ key: 'itinerario', label: 'Itinerario', value: itinerario.join('\n'), dataDetectorTypes: [] });
    }
    if (linkInvitacion) {
        backFields.push({ key: 'invitacion', label: 'Tu invitación', value: linkInvitacion, attributedValue: enlace(linkInvitacion, 'Ver invitación') });
    }

    const conCoordenadas = conLink.filter((l) => l.maps?.lat != null);
    const principal = conLink.find((l) => l.principal) ?? conLink[conLink.length - 1];

    const inicios = (fechas?.length ? fechas : [eventoFecha]).filter(Boolean);
    const relevantDates = inicios.map((f) => ({
        startDate: new Date(new Date(f).getTime() - 3 * HORA).toISOString(),
        endDate: new Date(new Date(f).getTime() + 12 * HORA).toISOString(),
    }));
    const ultimo = inicios.length ? Math.max(...inicios.map((f) => new Date(f).getTime())) : null;

    return {
        ...base,
        ...(fila ? { serialNumber: fila.serial_number } : {}),
        ...(conServicio ? { webServiceURL: URL_SERVICIO, authenticationToken: fila.auth_token } : {}),
        groupingIdentifier: grupo,
        backFields,
        relevantDates,
        locations: conCoordenadas.map((l) => ({
            latitude: l.maps.lat,
            longitude: l.maps.lng,
            relevantText: [l.nombre, l.maps.nombre].filter(Boolean).join(' · ') || base.eventName,
        })),
        // Dos días después del evento sale como vencido.
        ...(ultimo ? { expirationDate: new Date(ultimo + 48 * HORA).toISOString() } : {}),
        ...(eventoFecha ? { eventStartDate: eventoFecha } : {}),
        ...(principal ? { venue: { name: principal.maps?.nombre || principal.nombre || principal.direccion, latitude: principal.maps?.lat, longitude: principal.maps?.lng } } : {}),
    };
}

const toCoverImageUrl = (src) => {
    if (typeof src === 'string') return src.trim() || null;
    if (Array.isArray(src)) return src.find((s) => typeof s === 'string' && s.trim()) ?? null;
    return null;
};

// Invitación: { datos, fila } o null si no existe.
async function datosPaseInvitacion(invitationId, guestId) {
    const [{ data: inv }, { data: guest }] = await Promise.all([
        supabase.from('invitations').select('id, label, name, data').eq('id', invitationId).maybeSingle(),
        supabase.from('guests').select('id, name, table, invitation_id').eq('id', guestId).eq('invitation_id', invitationId).maybeSingle(),
    ]);
    if (!inv?.data || !guest) return null;
    const d = inv.data;
    // Apple Wallet apagado por el organizador (vite → Pase digital).
    if (d.wallet?.enabled === false) return null;

    let tableNumber = null;
    if (guest.table) {
        const { data: mesa } = await supabase.from('tables').select('number').eq('id', guest.table).maybeSingle();
        tableNumber = mesa?.number ?? null;
    }

    const fechaValor = d.cover?.date?.value;
    const momentos = d.itinerary?.active === false ? [] : (d.itinerary?.object ?? []);
    const eventoFecha = inicioInvitacion(fechaValor, momentos);
    const fila = await asegurarPase({ kind: 'invitacion', invitationId, guestId: guest.id, eventoFecha });

    const vistos = new Set();
    const lugares = [];
    for (const m of momentos) {
        const direccion = textoDireccion(m.address);
        if (!direccion) continue;
        // Misma dirección en dos momentos: va una vez (con la marca de principal si alguno la tiene).
        if (vistos.has(direccion)) {
            if (m.principal === true) lugares.find((l) => l.direccion === direccion).principal = true;
            continue;
        }
        vistos.add(direccion);
        lugares.push({ nombre: m.name || null, hora: m.time || null, direccion, url: m.address?.url || null, principal: m.principal === true });
    }
    const itinerario = momentos.filter((m) => m.name).map((m) => [m.time, m.name].filter(Boolean).join('  '));

    const base = {
        guestId: guest.id,
        guestName: guest.name ?? 'Invitado',
        // Título y foto del pase (panel "Pase digital" del editor de vite) o
        // los de la portada.
        eventName: String(d.wallet?.title ?? '').trim() || d.cover?.title?.text?.value || 'Evento',
        eventDate: fechaValor,
        eventTime: momentos[0]?.time ?? '',
        tableNumber,
        coverImageUrl: toCoverImageUrl(d.wallet?.image) || toCoverImageUrl(d.cover?.image?.prod),
        primaryColor: d.generals?.colors?.primary ?? '#FFFFFF',
        accentColor: d.generals?.colors?.accent ?? '#FFFFFF',
    };
    const linkInvitacion = inv.label && inv.name ? `${URL_EVENTOS}/${encodeURIComponent(inv.label)}/${encodeURIComponent(inv.name)}` : null;
    const datos = await completar(base, { fila, eventoFecha, lugares, itinerario, linkInvitacion, grupo: `inv-${invitationId}` });
    return { datos, fila };
}

// Side event / Flash: { datos, fila } o null (sin evento, sin fecha o sin confirmar).
async function datosPaseSide(eventId, guestId) {
    const [{ data: evento }, { data: guest }] = await Promise.all([
        supabase.from('side_events').select('id, name, body, url_image').eq('id', eventId).maybeSingle(),
        supabase.from('side_events_guests').select('id, name, state, password, side_events_id')
            .eq('id', guestId).eq('side_events_id', eventId).maybeSingle(),
    ]);
    if (!evento?.body || !guest || !ESTADOS_CON_PASE_SIDE.includes(guest.state)) return null;
    const body = evento.body;
    // Apple Wallet apagado por el organizador (vite → Pase digital).
    if (body.wallet?.enabled === false) return null;
    // Hora de pared "YYYY-MM-DD HH:mm:00" (sin huso): el encabezado la enseña tal cual.
    const hora = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(String(body.hour ?? ''));
    if (!hora) return null;
    const zona = zonaDe(body);
    const fechas = (Array.isArray(body.dates) && body.dates.length ? body.dates : [body.hour]).map((f) => instanteDePared(f, zona)).filter(Boolean);
    const eventoFecha = fechas[0] ?? null;

    const { data: acompanantes } = await supabase.from('side_events_guests').select('id')
        .eq('companion_id', guest.id).in('state', ESTADOS_CON_PASE_SIDE);
    const personas = 1 + (acompanantes?.length ?? 0);

    // Folio del titular en el formulario del Flash.
    let folio = null;
    if (body.form?.enabled) {
        const { data: resp } = await supabase.from('side_event_form_responses').select('folio')
            .eq('side_event_id', evento.id).eq('guest_id', guest.id).maybeSingle();
        folio = resp?.folio ?? null;
    }
    const clave = folio || guest.password;

    const fila = await asegurarPase({ kind: 'side', sideEventId: evento.id, guestId: guest.id, eventoFecha });

    const a = body.address;
    const direccion = textoDireccion({ street: a?.street, number: a?.number, neighborhood: a?.neighborhood, city: a?.city, state: a?.state });
    const lugares = direccion ? [{ nombre: body.place_name || null, hora: hora12(hora[2]), direccion, url: a?.url || null }] : [];
    const itinerario = (body.itinerary ?? []).filter((m) => m.name)
        .map((m) => [m.time ? hora12(m.time) || m.time : null, m.name, m.place ? `— ${m.place}` : null].filter(Boolean).join('  '));

    const base = {
        // El backend usa guestId como contenido del QR: va con el prefijo (paseSide.ts).
        guestId: `side:${guest.id}`,
        guestName: guest.name ?? 'Invitado',
        // Título y foto del pase (vite → Pase digital) o los del evento.
        eventName: String(body.wallet?.title ?? '').trim() || evento.name || 'Evento',
        eventDate: `${hora[1]}T${hora[2]}:00`,
        eventTime: hora12(hora[2]),
        // Foto del pase; si no, la imagen del link (con los elementos de la
        // portada si se armó "desde mi diseño") y si no, la portada.
        coverImageUrl: body.wallet?.image || evento.url_image || body.image || null,
        primaryColor: body.color ?? '#2A2730',
        accentColor: '#FFFFFF',
        auxFields: [
            { label: 'Personas', value: personas },
            ...(clave ? [{ label: folio ? 'Folio' : 'Código', value: clave }] : []),
        ],
    };
    const datos = await completar(base, {
        fila, eventoFecha, fechas, lugares, itinerario,
        linkInvitacion: `${URL_EVENTOS}/side-event/${evento.id}`,
        grupo: `side-${evento.id}`,
    });
    return { datos, fila };
}

// Por número de serie (Wallet pide el pase actualizado).
async function datosPorSerie(fila) {
    if (fila.kind === 'side') return datosPaseSide(fila.side_event_id, fila.guest_id);
    return datosPaseInvitacion(fila.invitation_id, fila.guest_id);
}

module.exports = { datosPaseInvitacion, datosPaseSide, datosPorSerie, URL_SERVICIO };
