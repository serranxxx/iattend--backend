const supabase = require('../../config/supabase');
const { avisarDispositivos } = require('./apns');

/*
  Cambios a pases ya agregados a Wallet:
  · avisarPases(series, mensaje): el mensaje va en el campo "Avisos del
    evento" del reverso (changeMessage "%@"), así el iPhone lo enseña como
    notificación con el nombre del evento de título.
  · tocarPases(series): el pase cambió (hora, mesa, dirección…): se
    actualiza en silencio.
  En los dos, se marca updated_at y se avisa a APNs a los iPhone registrados.
  Un mensaje igual al anterior no enseña notificación (el campo no cambia):
  se le agrega un espacio invisible.
*/

async function empujar(series) {
    if (!series.length) return { enviados: 0 };
    const { data: regs } = await supabase.from('wallet_registrations')
        .select('device_library_id, wallet_devices(push_token)').in('serial_number', series);
    const tokens = (regs ?? []).map((r) => r.wallet_devices?.push_token).filter(Boolean);
    const { enviados, invalidos } = await avisarDispositivos(tokens);
    if (invalidos.length) {
        // Dispositivos que ya no tienen el pase: fuera (sus registros caen en cascada).
        await supabase.from('wallet_devices').delete().in('push_token', invalidos);
    }
    return { enviados, dispositivos: tokens.length };
}

async function avisarPases(series, mensaje, extra = {}) {
    const texto = String(mensaje ?? '').trim().slice(0, 240);
    if (!series.length || !texto) return { enviados: 0 };
    const ahora = new Date().toISOString();
    const { data: filas } = await supabase.from('wallet_passes').select('serial_number, aviso').in('serial_number', series);
    for (const f of filas ?? []) {
        const aviso = f.aviso === texto ? `${texto}​` : texto;
        await supabase.from('wallet_passes').update({ aviso, aviso_at: ahora, updated_at: ahora, ...extra }).eq('serial_number', f.serial_number);
    }
    return empujar((filas ?? []).map((f) => f.serial_number));
}

async function tocarPases(series) {
    if (!series.length) return { enviados: 0 };
    await supabase.from('wallet_passes').update({ updated_at: new Date().toISOString() }).in('serial_number', series);
    return empujar(series);
}

module.exports = { avisarPases, tocarPases };
