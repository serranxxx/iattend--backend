const express = require('express');
const axios = require('axios');
const supabase = require('../config/supabase');


const sendWhatsappTemplate = async (req, res = express.response) => {
  try {

    const {
      invitationId,
      guestId,
      guestName,
      guestPhone,
      ...payload
    } = req.body;

    // validación mínima para evitar mandar basura
    if (!payload?.to || !payload?.template?.name || !payload?.template?.language?.code) {
      return res.status(400).json({
        ok: false,
        msg: 'Invalid payload. Required: to, template.name, template.language.code',
        data: null
      });
    }

    if (!invitationId || !guestId || !guestPhone) {
      return res.status(400).json({
        ok: false,
        msg: 'Missing required fields: invitationId, guestId, guestPhone',
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

    const metaMessageId = data?.messages?.[0]?.id || null;

    const { data: dispatch, error: dispatchError } = await supabase
      .from('invitation_message_dispatches')
      .insert({
        invitation_id: invitationId,
        guest_id: guestId,
        guest_name: guestName || null,
        guest_phone: guestPhone,
        meta_message_id: metaMessageId,
        status: 'processing',
        raw_send_response: data
      })
      .select()
      .single();

    if (dispatchError) {
      console.error('Error saving dispatch in Supabase:', dispatchError);

      return res.status(500).json({
        ok: false,
        msg: 'WhatsApp message sent but failed to save dispatch in Supabase',
        error: dispatchError.message,
        data
      });
    }

    return res.status(200).json({
      ok: true,
      msg: 'WhatsApp template sent',
      data,
      dispatch
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
