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

    // Intentar actualizar en tabla de templates
    const { error: templateError, count } = await supabase
      .from("invitation_message_dispatches")
      .update({
        status: newStatus,
        recipient_id: recipientId,
        raw_webhook: statusItem,
        ...(newStatus === 'delivered' && { delivered_at: new Date().toISOString() }),
      })
      .eq("meta_message_id", metaMessageId);

    if (templateError) console.error("Supabase template status update error:", templateError);

    // Intentar actualizar en tabla de freetext
    const { error: freetextError } = await supabase
      .from("whatsapp_freetext_dispatches")
      .update({
        status: newStatus,
        raw_webhook: statusItem,
        ...(newStatus === 'delivered' && { delivered_at: new Date().toISOString() }),
        ...(newStatus === 'read' && { read_at: new Date().toISOString() }),
      })
      .eq("meta_message_id", metaMessageId);

    if (freetextError) console.error("Supabase freetext status update error:", freetextError);
  }
};
const normalizePhone = (phone) => {
  // México: 5216XXXXXXXXX → 526XXXXXXXXX
  // Quita el "1" después del código de país 52
  if (phone.startsWith('521') && phone.length === 13) {
    return '52' + phone.slice(3);
  }
  return phone;
};


const findMatchingDispatch = async (fromPhone, messageTimestamp) => {
  const normalizedPhone = normalizePhone(fromPhone);

  // Formato para buscar en guests (ellos guardan con +)
  const phoneWithPlus = normalizedPhone.startsWith('+')
    ? normalizedPhone
    : `+${normalizedPhone}`;

  // 1. Buscar en guests por número de teléfono
  const { data: guests, error: guestsError } = await supabase
    .from("guests")
    .select("id, invitation_id, phone_number")
    .eq("phone_number", phoneWithPlus);

  if (guestsError || !guests || guests.length === 0) {
    // No encontró en guests, fallback a lógica original de ventana de tiempo
    return await findDispatchByTimeWindow(normalizedPhone, messageTimestamp);
  }

  // 2. Si está en un solo evento
  if (guests.length === 1) {
    const { data: dispatch } = await supabase
      .from("invitation_message_dispatches")
      .select("id")
      .eq("invitation_id", guests[0].invitation_id)
      .eq("guest_phone", normalizedPhone)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    return dispatch?.id || null;
  }

  // 3. Si está en dos o más eventos, buscar el template más reciente
  const invitationIds = guests.map(g => g.invitation_id);

  const { data: dispatch } = await supabase
    .from("invitation_message_dispatches")
    .select("id, invitation_id, created_at")
    .eq("guest_phone", normalizedPhone)
    .in("invitation_id", invitationIds)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  return dispatch?.id || null;
};

const findDispatchByTimeWindow = async (normalizedPhone, messageTimestamp) => {
  const REPLY_WINDOW_HOURS = 72;
  const windowCutoff = new Date(messageTimestamp);
  windowCutoff.setHours(windowCutoff.getHours() - REPLY_WINDOW_HOURS);

  const { data, error } = await supabase
    .from("invitation_message_dispatches")
    .select("id, guest_phone, delivered_at")
    .eq("guest_phone", normalizedPhone)
    .not("delivered_at", "is", null)
    .lte("delivered_at", messageTimestamp)
    .gte("delivered_at", windowCutoff.toISOString())
    .order("delivered_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return null;
  return data.id;
};


const extractMessageContent = (message) => {
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
      return { body: message.button?.text ?? null, mediaId: null };
    case 'interactive':
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
  const contactMap = Object.fromEntries(
    contacts.map((c) => [c.wa_id, c.profile?.name ?? null])
  );

  for (const message of messages) {
    const { body, mediaId } = extractMessageContent(message);
    const messageTimestamp = new Date(Number(message.timestamp) * 1000).toISOString();

    // Intentar linkear por context explícito (reply) primero
    let dispatchId = null;

    if (message.context?.id) {
      const { data } = await supabase
        .from("invitation_message_dispatches")
        .select("id")
        .eq("meta_message_id", message.context.id)
        .single();

      dispatchId = data?.id ?? null;
    }

    // Si no hubo reply explícito, usar ventana de delivered_at
    if (!dispatchId) {
      dispatchId = await findMatchingDispatch(message.from, messageTimestamp);
    }

    const record = {
      wa_message_id: message.id,
      from_phone: normalizePhone(message.from),
      contact_name: contactMap[message.from] ?? null,
      message_type: message.type,
      message_body: body,
      media_id: mediaId,
      timestamp: messageTimestamp,
      raw_message: message,
      dispatch_id: dispatchId,
    };

    console.log("Incoming message from:", message.from, "|", message.type, "| dispatch:", dispatchId ?? "no match");

    const { error } = await supabase
      .from("whatsapp_incoming_messages")
      .upsert(record, { onConflict: "wa_message_id" });

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

        if (value.statuses?.length) {
          await processStatuses(value.statuses);
        }

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