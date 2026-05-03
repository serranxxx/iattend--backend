require('dotenv').config();
const nodemailer = require('nodemailer');
const { giftEmailTemplate } = require('./templates/giftEmail');

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

async function handleSendGiftMail(req, res) {
  const { to, senderName, personalMessage, giftCode, activationLink } = req.body;

  if (!to || !senderName || !personalMessage || !giftCode || !activationLink) {
    return res.status(400).json({ error: 'Campos requeridos: to, senderName, personalMessage, giftCode, activationLink' });
  }

  try {
    const html = giftEmailTemplate({ senderName, personalMessage, giftCode, activationLink });
    const info = await sendMail(to, 'Alguien pensó en ti — I Attend 🎁', html);
    res.status(200).json({ mensaje: 'Gift email enviado', info: info.response });
  } catch (error) {
    console.error('Error enviando gift email:', error);
    res.status(500).json({ error: 'Error al enviar correo', detalle: error.message });
  }
}

module.exports = { handleSendMail, handleSendGiftMail, sendMail };