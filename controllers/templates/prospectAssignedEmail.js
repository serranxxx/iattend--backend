function prospectAssignedEmailTemplate({ vendedorNombre, username }) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Nuevo prospecto asignado — Tablero de Prospectos</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,400;0,500;1,400;1,500&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background-color:#EEEDFE;font-family:'Inter',-apple-system,Helvetica,Arial,sans-serif;">

<div style="background-color:#EEEDFE;padding:40px 16px;">
  <table role="presentation" align="center" width="560" cellpadding="0" cellspacing="0" border="0"
    style="width:560px;max-width:560px;background:#FFFFFF;border-radius:20px;overflow:hidden;box-shadow:0 20px 50px rgba(38,33,92,0.12),0 2px 0 rgba(38,33,92,0.04);">
    <tbody>

      <tr>
        <td style="background-color:#26215C;padding:36px 40px;text-align:center;">
          <div style="font-family:'Fraunces',Georgia,'Times New Roman',serif;font-weight:500;font-size:26px;letter-spacing:0.5px;color:#FFFFFF;line-height:1;">
            i <span style="font-style:italic;color:#CECBF6;">attend</span>
          </div>
        </td>
      </tr>

      <tr>
        <td style="background-color:#FFFFFF;padding:44px 48px 8px;text-align:center;">
          <h1 style="margin:0;font-family:'Fraunces',Georgia,'Times New Roman',serif;font-weight:400;font-size:26px;line-height:1.3;color:#1a1a1a;">
            Nuevo <em style="font-style:italic;color:#7F77DD;">prospecto</em> asignado
          </h1>
        </td>
      </tr>

      <tr>
        <td style="background-color:#FFFFFF;padding:16px 48px 48px;text-align:center;">
          <p style="margin:0;font-family:'Inter',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#5A5676;">
            Hola <strong style="color:#26215C;">${vendedorNombre}</strong>, se te asignó un nuevo prospecto de
            Instagram: <strong style="color:#26215C;">@${username}</strong>. Entra al Tablero de Prospectos para
            revisarlo.
          </p>
        </td>
      </tr>

    </tbody>
  </table>
</div>

</body>
</html>`;
}

module.exports = { prospectAssignedEmailTemplate };
