const supabase = require('../config/supabase');

/*
  Cómo llega un side event / Pop a las rutas públicas (las que usa la página
  del invitado en iattend-events): por su código al azar (`public_code`, el
  del link iattend.events/side-event/<código>) o, solo en los eventos que ya
  existían antes del código (`legacy_link_enabled`), por su número. Así no se
  puede llegar a otro evento cambiando el número en la URL. Misma regla que
  la página (RPC `side_event_publico`) y que la migración
  2026-11-01b_side_events_public_code.sql.

  Transición: mientras SIDE_EVENT_NUMERO_SIEMPRE=1, cualquier número entra
  (la página vieja de events todavía manda el número). Apagarla cuando el
  deploy de events que manda el código ya esté arriba.
  Las rutas del organizador (con su sesión) siguen por número.
*/

const numeroSiempre = () => process.env.SIDE_EVENT_NUMERO_SIEMPRE === '1';
const esNumero = (c) => /^\d{1,18}$/.test(c);

/**
 * @param {string} clave  código público o número del evento
 * @param {string} columnas  columnas de side_events a traer
 * @returns {Promise<object|null>} la fila, o null si no existe o el número ya no abre
 */
async function buscarSideEventPorClave(clave, columnas) {
    let c = String(clave ?? '').trim();
    try { c = decodeURIComponent(c); } catch { /* se queda como llegó */ }
    if (!c) return null;

    if (!esNumero(c)) {
        const { data, error } = await supabase.from('side_events').select(columnas).eq('public_code', c.toLowerCase()).maybeSingle();
        // Sin la migración todavía no hay public_code: nada abre por código.
        if (error?.code === '42703') return null;
        if (error) throw error;
        return data;
    }

    let { data, error } = await supabase.from('side_events').select(`${columnas}, legacy_link_enabled`).eq('id', c).maybeSingle();
    if (error?.code === '42703') {
        // Sin la migración: el número abre como antes.
        ({ data, error } = await supabase.from('side_events').select(columnas).eq('id', c).maybeSingle());
        if (error) throw error;
        return data;
    }
    if (error) throw error;
    if (!data) return null;
    if (data.legacy_link_enabled === false && !numeroSiempre()) return null;
    const { legacy_link_enabled, ...fila } = data;
    return fila;
}

module.exports = { buscarSideEventPorClave, numeroSiempre };
