const express = require('express');
const supabase = require('../config/supabase');

const MEDIA_TYPES_TO_DOWNLOAD = ['image', 'audio', 'document', 'sticker'];

// ── Verificación del webhook ───────────────────────────────────────────────

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

// ── Media helpers ─────────────────────────────────────────────────────────

const fetchMediaMeta = async (mediaId) => {
  const response = await fetch(
    `https://graph.facebook.com/v19.0/${mediaId}`,
    { headers: { Authorization: `Bearer ${process.env.WA_ACCESS_TOKEN}` } }
  );
  if (!response.ok) throw new Error(`Meta media meta error: ${response.statusText}`);
  return response.json(); // { url, mime_type, file_size, ... }
};

const downloadMedia = async (url) => {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.WA_ACCESS_TOKEN}` },
  });
  if (!response.ok) throw new Error(`Media download error: ${response.statusText}`);
  return Buffer.from(await response.arrayBuffer());
};

const uploadToStorage = async (mediaId, buffer, mimeType) => {
  const ext = mimeType?.split('/')[1]?.split(';')[0] ?? 'bin';
  const path = `whatsapp-media/${mediaId}.${ext}`;

  const { error } = await supabase.storage
    .from('media') // ← tu bucket
    .upload(path, buffer, { contentType: mimeType, upsert: true });

  if (error) throw new Error(`Storage upload error: ${error.message}`);

  return supabase.storage.from('media').getPublicUrl(path).data.publicUrl;
};

const resolveMediaUrl = async (mediaId) => {
  try {
    const { url, mime_type } = await fetchMediaMeta(mediaId);
    const buffer = await downloadMedia(url);
    return await uploadToStorage(mediaId, buffer, mime_type);
  } catch (err) {
    console.error('resolveMediaUrl error:', err.message);
    return null;
  }
};

// ── Status helpers ────────────────────────────────────────────────────────

const processStatuses = async (statuses) => {
  for (const statusItem of statuses) {
    const { id: metaMessageId, status: newStatus, recipient_id: recipientId } = statusItem;

    console.log("Status update:", metaMessageId, newStatus);

    const { error: templateError } = await supabase
      .from("invitation_message_dispatches")
      .update({
        status: newStatus,
        recipient_id: recipientId,
        raw_webhook: statusItem,
        ...(newStatus === 'delivered' && { delivered_at: new Date().toISOString() }),
      })
      .eq("meta_message_id", metaMessageId);

    if (templateError) console.error("Supabase template status update error:", templateError);

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

// ── Phone helpers ─────────────────────────────────────────────────────────

const normalizePhone = (phone) => {
  if (phone.startsWith('521') && phone.length === 13) {
    return '52' + phone.slice(3);
  }
  return phone;
};

// ── Dispatch matching ─────────────────────────────────────────────────────

const findMatchingDispatch = async (fromPhone, messageTimestamp) => {
  const normalizedPhone = normalizePhone(fromPhone);
  const phoneWithPlus = normalizedPhone.startsWith('+')
    ? normalizedPhone
    : `+${normalizedPhone}`;

  const { data: guests, error: guestsError } = await supabase
    .from("guests")
    .select("id, invitation_id, phone_number")
    .eq("phone_number", phoneWithPlus);

  if (guestsError || !guests || guests.length === 0) {
    return await findDispatchByTimeWindow(normalizedPhone, messageTimestamp);
  }

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
  const REPLY_WINDOW_HOURS = 172;
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

// ── Message content extractor ─────────────────────────────────────────────

const extractMessageContent = (message) => {
  switch (message.type) {
    case 'text':
      return { body: message.text?.body ?? null, mediaId: null, reactedToId: null };
    case 'image':
      return { body: message.image?.caption ?? null, mediaId: message.image?.id ?? null, reactedToId: null };
    case 'video':
      return { body: message.video?.caption ?? null, mediaId: message.video?.id ?? null, reactedToId: null };
    case 'audio':
      return { body: null, mediaId: message.audio?.id ?? null, reactedToId: null };
    case 'document':
      return { body: message.document?.filename ?? null, mediaId: message.document?.id ?? null, reactedToId: null };
    case 'sticker':
      return { body: null, mediaId: message.sticker?.id ?? null, reactedToId: null };
    case 'reaction':
      return { body: message.reaction?.emoji ?? null, mediaId: null, reactedToId: message.reaction?.message_id ?? null };
    case 'location':
      return { body: `lat:${message.location?.latitude}, lng:${message.location?.longitude}`, mediaId: null, reactedToId: null };
    case 'button':
      return { body: message.button?.text ?? null, mediaId: null, reactedToId: null };
    case 'interactive':
      return {
        body: message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title ?? null,
        mediaId: null,
        reactedToId: null,
      };
    default:
      return { body: null, mediaId: null, reactedToId: null };
  }
};

// ── Procesamiento de mensajes entrantes ───────────────────────────────────

const processIncomingMessages = async (messages, contacts = []) => {
  const contactMap = Object.fromEntries(
    contacts.map((c) => [c.wa_id, c.profile?.name ?? null])
  );

  for (const message of messages) {
    const { body, mediaId, reactedToId } = extractMessageContent(message);
    const messageTimestamp = new Date(Number(message.timestamp) * 1000).toISOString();

    // Descargar y subir a storage solo los tipos que no son video
    let mediaUrl = null;
    if (mediaId && MEDIA_TYPES_TO_DOWNLOAD.includes(message.type)) {
      mediaUrl = await resolveMediaUrl(mediaId);
    }

    let dispatchId = null;

    if (message.context?.id) {
      const { data } = await supabase
        .from("invitation_message_dispatches")
        .select("id")
        .eq("meta_message_id", message.context.id)
        .single();
      dispatchId = data?.id ?? null;
    }

    if (!dispatchId) {
      dispatchId = await findMatchingDispatch(message.from, messageTimestamp);
    }

    const record = {
      wa_message_id:          message.id,
      from_phone:              normalizePhone(message.from),
      contact_name:            contactMap[message.from] ?? null,
      message_type:            message.type,
      message_body:            body,
      media_id:                mediaId ?? null,
      media_url:               mediaUrl ?? null,
      reacted_to_message_id:  reactedToId ?? null,
      timestamp:               messageTimestamp,
      raw_message:             message,
      dispatch_id:             dispatchId,
    };

    console.log(
      `[WA] from:${message.from} | type:${message.type}`,
      mediaId ? `| media:${mediaUrl ?? 'id-only (video)'}` : '',
      `| dispatch:${dispatchId ?? 'no match'}`
    );

    const { error } = await supabase
      .from("whatsapp_incoming_messages")
      .upsert(record, { onConflict: "wa_message_id" });

    if (error) console.error("Supabase upsert error:", error);
  }
};

// ── Controlador principal ─────────────────────────────────────────────────

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

// ── Endpoint on-demand para videos ───────────────────────────────────────

const getWhatsappMediaUrl = async (req, res) => {
  try {
    const { mediaId } = req.params;

    const metaRes = await fetch(
      `https://graph.facebook.com/v19.0/${mediaId}`,
      { headers: { Authorization: `Bearer ${process.env.WA_ACCESS_TOKEN}` } }
    );
    if (!metaRes.ok) throw new Error(`Meta metadata error: ${metaRes.statusText}`);
    const { url, mime_type } = await metaRes.json();

    const mediaRes = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.WA_ACCESS_TOKEN}` }
    });
    if (!mediaRes.ok) throw new Error(`Meta download error: ${mediaRes.statusText}`);

    res.setHeader('Content-Type', mime_type ?? 'video/mp4');
    res.setHeader('Content-Disposition', `inline; filename="${mediaId}.mp4"`);

    // ← Convertir Web ReadableStream a Node stream
    const { Readable } = require('stream');
    Readable.fromWeb(mediaRes.body).pipe(res);

  } catch (error) {
    console.error('getWhatsappMediaUrl error:', error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
};

module.exports = {
  verifyWhatsappWebhook,
  receiveWhatsappWebhook,
  getWhatsappMediaUrl,
};