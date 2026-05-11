const express = require('express');
const supabase = require('../config/supabase');


const verifyWhatsappWebhook = async (req, res = express.response) => {
  try {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.WA_WEBHOOK_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }

    return res.sendStatus(403);
  } catch (error) {
    console.error('Error verifying WhatsApp webhook:', error.message);
    return res.status(500).json({
      ok: false,
      msg: 'Error verifying WhatsApp webhook',
      error: error.message,
    });
  }
};


// ── Helpers ────────────────────────────────────────────────────────────────

const processStatuses = async (statuses) => {
  for (const statusItem of statuses) {
    const { id: metaMessageId, status: newStatus, recipient_id: recipientId } = statusItem;

    console.log("Status update:", metaMessageId, newStatus);

    const { error } = await supabase
      .from("invitation_message_dispatches")
      .update({
        status: newStatus,
        recipient_id: recipientId,
        raw_webhook: statusItem,
      })
      .eq("meta_message_id", metaMessageId);

    if (error) console.error("Supabase status update error:", error);
  }
};


const extractMessageContent = (message) => {
  // Devuelve { body, mediaId } según el tipo de mensaje
  switch (message.type) {
    case 'text':
      return { body: message.text?.body ?? null, mediaId: null };
    case 'image':
      return { body: message.image?.caption ?? null, mediaId: message.image?.id ?? null };
    case 'video':
      return { body: message.video?.caption ?? null, mediaId: message.video?.id ?? null };
    case 'audio':
      return { body: null, mediaId: message.audio?.id ?? null };
    case 'document':
      return { body: message.document?.filename ?? null, mediaId: message.document?.id ?? null };
    case 'sticker':
      return { body: null, mediaId: message.sticker?.id ?? null };
    case 'location':
      return {
        body: `lat:${message.location?.latitude}, lng:${message.location?.longitude}`,
        mediaId: null,
      };
    case 'button':
      // Respuesta a botones de template
      return { body: message.button?.text ?? null, mediaId: null };
    case 'interactive':
      // Respuesta a listas o botones interactivos
      return {
        body:
          message.interactive?.button_reply?.title ??
          message.interactive?.list_reply?.title ??
          null,
        mediaId: null,
      };
    default:
      return { body: null, mediaId: null };
  }
};


const processIncomingMessages = async (messages, contacts = []) => {
  // Construir mapa de contactos para enriquecer con nombre
  const contactMap = Object.fromEntries(
    contacts.map((c) => [c.wa_id, c.profile?.name ?? null])
  );

  for (const message of messages) {
    const { body, mediaId } = extractMessageContent(message);

    const record = {
      wa_message_id: message.id,
      from_phone: message.from,
      contact_name: contactMap[message.from] ?? null,
      message_type: message.type,
      message_body: body,
      media_id: mediaId,
      timestamp: new Date(Number(message.timestamp) * 1000).toISOString(),
      raw_message: message,
    };

    console.log("Incoming message from:", message.from, "|", message.type);

    const { error } = await supabase
      .from("whatsapp_incoming_messages")
      .upsert(record, { onConflict: "wa_message_id" }); // evita duplicados si el webhook reintenta

    if (error) console.error("Supabase insert error:", error);
  }
};


// ── Controlador principal ──────────────────────────────────────────────────

const receiveWhatsappWebhook = async (req, res) => {
  try {
    const body = req.body;

    if (!body.entry) return res.sendStatus(200);

    for (const entry of body.entry) {
      if (!entry.changes) continue;

      for (const change of entry.changes) {
        const value = change.value;
        if (!value) continue;

        // Actualizaciones de estado (sent, delivered, read, failed)
        if (value.statuses?.length) {
          await processStatuses(value.statuses);
        }

        // Mensajes entrantes de destinatarios
        if (value.messages?.length) {
          await processIncomingMessages(value.messages, value.contacts ?? []);
        }
      }
    }

    return res.sendStatus(200);
  } catch (error) {
    console.error("Webhook error:", error);
    return res.sendStatus(500);
  }
};


module.exports = {
  verifyWhatsappWebhook,
  receiveWhatsappWebhook,
};