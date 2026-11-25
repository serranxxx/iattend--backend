const fs = require('fs');
const path = require('path');

/*
  "Tu Pop ya está listo 🎉" — correo de acceso de los Pops (handoff "Correo
  Tu Pop ya está listo", diseño de la landing azul). Es el que recibe quien
  queda dueño de un Pop: el cliente al que se lo mandan (Make a Pop → Enviar
  ahora / "A mi cliente"), el que lo compra con Stripe, el de "enviar
  después" cuando se lo asignan y la bienvenida del espacio Pops. Weddings
  sigue con el correo morado de siempre (vendorWelcomeEmail /
  eventSharedEmail).

  El HTML (emailPopListo.html) es el template final del handoff (versión
  horizontal de 880 px, la recomendada; bajo 900 px se apila): aquí solo se
  reemplazan {{correo}}, {{password}} y {{panel_url}} y se quitan los bloques
  de contraseña cuando la cuenta ya existía. No loguear el HTML (lleva la
  contraseña).
*/

const TPL = fs.readFileSync(path.join(__dirname, 'emailPopListo.html'), 'utf8');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const quitar = (html, nombre) => html.replace(new RegExp(`<!-- BLOQUE:${nombre}:INICIO -->[\\s\\S]*?<!-- BLOQUE:${nombre}:FIN -->`, 'g'), '');

// Al panel: el login del espacio Pops (si ya tiene sesión, entra directo).
const PANEL_URL = 'https://www.iattend.site/login?espacio=pops&utm_source=email&utm_campaign=pop_listo';

const ASUNTO_POP_LISTO = 'Tu Pop ya está listo 🎉';

function popAccesoEmailTemplate({ correo, password = null, panelUrl = PANEL_URL }) {
    let html = TPL;
    if (!password) {
        html = quitar(html, 'PASSWORD');
        html = quitar(html, 'PASSWORD_NOTA');
    }
    return html
        .replaceAll('{{correo}}', esc(correo))
        .replaceAll('{{password}}', esc(password ?? ''))
        .replaceAll('{{panel_url}}', encodeURI(panelUrl));
}

/** Versión texto plano (multipart/alternative), la del handoff. */
function popAccesoEmailTexto({ correo, password = null, panelUrl = PANEL_URL }) {
    return [
        'Tu Pop ya está listo.',
        '',
        'Con estos datos entras a tu panel y le das estilo a tu Pop cuando quieras.',
        '',
        `Correo: ${correo}`,
        ...(password ? [`Contraseña: ${password}`] : []),
        '',
        `Entrar a mi panel: ${panelUrl}`,
        ...(password ? ['', 'Cámbiala al entrar, por si acaso.'] : []),
        '',
        'Con amor,',
        'el equipo de I attend',
    ].join('\n');
}

module.exports = { popAccesoEmailTemplate, popAccesoEmailTexto, ASUNTO_POP_LISTO, PANEL_URL };
