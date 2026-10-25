const { welcomeEnvelopeEmail, escapeHtml, SERIF, SANS, INK } = require('./welcomeEnvelope');

// Aviso a un cliente que YA tenía cuenta cuando su planner le asigna un evento
// (POST /api/planner/eventos/:id/cliente y /api/planner/flash/:id/cliente).
// Mismo sobre que la bienvenida, sin contraseña: entra con su cuenta.
function eventSharedEmailTemplate({ nombreEvento, nombrePlanner, email, loginUrl }) {
  const quien = nombrePlanner ? escapeHtml(nombrePlanner) : 'Tu planner';
  const evento = nombreEvento ? `«${escapeHtml(nombreEvento)}»` : 'un evento nuevo';
  return welcomeEnvelopeEmail({
    title: 'Tienes un evento nuevo en I attend',
    variant: 'vendor',
    height: 600,
    headline: `
      <div style="font-family:${SERIF};font-style:italic;font-size:30px;line-height:30px;color:${INK};">Tienes un</div>
      <div style="margin-top:4px;font-family:${SERIF};font-size:42px;line-height:44px;letter-spacing:-0.5px;color:${INK};">evento nuevo.</div>`,
    paragraph: `
      <div style="font-family:${SANS};font-style:italic;font-size:15px;line-height:22px;color:${INK};">${quien} te compartió ${evento}. Ya está en tu panel, junto a tus otros eventos.</div>`,
    email: escapeHtml(email),
    password: null,
    loginUrl,
  });
}

module.exports = { eventSharedEmailTemplate };
