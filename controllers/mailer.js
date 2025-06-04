require('dotenv').config();
const nodemailer = require('nodemailer');

// Configura el transporte SMTP
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Función utilitaria para enviar el correo
async function sendMail(destinatario, asunto, mensajeHtml) {
  const mailOptions = {
    from: `"i attend" <${process.env.EMAIL_USER}>`,
    to: destinatario,
    subject: asunto,
    html: mensajeHtml,
    text: typeof mensajeHtml === 'string' ? mensajeHtml.replace(/<[^>]*>/g, '') : ''
  };

  const info = await transporter.sendMail(mailOptions);
  return info;
}

// Controlador Express (maneja req y res)
async function handleSendMail(req, res) {
  const { to, subject, html } = req.body;

  // Validación básica
  if (!to || !subject || !html || typeof html !== 'string') {
    return res.status(400).json({ error: 'Campos requeridos faltantes o inválidos' });
  }

  try {
    const info = await sendMail(to, subject, html);
    res.status(200).json({ mensaje: 'Mail sent', info: info.response });
  } catch (error) {
    console.error('Error al enviar correo:', error);
    res.status(500).json({ error: 'Error al enviar correo', detalle: error.message });
  }
}

module.exports = { handleSendMail };