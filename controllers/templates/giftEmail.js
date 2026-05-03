function giftEmailTemplate({ senderName, personalMessage, giftCode, activationLink }) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Alguien pensó en ti — I Attend</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,400;0,500;1,400;1,500&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@600&display=swap" rel="stylesheet">
<style>
  @media (prefers-color-scheme: dark) {
    .email-wrapper { background-color: #1a1630 !important; }
    .email-body { background-color: #1e1b38 !important; }
  }
  @media only screen and (max-width: 620px) {
    .email-card { width: 100% !important; border-radius: 0 !important; }
    .email-pad { padding-left: 28px !important; padding-right: 28px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:#EEEDFE;font-family:'Inter',-apple-system,Helvetica,Arial,sans-serif;">

<div class="email-wrapper" style="background-color:#EEEDFE;padding:40px 16px;">
  <table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0" border="0"
    class="email-card"
    style="width:600px;max-width:600px;background:#FFFFFF;border-radius:20px;overflow:hidden;box-shadow:0 20px 50px rgba(38,33,92,0.12),0 2px 0 rgba(38,33,92,0.04);">
    <tbody>

      <!-- HEADER -->
      <tr>
        <td style="background-color:#26215C;padding:48px 40px 0;text-align:center;">
          <div style="font-family:'Fraunces',Georgia,'Times New Roman',serif;font-weight:500;font-size:32px;letter-spacing:0.5px;color:#FFFFFF;line-height:1;">
            i <span style="font-style:italic;color:#CECBF6;">attend</span>
          </div>
          <div style="margin:18px auto 0;width:28px;height:1px;background:rgba(206,203,246,0.35);font-size:0;">&nbsp;</div>
          <div style="margin-top:10px;font-family:'Inter',Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#CECBF6;">
            Invitaciones de boda
          </div>
        </td>
      </tr>

      <!-- GIFT ICON -->
      <tr>
        <td style="background-color:#26215C;padding:32px 40px 56px;text-align:center;">
          <div style="width:108px;height:108px;background:#EEEDFE;border-radius:50%;margin:0 auto;display:inline-block;vertical-align:middle;line-height:108px;text-align:center;">
            <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle;">
              <path d="M32 18 C24 6, 12 12, 20 20 L32 20 Z" stroke="#26215C" stroke-width="2.5" fill="#EEEDFE" stroke-linejoin="round"/>
              <path d="M32 18 C40 6, 52 12, 44 20 L32 20 Z" stroke="#26215C" stroke-width="2.5" fill="#EEEDFE" stroke-linejoin="round"/>
              <rect x="10" y="22" width="44" height="34" rx="2" fill="#FFFFFF" stroke="#26215C" stroke-width="2.5"/>
              <rect x="8" y="20" width="48" height="10" rx="1.5" fill="#7F77DD" stroke="#26215C" stroke-width="2.5"/>
              <rect x="29" y="20" width="6" height="36" fill="#26215C"/>
            </svg>
          </div>
        </td>
      </tr>

      <!-- HEADLINE -->
      <tr>
        <td class="email-pad" style="background-color:#FFFFFF;padding:56px 56px 0;text-align:center;">
          <h1 style="margin:0;font-family:'Fraunces',Georgia,'Times New Roman',serif;font-weight:400;font-size:36px;line-height:1.2;letter-spacing:-0.5px;color:#1a1a1a;">
            Alguien pensó en ti<br>
            <em style="font-style:italic;color:#7F77DD;">para este momento.</em>
          </h1>
        </td>
      </tr>

      <!-- SUBHEADLINE -->
      <tr>
        <td class="email-pad" style="background-color:#FFFFFF;padding:22px 56px 40px;text-align:center;">
          <p style="margin:0;font-family:'Inter',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#5A5676;">
            Tu invitación de boda perfecta ya está lista.<br>
            Solo falta que tú la hagas tuya.
          </p>
        </td>
      </tr>

      <!-- DIVIDER -->
      <tr>
        <td class="email-pad" style="background-color:#FFFFFF;padding:0 56px;">
          <div style="height:1px;background:#EEEDFE;font-size:0;">&nbsp;</div>
        </td>
      </tr>

      <!-- QUOTE -->
      <tr>
        <td class="email-pad" style="background-color:#FFFFFF;padding:40px 56px 8px;">
          <div style="background:#FAFAFD;border-radius:14px;border:1px solid #EEEDFE;padding:32px 32px 28px;">
            <div style="font-family:'Fraunces',Georgia,serif;font-size:64px;line-height:0.6;color:#7F77DD;font-weight:500;margin-bottom:8px;">&ldquo;</div>
            <p style="margin:0 0 20px;font-family:'Fraunces',Georgia,serif;font-style:italic;font-weight:400;font-size:18px;line-height:1.6;color:#2a2750;">
              ${personalMessage}
            </p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="width:24px;height:1px;background:#7F77DD;padding-right:12px;vertical-align:middle;font-size:0;">&nbsp;</td>
                <td style="font-family:'Inter',Helvetica,Arial,sans-serif;font-size:13px;font-weight:500;letter-spacing:1px;text-transform:uppercase;color:#7F77DD;vertical-align:middle;">
                  ${senderName}
                </td>
              </tr>
            </table>
          </div>
        </td>
      </tr>

      <!-- CODE LABEL -->
      <tr>
        <td class="email-pad" style="background-color:#FFFFFF;padding:36px 56px 0;text-align:center;">
          <p style="margin:0 0 14px;font-family:'Inter',Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:2.5px;text-transform:uppercase;color:#7F77DD;">
            · Tu código de regalo ·
          </p>
        </td>
      </tr>

      <!-- CODE BOX -->
      <tr>
        <td class="email-pad" style="background-color:#FFFFFF;padding:0 56px 8px;">
          <div style="background:#EEEDFE;border:2px dashed #7F77DD;border-radius:14px;padding:30px 20px;text-align:center;">
            <div style="font-family:'JetBrains Mono',Menlo,Consolas,'Courier New',monospace;font-size:32px;font-weight:600;letter-spacing:6px;color:#26215C;line-height:1;">
              ${giftCode}
            </div>
          </div>
        </td>
      </tr>

      <!-- CTA -->
      <tr>
        <td class="email-pad" style="background-color:#FFFFFF;padding:36px 56px 16px;text-align:center;">
          <!--[if mso]>
          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
            href="${activationLink}" style="height:56px;v-text-anchor:middle;width:240px;" arcsize="21%"
            stroke="f" fillcolor="#7F77DD">
            <w:anchorlock/>
            <center style="color:#FFFFFF;font-family:'Inter',Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;">
              Abrir mi regalo &nbsp;→
            </center>
          </v:roundrect>
          <![endif]-->
          <!--[if !mso]><!-->
          <a href="${activationLink}"
            style="display:inline-block;background:#7F77DD;color:#FFFFFF;font-family:'Inter',Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;letter-spacing:0.3px;text-decoration:none;padding:18px 42px;border-radius:12px;box-shadow:0 8px 20px rgba(127,119,221,0.35);">
            Abrir mi regalo &nbsp;→
          </a>
          <!--<![endif]-->
        </td>
      </tr>

      <!-- NOTE -->
      <tr>
        <td class="email-pad" style="background-color:#FFFFFF;padding:8px 56px 56px;text-align:center;">
          <p style="margin:0;font-family:'Inter',Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#8A86A6;">
            También puedes usar el código en
            <a href="https://iattend.mx" style="color:#7F77DD;text-decoration:none;font-weight:500;">iattend.mx</a>
            <span style="color:#CECBF6;"> · </span>
            Válido por 90 días
          </p>
        </td>
      </tr>

      <!-- STARS -->
      <tr>
        <td style="background-color:#FFFFFF;padding:0 56px;">
          <div style="text-align:center;font-family:'Fraunces',Georgia,serif;color:#CECBF6;font-size:14px;letter-spacing:10px;padding:0 0 8px;">
            ✦&nbsp;&nbsp;✦&nbsp;&nbsp;✦
          </div>
        </td>
      </tr>

      <!-- FOOTER -->
      <tr>
        <td style="background-color:#FFFFFF;padding:32px 56px 48px;text-align:center;">
          <div style="font-family:'Fraunces',Georgia,serif;font-weight:500;font-size:20px;color:#26215C;line-height:1;margin-bottom:14px;">
            i <span style="font-style:italic;color:#7F77DD;">attend</span>
          </div>
          <p style="margin:0;font-family:'Inter',Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#8A86A6;">
            Con amor,<br>
            <span style="color:#26215C;font-weight:500;">el equipo de I Attend</span>
          </p>
        </td>
      </tr>

    </tbody>
  </table>
</div>

</body>
</html>`;
}

module.exports = { giftEmailTemplate };
