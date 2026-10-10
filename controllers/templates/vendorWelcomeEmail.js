const { welcomeEnvelopeEmail, escapeHtml, SERIF, SANS, INK } = require('./welcomeEnvelope');

// Correo de bienvenida del alta por vendedor (/sales → ventas.js).
// `nombreEvento` se sigue aceptando para no romper la llamada, pero el diseño
// nuevo usa un titular fijo.
function vendorWelcomeEmailTemplate({ nombreEvento, email, password, loginUrl }) {
  return welcomeEnvelopeEmail({
    title: 'Tu cuenta de I attend está lista',
    variant: 'vendor',
    height: 660,
    headline: `
      <div style="font-family:${SERIF};font-style:italic;font-size:30px;line-height:30px;color:${INK};">Tu invitación</div>
      <div style="margin-top:4px;font-family:${SERIF};font-size:42px;line-height:44px;letter-spacing:-0.5px;color:${INK};">ya está lista.</div>`,
    paragraph: `
      <div style="font-family:${SANS};font-style:italic;font-size:15px;line-height:22px;color:${INK};">Con estos datos puedes entrar a tu panel de organizador y personalizarla cuando quieras.</div>`,
    email: escapeHtml(email),
    password: escapeHtml(password),
    loginUrl,
  });
}

module.exports = { vendorWelcomeEmailTemplate };
