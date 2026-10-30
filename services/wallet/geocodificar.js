const supabase = require('../../config/supabase');

/*
  Coordenadas y nombre de un lugar para el pase de Wallet (pantalla de bloqueo
  cerca del lugar, semantics.venueLocation / venueName), sacados del link de
  Google Maps que el organizador ya guardó en la dirección: los links cortos
  (maps.app.goo.gl/…) redirigen a /maps/place/<Nombre>/@lat,lng/…!3d<lat>!4d<lng>.
  Los links "?cid=" no traen coordenadas: esos lugares van sin ellas.

  No se usa geocodificación por texto (OpenStreetMap): con direcciones de
  México ubicaba "Chihuahua, Chihuahua" en Ciudad Juárez, y unas coordenadas
  equivocadas son peores que ninguna (el pase saldría en otra ciudad).

  Caché en wallet_geocodes (clave = el link): cada link se resuelve una vez,
  también los que no traen coordenadas. Nunca bloquea el pase: 4 s de límite.
*/

const LIMITE_MS = 4000;

function leerLugar(url) {
    const lat = /!3d(-?\d+(?:\.\d+)?)/.exec(url)?.[1] ?? /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(url)?.[1];
    const lng = /!4d(-?\d+(?:\.\d+)?)/.exec(url)?.[1] ?? /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(url)?.[2];
    const nombre = /\/maps\/place\/([^/@]+)/.exec(url)?.[1];
    return {
        lat: lat != null ? Number(lat) : null,
        lng: lng != null ? Number(lng) : null,
        nombre: nombre ? decodeURIComponent(nombre.replace(/\+/g, ' ')).trim() : null,
    };
}

async function resolverLink(url) {
    // Ya trae las coordenadas (link largo).
    const directo = leerLugar(url);
    if (directo.lat != null) return directo;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), LIMITE_MS);
    try {
        const res = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
        res.body?.cancel?.();
        return leerLugar(res.url || '');
    } catch {
        return undefined; // sin respuesta: no se guarda, se reintenta otra vez
    } finally {
        clearTimeout(t);
    }
}

const esGoogleMaps = (url) => /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|(www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+)/i.test(url || '');

// { lat, lng, nombre } o null.
async function lugarDeLink(url) {
    if (!esGoogleMaps(url)) return null;
    const clave = url.trim();
    const { data: guardado, error } = await supabase.from('wallet_geocodes').select('lat, lng, nombre').eq('clave', clave).maybeSingle();
    if (!error && guardado) return guardado.lat != null ? guardado : null;

    const lugar = await resolverLink(clave);
    if (lugar === undefined) return null;
    if (!error) {
        await supabase.from('wallet_geocodes').upsert({ clave, lat: lugar.lat, lng: lugar.lng, nombre: lugar.nombre });
    }
    return lugar.lat != null ? lugar : null;
}

module.exports = { lugarDeLink };
