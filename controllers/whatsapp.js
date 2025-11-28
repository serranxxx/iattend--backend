const express = require('express');
const axios = require('axios');

const sendWhatsappTemplate = async (req, res = express.response) => {
  try {
    const payload = req.body; // viene completo desde el frontend

    // validación mínima para evitar mandar basura
    if (!payload?.to || !payload?.template?.name || !payload?.template?.language?.code) {
      return res.status(400).json({
        ok: false,
        msg: 'Invalid payload. Required: to, template.name, template.language.code',
        data: null
      });
    }

    const phoneNumberId = process.env.WA_PHONE_NUMBER_ID;
    const token = process.env.WA_ACCESS_TOKEN;

    const url = `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`;

    const { data } = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });

    return res.status(200).json({
      ok: true,
      msg: 'WhatsApp template sent',
      data
    });

  } catch (error) {
    console.error('Error sending WhatsApp template:', error?.response?.data || error.message);

    return res.status(500).json({
      ok: false,
      msg: 'Error sending WhatsApp template',
      error: error?.response?.data || error.message
    });
  }
};

module.exports = { sendWhatsappTemplate };
