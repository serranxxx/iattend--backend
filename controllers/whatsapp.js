const express = require('express');
const axios = require('axios');
const supabase = require('../config/supabase');
const { processBatch } = require('../services/whatsappBulkWorker');


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

// Recordatorio manual (template `reminder`) — flujo separado del envío inicial
// a propósito: registra en invitation_reminder_dispatches (tabla propia, para
// que get_failed_dispatches no confunda un recordatorio fallido con una
// invitación inicial fallida) y actualiza el contador cacheado en guests.
// El descuento de crédito NO va aquí: lo hace el frontend tras el 200, igual
// que en el envío inicial.
const sendWhatsappReminder = async (req, res = express.response) => {
  try {

    const {
      invitationId,
      guestId,
      guestName,
      guestPhone,
      // side events: cuando viene sideEventId, guestId es el id de
      // side_events_guests (mismo patrón de ids mixto que usa
      // invitation_message_dispatches con los envíos de side events) y los
      // contadores se escriben en side_events_guests, no en guests.
      sideEventId,
      ...payload
    } = req.body;

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

    const counterTable = sideEventId ? 'side_events_guests' : 'guests';

    // reminder_count puede ser NULL en registros viejos → tratar como 0
    const { data: guestRow, error: guestReadError } = await supabase
      .from(counterTable)
      .select('reminder_count')
      .eq('id', guestId)
      .maybeSingle();

    if (guestReadError) console.error('Error reading guest reminder_count:', guestReadError);

    const reminderNumber = (guestRow?.reminder_count ?? 0) + 1;

    const { data: dispatch, error: dispatchError } = await supabase
      .from('invitation_reminder_dispatches')
      .insert({
        invitation_id: invitationId,
        guest_id: guestId,
        side_event_id: sideEventId ?? null,
        guest_name: guestName || null,
        guest_phone: guestPhone,
        meta_message_id: metaMessageId,
        template_name: payload.template.name,
        reminder_number: reminderNumber,
        trigger_source: 'manual',
        credit_charged: true,
        status: 'processing',
        raw_send_response: data
      })
      .select()
      .single();

    if (dispatchError) {
      console.error('Error saving reminder dispatch in Supabase:', dispatchError);

      return res.status(500).json({
        ok: false,
        msg: 'WhatsApp reminder sent but failed to save dispatch in Supabase',
        error: dispatchError.message,
        data
      });
    }

    // Contador solo en el principal (destinatario real) — nunca en acompañantes
    const { error: counterError } = await supabase
      .from(counterTable)
      .update({
        reminder_count: reminderNumber,
        last_reminder_at: new Date().toISOString()
      })
      .eq('id', guestId);

    if (counterError) console.error('Error updating guest reminder counter:', counterError);

    return res.status(200).json({
      ok: true,
      msg: 'WhatsApp reminder sent',
      data,
      dispatch
    });

  } catch (error) {
    console.error('Error sending WhatsApp reminder:', error?.response?.data || error.message);

    return res.status(500).json({
      ok: false,
      msg: 'Error sending WhatsApp reminder',
      error: error?.response?.data || error.message
    });
  }
};

