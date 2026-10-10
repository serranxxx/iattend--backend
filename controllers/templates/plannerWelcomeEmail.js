const { welcomeEnvelopeEmail, escapeHtml, SERIF, SANS, INK, CREAM } = require('./welcomeEnvelope');

// Correo de bienvenida para wedding planners. Todavía no hay alta de
// planners que lo use: el template queda listo sin conectarse a ningún
// endpoint ni a mailer.js.
// genero: 'F' → "Bienvenida", 'M' → "Bienvenido".
function plannerWelcomeEmailTemplate({ nombre, genero = 'F', email, password, loginUrl }) {
  const bienvenida = genero === 'M' ? 'Bienvenido' : 'Bienvenida';

  return welcomeEnvelopeEmail({
    title: `${bienvenida} a I attend`,
    variant: 'planner',
    height: 740,
    headline: `
      <div style="font-family:${SERIF};font-style:italic;font-size:28px;line-height:28px;color:${INK};">Hola ${escapeHtml(nombre)},</div>
      <div style="margin-top:6px;font-family:${SERIF};font-size:38px;line-height:40px;letter-spacing:-0.5px;color:${INK};">${bienvenida} a I attend.</div>`,
    paragraph: `
      <div style="font-family:${SANS};font-style:italic;font-size:15px;line-height:22px;color:${INK};">Estamos muy emocionados de trabajar contigo.</div>`,
    note: `
      <div style="max-width:360px;margin:20px auto 0;padding:0 16px;font-family:${SANS};font-style:italic;font-size:15px;line-height:22px;color:${CREAM};">Dentro encontrarás una invitación de prueba para que conozcas a detalle cómo funciona I attend.</div>`,
    email: escapeHtml(email),
    password: escapeHtml(password),
    loginUrl,
  });
}

module.exports = { plannerWelcomeEmailTemplate };
