const supabase = require('../config/supabase');
const { avisarPases } = require('../services/wallet/avisos');

/*
  Cuenta regresiva en los pases de Wallet: a los 7 días, 1 día y el mismo día
  del evento, un aviso a quien tiene el pase en su iPhone (solo pases con
  dispositivos registrados). Corre cada hora y manda entre 10:00 y 20:00 de la
  Ciudad de México; cada hito se manda una vez (wallet_passes.hitos).
  Se apaga con WALLET_CUENTA_REGRESIVA=off.
*/

const INTERVALO_MS = 60 * 60 * 1000;
const ZONA = 'America/Mexico_City';
const HITOS = [7, 1, 0];

const MENSAJES = {
    7: '¡Faltan 7 días! Ya queremos celebrar contigo.',
    1: '¡Mañana es el gran día! Te esperamos.',
    0: '¡Hoy es el día! Nos vemos pronto.',
};

// "YYYY-MM-DD" en la zona.
const diaEn = (fecha) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(fecha);
const horaEn = (fecha) => Number(new Intl.DateTimeFormat('en-US', { timeZone: ZONA, hour: '2-digit', hourCycle: 'h23' }).format(fecha));
const diasEntre = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

const revisarCuentaRegresiva = async () => {
    const ahora = new Date();
    const hora = horaEn(ahora);
    if (hora < 10 || hora >= 20) return;

    const hasta = new Date(ahora.getTime() + 8 * 86400000).toISOString();
    const { data: pases, error } = await supabase.from('wallet_passes')
        .select('serial_number, evento_fecha, hitos, wallet_registrations!inner(device_library_id)')
        .gte('evento_fecha', new Date(ahora.getTime() - 86400000).toISOString())
        .lte('evento_fecha', hasta);
    if (error) {
        if (!/wallet_passes/.test(error.message)) console.error('[wallet] cuenta regresiva:', error.message);
        return;
    }

    const hoy = diaEn(ahora);
    const porHito = {};
    for (const p of pases ?? []) {
        const faltan = diasEntre(hoy, diaEn(new Date(p.evento_fecha)));
        if (!HITOS.includes(faltan) || (p.hitos ?? []).includes(faltan)) continue;
        // Un hito que ya pasó sin mandarse (ej. el de 7 días con el pase agregado a 3) no se manda.
        (porHito[faltan] ??= []).push(p);
    }
    for (const [hito, lista] of Object.entries(porHito)) {
        for (const p of lista) {
            await avisarPases([p.serial_number], MENSAJES[hito], { hitos: [...(p.hitos ?? []), Number(hito)] });
        }
        console.log(`[wallet] cuenta regresiva (${hito} días): ${lista.length} pase(s)`);
    }
};

const iniciarCuentaRegresivaWallet = () => {
    if (process.env.WALLET_CUENTA_REGRESIVA === 'off' || !process.env.WALLET_WEB_SERVICE_URL) return;
    const correr = () => revisarCuentaRegresiva().catch((err) => console.error('[wallet] cuenta regresiva:', err));
    correr();
    setInterval(correr, INTERVALO_MS);
};

module.exports = { iniciarCuentaRegresivaWallet, revisarCuentaRegresiva };
