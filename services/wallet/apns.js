const http2 = require('http2');
const { credencialesApple, extractFromP12 } = require('./walletService');

/*
  Aviso a Apple (APNs) de que un pase cambió: Wallet despierta, pregunta qué
  pases cambiaron (GET /v1/devices/…) y descarga el nuevo. Para pases de
  Wallet el aviso va vacío ({}), con el tema = el tipo de pase y firmado con
  el mismo certificado que firma los pases (no con una llave .p8). Solo existe
  el servidor de producción. Si el pase cambia un campo con changeMessage, el
  iPhone enseña la notificación; si no, se actualiza en silencio.
*/

const SERVIDOR = 'https://api.push.apple.com:443';

let certificado = null;
const certificadoPEM = () => {
    if (!certificado) {
        const { p12Buffer, passphrase } = credencialesApple();
        const { signerCert, signerKey } = extractFromP12(p12Buffer, passphrase);
        certificado = { cert: signerCert, key: signerKey };
    }
    return certificado;
};

// Manda el aviso a cada token. Devuelve { enviados, invalidos: [tokens] }.
async function avisarDispositivos(tokens) {
    const unicos = [...new Set(tokens.filter(Boolean))];
    if (!unicos.length) return { enviados: 0, invalidos: [] };
    const topic = process.env.APPLE_PASS_TYPE_ID;
    const sesion = http2.connect(SERVIDOR, certificadoPEM());
    sesion.on('error', (err) => console.error('[wallet/apns] sesión:', err.message));

    const invalidos = [];
    let enviados = 0;
    const uno = (token) => new Promise((resolve) => {
        let status = 0;
        let cuerpo = '';
        const req = sesion.request({
            ':method': 'POST',
            ':path': `/3/device/${token}`,
            'apns-topic': topic,
            'apns-push-type': 'background',
            'apns-priority': '5',
        });
        req.setEncoding('utf8');
        req.on('response', (h) => { status = Number(h[':status']); });
        req.on('data', (c) => { cuerpo += c; });
        req.on('end', () => {
            if (status === 200) enviados += 1;
            // 410: el iPhone ya no tiene el pase / token vencido; 400 BadDeviceToken igual.
            else if (status === 410 || /BadDeviceToken|Unregistered/.test(cuerpo)) invalidos.push(token);
            else console.warn('[wallet/apns]', status, cuerpo);
            resolve();
        });
        req.on('error', (err) => { console.warn('[wallet/apns] envío:', err.message); resolve(); });
        req.setTimeout(10000, () => { req.close(); resolve(); });
        req.end('{}');
    });

    try {
        // De 20 en 20 sobre la misma conexión.
        for (let i = 0; i < unicos.length; i += 20) await Promise.all(unicos.slice(i, i + 20).map(uno));
    } finally {
        sesion.close();
    }
    return { enviados, invalidos };
}

module.exports = { avisarDispositivos };
