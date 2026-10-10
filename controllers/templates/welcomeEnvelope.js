// Base compartida de los correos de bienvenida con sobre morado
// (vendorWelcomeEmail y plannerWelcomeEmail).
//
// El sobre se arma con imágenes rebanadas y celdas de tabla, porque Gmail y
// Outlook no soportan clip-path, blend modes ni posicionamiento absoluto:
//   top     → espalda del sobre + marco de rayas de la carta        (img)
//   fila 1  → [solapa izq 44px] [carta: titulares] [solapa der]    (img | td | img)
//   fila 2  → [solapa izq 127px] [carta: párrafo] [solapa der]     (img | td | img)
//   bolsillo→ td con el bolsillo de fondo (VML en Outlook) y las credenciales
// Las solapas cruzan la carta en diagonal: por eso la fila 2 es más angosta.
// Los slices se generaron del diseño (handoff design_handoff_welcome_emails)
// y viven en Storage: assets/emails/welcome/. Cada variante tiene los suyos
// porque el chaflán de la espalda (16% del alto) cambia con el alto del sobre.

const ASSETS = 'https://jblcqcxckefmydvtrxbi.supabase.co/storage/v1/object/public/assets/emails/welcome';

const SERIF = "'DM Serif Display',Georgia,'Times New Roman',serif";
const SANS = "'Figtree',Helvetica,Arial,sans-serif";
const MONO = "'JetBrains Mono',Menlo,Consolas,monospace";
const INK = '#17323F';
const CREAM = '#F1EBDE';
const PURPLE = '#7A6496';
// Papel morado con la textura horneada: relleno de las celdas laterales si el
// texto de la carta las estira más que su slice.
const PAPER = `${ASSETS}/paper-purple.jpg`;
const paperBg = `background:${PURPLE} url('${PAPER}') left top repeat;`;

// Geometría del sobre (px). El bolsillo arranca en y=254 y su contenido en 318.
const ROW1_H = 118; // y 60–178: las solapas aún no pasan del marco de rayas
const ROW2_H = 76;  // y 178–254: hasta la boca del bolsillo
const POCKET_PAD = 64;
// En una celda, `height` es el alto del contenido: el padding se suma aparte.
const ROW1_PAD = 39;
const ROW2_PAD = 14;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * @param {object} o
 * @param {string} o.title       <title> del correo
 * @param {'vendor'|'planner'} o.variant  prefijo de los slices
 * @param {number} o.height      alto total del sobre (vendor 660, planner 740)
 * @param {string} o.headline    HTML de los titulares (fila 1 de la carta)
 * @param {string} o.paragraph   HTML del párrafo (fila 2 de la carta)
 * @param {string} o.email       ya escapado
 * @param {string} o.password    ya escapado
 * @param {string} [o.note]      HTML opcional entre credenciales y botón
 * @param {string} o.loginUrl
 */