// Envío masivo: crea el lote + items en Supabase y responde 202 de inmediato
// (sin timeouts por diseño). El worker procesa la cola en segundo plano.
// Los créditos NO se cobran aquí: el frontend reserva N al recibir el 202 y
// el worker reembolsa los fallidos al cerrar el lote.
const createWhatsappBulk = async (req, res = express.response) => {
  try {
    // sideEventId opcional: lote de un side event — los guestId de los items
    // son ids de side_events_guests y el worker marca en esa tabla.
    const { invitationId, sideEventId, items } = req.body;

    if (!invitationId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        ok: false,
        msg: 'Missing required fields: invitationId, items[]',
        data: null
      });
    }

    if (items.length > 500) {
      return res.status(400).json({
        ok: false,
        msg: 'Batch too large (max 500 items)',
        data: null
      });
    }

    const invalid = items.find((i) => !i?.guestId || !i?.guestPhone || !i?.payload?.to || !i?.payload?.template?.name);
    if (invalid) {
      return res.status(400).json({
        ok: false,
        msg: 'Every item requires guestId, guestPhone and a valid payload (to, template.name)',
        data: null
      });
    }

    const { data: batch, error: batchError } = await supabase
      .from('invitation_send_batches')
      .insert({
        invitation_id: invitationId,
        side_event_id: sideEventId ?? null,
        total: items.length,
        status: 'processing',
        credits_reserved: items.length
      })
      .select()
      .single();

    if (batchError) {
      console.error('Error creating send batch:', batchError);
      return res.status(500).json({ ok: false, msg: 'Error creating send batch', error: batchError.message });
    }

    const { error: itemsError } = await supabase
      .from('invitation_send_batch_items')
      .insert(items.map((i) => ({
        batch_id: batch.id,
        invitation_id: invitationId,
        side_event_id: sideEventId ?? null,
        guest_id: i.guestId,
        guest_name: i.guestName || null,
        guest_phone: i.guestPhone,
        payload: i.payload,
        status: 'queued'
      })));

    if (itemsError) {
      console.error('Error creating batch items:', itemsError);
      // sin items no hay nada que procesar — cerrar el lote como fallido
      await supabase.from('invitation_send_batches')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', batch.id);
      return res.status(500).json({ ok: false, msg: 'Error creating batch items', error: itemsError.message });
    }

    // fire-and-forget: el request no espera a que termine el lote
    processBatch(batch.id).catch((e) => console.error('[bulk] processBatch error:', e.message));

    return res.status(202).json({
      ok: true,
      msg: 'Batch accepted',
      data: { batchId: batch.id, total: items.length }
    });

  } catch (error) {
    console.error('Error creating bulk send:', error.message);
    return res.status(500).json({ ok: false, msg: 'Error creating bulk send', error: error.message });
  }
};

// Bloque Graph API reutilizable (webhook de prospectos IG lo usa directo, sin pasar por el dispatch de abajo)
const sendWhatsappFreeTextMessage = async (to, text) => {
  const phoneNumberId = process.env.WA_PHONE_NUMBER_ID;
  const token = process.env.WA_ACCESS_TOKEN;

  const normalizedPhone = to.startsWith('521') && to.length === 13
    ? to.replace('521', '52')
    : to;

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizedPhone,
    type: 'text',
    text: {
      preview_url: false,
      body: text,
    },
  };

  const { data } = await axios.post(
    `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return { data, normalizedPhone };
};

const sendWhatsappFreeText = async (req, res) => {
  try {
     const { to, text, invitation_id } = req.body;

    if (!to || !text || !invitation_id)  {
      return res.status(400).json({
        ok: false,
        msg: 'Missing required fields: to, text',
      });
    }

    const { data, normalizedPhone } = await sendWhatsappFreeTextMessage(to, text);

    const metaMessageId = data?.messages?.[0]?.id || null;

    const { data: dispatch, error: dispatchError } = await supabase
      .from('whatsapp_freetext_dispatches')
      .insert({
        meta_message_id: metaMessageId,
        to_phone: normalizedPhone,
        message_body: text,
        status: 'processing',
        invitation_id: invitation_id,  
        raw_send_response: data,
      })
      .select()
      .single();

    if (dispatchError) {
      console.error('Error saving freetext dispatch:', dispatchError);
      return res.status(500).json({
        ok: false,
        msg: 'WhatsApp message sent but failed to save in Supabase',
        error: dispatchError.message,
        data,
      });
    }

    return res.status(200).json({
      ok: true,
      msg: 'WhatsApp free text sent',
      data,
      dispatch,
    });

  } catch (error) {
    console.error('Error sending WhatsApp free text:', error?.response?.data || error.message);
    return res.status(500).json({
      ok: false,
      msg: 'Error sending WhatsApp free text',
      error: error?.response?.data || error.message,
    });
  }
};

module.exports = { sendWhatsappTemplate, sendWhatsappReminder, createWhatsappBulk, sendWhatsappFreeText, sendWhatsappFreeTextMessage };
