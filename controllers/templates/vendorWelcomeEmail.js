function vendorWelcomeEmailTemplate({ nombreEvento, email, password, loginUrl }) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Tu cuenta de I attend está lista</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,400;0,500;1,400;1,500&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@600&display=swap" rel="stylesheet">
<style>
  @media only screen and (max-width: 620px) {
    .email-card { width: 100% !important; border-radius: 0 !important; }
    .email-pad { padding-left: 28px !important; padding-right: 28px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:#EEEDFE;font-family:'Inter',-apple-system,Helvetica,Arial,sans-serif;">

<div style="background-color:#EEEDFE;padding:40px 16px;">
  <table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0" border="0"
    class="email-card"
    style="width:600px;max-width:600px;background:#FFFFFF;border-radius:20px;overflow:hidden;box-shadow:0 20px 50px rgba(38,33,92,0.12),0 2px 0 rgba(38,33,92,0.04);">
    <tbody>

      <tr>
        <td style="background-color:#26215C;padding:48px 40px;text-align:center;">
          <div style="font-family:'Fraunces',Georgia,'Times New Roman',serif;font-weight:500;font-size:32px;letter-spacing:0.5px;color:#FFFFFF;line-height:1;">
            i <span style="font-style:italic;color:#CECBF6;">attend</span>
          </div>
          <div style="margin:18px auto 0;width:28px;height:1px;background:rgba(206,203,246,0.35);font-size:0;">&nbsp;</div>
        </td>
      </tr>

      <tr>
        <td class="email-pad" style="background-color:#FFFFFF;padding:56px 56px 0;text-align:center;">
          <h1 style="margin:0;font-family:'Fraunces',Georgia,'Times New Roman',serif;font-weight:400;font-size:32px;line-height:1.2;letter-spacing:-0.5px;color:#1a1a1a;">
            Tu invitación<br>
            <em style="font-style:italic;color:#7F77DD;">${nombreEvento || 'ya está lista.'}</em>
          </h1>
        </td>
      </tr>

      <tr>
        <td class="email-pad" style="background-color:#FFFFFF;padding:22px 56px 40px;text-align:center;">
          <p style="margin:0;font-family:'Inter',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#5A5676;">
            Con estos datos puedes entrar a tu panel de organizador y personalizar tu invitación cuando quieras.
          </p>
        </td>
      </tr>

      <tr>
        <td class="email-pad" style="background-color:#FFFFFF;padding:0 56px 8px;">
          <div style="background:#FAFAFD;border-radius:14px;border:1px solid #EEEDFE;padding:28px 32px;">
            <p style="margin:0 0 6px;font-family:'Inter',Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#7F77DD;">Correo</p>
            <p style="margin:0 0 18px;font-family:'JetBrains Mono',Menlo,Consolas,monospace;font-size:16px;color:#26215C;">${email}</p>
            <p style="margin:0 0 6px;font-family:'Inter',Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#7F77DD;">Contraseña</p>
            <p style="margin:0;font-family:'JetBrains Mono',Menlo,Consolas,monospace;font-size:16px;color:#26215C;">${password}</p>
          </div>
        </td>
      </tr>

      <tr>
        <td class="email-pad" style="background-color:#FFFFFF;padding:36px 56px 56px;text-align:center;">
          <a href="${loginUrl}"
            style="display:inline-block;background:#7F77DD;color:#FFFFFF;font-family:'Inter',Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;letter-spacing:0.3px;text-decoration:none;padding:18px 42px;border-radius:12px;box-shadow:0 8px 20px rgba(127,119,221,0.35);">
            Entrar a mi panel &nbsp;→
          </a>
        </td>
      </tr>

      <tr>
        <td style="background-color:#FFFFFF;padding:0 56px 48px;text-align:center;">
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

module.exports = { vendorWelcomeEmailTemplate };