function welcomeEnvelopeEmail({ title, variant, height, headline, paragraph, email, password, note = '', loginUrl }) {
  const img = (name) => `${ASSETS}/${variant}-${name}`;
  const pocketH = height - 254;
  const href = escapeHtml(loginUrl);

  return `<!DOCTYPE html>
<html lang="es" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="UTF-8">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<title>${title}</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Figtree:ital,wght@0,400;0,500;0,600;1,400&family=JetBrains+Mono:wght@600&display=swap" rel="stylesheet">
<style>
  a.wl-btn:hover { background-color:#1F4152 !important; }
  /* Gmail y Apple Mail convierten el correo en un link azul subrayado. */
  .wl-email a, a.wl-email-link, a[x-apple-data-detectors] {
    color: #F1EBDE !important; text-decoration: none !important;
    font-size: inherit !important; font-family: inherit !important; font-weight: inherit !important; line-height: inherit !important;
  }
  /* Sin media queries a propósito: el correo mide 592px fijos y en móvil el
     cliente (Gmail, Apple Mail) lo reduce completo, sin reacomodarlo. Por eso
     tampoco hay meta viewport ni x-apple-disable-message-reformatting, que
     desactivarían ese ajuste. Reacomodado quedaba apretado. */
</style>
</head>
<body style="margin:0;padding:0;background-color:#121611;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#121611" background="${ASSETS}/fondo-mail.jpg"
  style="background:#121611 url('${ASSETS}/fondo-mail.jpg') center top / cover no-repeat;">
  <tr>
    <td align="center" valign="top" style="padding:56px 16px 48px;">
      <!--[if gte mso 9]>
      <v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="mso-width-percent:1000;">
        <v:fill type="frame" src="${ASSETS}/fondo-mail.jpg" color="#121611" />
        <v:textbox inset="0,0,0,0">
      <![endif]-->

      <table role="presentation" align="center" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:560px;">

        <!-- Logo -->
        <tr>
          <td align="center" style="padding:0 0 52px;">
            <img src="${ASSETS}/logo-iattend.png" width="230" alt="I attend" style="display:block;width:230px;height:auto;border:0;">
          </td>
        </tr>

        <!-- Sobre: espalda + marco de la carta -->
        <tr>
          <td style="font-size:0;line-height:0;">
            <img src="${img('top.png')}" width="560" height="60" alt="" style="display:block;width:560px;height:60px;border:0;">
          </td>
        </tr>

        <!-- Carta, fila 1: titulares. Las solapas van sin fondo (arriba está el
             chaflán transparente de la espalda) y pegadas abajo: si el texto
             crece (nombres largos, móvil) el hueco queda arriba, junto al chaflán. -->
        <tr>
          <td>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td width="44" valign="bottom" style="width:44px;font-size:0;line-height:0;">
                  <img src="${img('b1-left.png')}" width="44" height="${ROW1_H}" alt="" style="display:block;width:44px;height:${ROW1_H}px;border:0;">
                </td>
                <td width="472" height="${ROW1_H - ROW1_PAD}" align="center" valign="top" bgcolor="#FFFFFF"
                  style="width:472px;height:${ROW1_H - ROW1_PAD}px;background-color:#FFFFFF;padding-top:${ROW1_PAD}px;text-align:center;color:${INK};">
                  ${headline}
                </td>
                <td width="44" valign="bottom" style="width:44px;font-size:0;line-height:0;">
                  <img src="${img('b1-right.png')}" width="44" height="${ROW1_H}" alt="" style="display:block;width:44px;height:${ROW1_H}px;border:0;">
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Carta, fila 2: párrafo entre las solapas. Si el texto crece, el
             papel de las celdas laterales continúa la solapa. -->
        <tr>
          <td>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td width="127" valign="top" bgcolor="${PURPLE}" background="${PAPER}" style="width:127px;${paperBg}font-size:0;line-height:0;">
                  <img src="${img('b2-left.png')}" width="127" height="${ROW2_H}" alt="" style="display:block;width:127px;height:${ROW2_H}px;border:0;">
                </td>
                <td width="306" height="${ROW2_H - ROW2_PAD}" align="center" valign="top" bgcolor="#FFFFFF" background="${ASSETS}/letter-bottom.jpg"
                  style="width:306px;height:${ROW2_H - ROW2_PAD}px;background:#FFFFFF url('${ASSETS}/letter-bottom.jpg') left top / 100% 100% no-repeat;padding-top:${ROW2_PAD}px;text-align:center;color:${INK};">
                  ${paragraph}
                </td>
                <td width="127" valign="top" bgcolor="${PURPLE}" background="${PAPER}" style="width:127px;${paperBg}font-size:0;line-height:0;">
                  <img src="${img('b2-right.png')}" width="127" height="${ROW2_H}" alt="" style="display:block;width:127px;height:${ROW2_H}px;border:0;">
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Bolsillo -->
        <tr>
          <td align="center" valign="top" height="${pocketH - POCKET_PAD}" bgcolor="${PURPLE}" background="${img('pocket.jpg')}"
            style="height:${pocketH - POCKET_PAD}px;background:${PURPLE} url('${img('pocket.jpg')}') left top / 100% 100% no-repeat;padding:${POCKET_PAD}px 0 0;text-align:center;">
            <!--[if gte mso 9]>
            <v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:560px;height:${pocketH}px;">
              <v:fill type="frame" src="${img('pocket.jpg')}" color="${PURPLE}" />
              <v:textbox inset="0,${POCKET_PAD}px,0,0">
            <![endif]-->
            <div style="font-family:${SANS};font-weight:500;font-size:17px;line-height:20px;color:${CREAM};">Tus datos de acceso:</div>

            <table role="presentation" align="center" width="340" cellpadding="0" cellspacing="0" border="0" style="width:340px;margin:16px auto 0;">
              <tr>
                <td style="border:2px dashed rgba(241,235,222,0.85);border-radius:18px;padding:18px 24px;text-align:center;">
                  <div style="font-family:${SANS};font-size:11px;line-height:14px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#E4DAEE;">Correo</div>
                  <!-- Link propio con estilo inline: si no, el cliente detecta el
                       correo y lo pinta azul y subrayado. -->
                  <div class="wl-email" style="margin-top:4px;font-family:${MONO};font-size:16px;line-height:22px;font-weight:600;color:${CREAM};word-break:break-all;">
                    <a class="wl-email-link" href="mailto:${email}" style="color:${CREAM};text-decoration:none;font-family:${MONO};font-weight:600;"><span style="color:${CREAM};text-decoration:none;">${email}</span></a>
                  </div>
                  <div style="height:1px;line-height:1px;font-size:0;background-color:rgba(241,235,222,0.3);margin:14px 0;">&nbsp;</div>
                  <div style="font-family:${SANS};font-size:11px;line-height:14px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#E4DAEE;">Contraseña</div>
                  <div style="margin-top:4px;font-family:${MONO};font-size:22px;line-height:28px;font-weight:600;letter-spacing:2px;color:${CREAM};">${password}</div>
                </td>
              </tr>
            </table>

            ${note}

            <table role="presentation" align="center" width="320" cellpadding="0" cellspacing="0" border="0" style="width:320px;margin:${note ? 20 : 24}px auto 0;">
              <tr>
                <td align="center">
                  <!--[if mso]>
                  <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
                    href="${href}" style="height:56px;v-text-anchor:middle;width:320px;" arcsize="29%" stroke="f" fillcolor="${INK}">
                    <w:anchorlock/>
                    <center style="color:${CREAM};font-family:Georgia,serif;font-size:20px;letter-spacing:1px;">ENTRAR A MI PANEL &nbsp;&rarr;</center>
                  </v:roundrect>
                  <![endif]-->
                  <!--[if !mso]><!-->
                  <a class="wl-btn" href="${href}"
                    style="display:block;background-color:${INK};border-radius:16px;color:${CREAM};font-family:${SERIF};font-size:21px;line-height:56px;height:56px;letter-spacing:1.2px;text-transform:uppercase;text-decoration:none;text-align:center;box-shadow:0 6px 14px rgba(10,20,28,0.4);">
                    Entrar a mi panel&nbsp;&nbsp;<span style="font-family:${SANS};font-size:26px;">&rarr;</span>
                  </a>
                  <!--<![endif]-->
                </td>
              </tr>
            </table>
            <!--[if gte mso 9]></v:textbox></v:rect><![endif]-->
          </td>
        </tr>

        <!-- Firma -->
        <tr>
          <td align="center" style="padding:56px 0 0;">
            <img src="${ASSETS}/con-amor.png" width="230" alt="Con amor," style="display:block;width:230px;height:auto;border:0;">
            <div style="margin-top:2px;font-family:${SERIF};font-size:19px;line-height:24px;letter-spacing:0.3px;color:${CREAM};">el equipo de I attend</div>
          </td>
        </tr>

      </table>

      <!--[if gte mso 9]></v:textbox></v:rect><![endif]-->
    </td>
  </tr>
</table>

</body>
</html>`;
}

module.exports = { welcomeEnvelopeEmail, escapeHtml, SERIF, SANS, INK, CREAM };
