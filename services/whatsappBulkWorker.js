// Worker de envío masivo de invitaciones (bulk shipment).
//
// La cola vive en Supabase (invitation_send_batches / _items), no en memoria:
// si el proceso se redeploya a media tanda, resumePendingBatches() retoma los
// lotes 'processing' al arrancar y continúa desde los items 'queued'.
//
// Cada item repite el flujo del envío individual (POST a Graph API + insert
// en invitation_message_dispatches + marcar guests como 'esperando'), pero a
// ritmo controlado y con reintentos ante rate limit de Meta. El código de
// envío se duplica a propósito en vez de refactorizar sendWhatsappTemplate:
// el flujo del envío inicial individual no se toca.

const axios = require('axios');
const supabase = require('../config/supabase');

const SEND_INTERVAL_MS = 400;          // ~2.5 msg/s
const RATE_LIMIT_BACKOFF_MS = 30000;   // pausa cuando Meta reporta rate limit
const MAX_RATE_LIMIT_RETRIES = 3;      // por item

// Códigos de rate limit de WhatsApp Cloud API
const RATE_LIMIT_CODES = new Set([4, 80007, 130429, 131048, 131056]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Guard para no procesar el mismo lote dos veces (resume + request simultáneos)
const activeBatches = new Set();

const isRateLimitError = (error) => {
  const code = error?.response?.data?.error?.code;
  return RATE_LIMIT_CODES.has(code) || error?.response?.status === 429;
};

// Mismo patch que hace el frontend en el envío individual: el bloque completo
// (principal + acompañantes) pasa a 'esperando'.
const markGuestAsInvited = async (guestId) => {
  const nowIso = new Date().toISOString();
  const guestPatch = {
    state: 'esperando',
    last_action: 'creado',
    last_action_by: 'admin',
    last_update_date: nowIso,
    invitation_sent_at: nowIso,
  };

  const { error: leaderError } = await supabase
    .from('guests')
    .update(guestPatch)
    .eq('id', guestId);

  if (leaderError) console.error('[bulk] error marcando principal', guestId, leaderError.message);

  const { error: companionsError } = await supabase
    .from('guests')
    .update(guestPatch)
    .eq('companion_id', guestId);

  if (companionsError) console.error('[bulk] error marcando acompañantes de', guestId, companionsError.message);
};

// Variante para side events: espejo del onSendInvitation de SideEvents.jsx —
// solo el guest (ese flujo no propaga a acompañantes) y sin invitation_sent_at
// (la columna no existe en side_events_guests).
const markSideGuestAsInvited = async (guestId) => {
  const { error } = await supabase
    .from('side_events_guests')
    .update({
      state: 'esperando',
      last_action: 'creado',
      last_action_by: true,
      last_update_date: new Date().toISOString(),
    })
    .eq('id', guestId);

  if (error) console.error('[bulk] error marcando side guest', guestId, error.message);
};

const sendItem = async (item) => {
  const phoneNumberId = process.env.WA_PHONE_NUMBER_ID;
  const token = process.env.WA_ACCESS_TOKEN;
  const url = `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`;

  let retries = 0;
  for (;;) {
    try {
      const { data } = await axios.post(url, item.payload, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      return data;
    } catch (error) {
      if (isRateLimitError(error) && retries < MAX_RATE_LIMIT_RETRIES) {
        retries += 1;
        console.warn(`[bulk] rate limit de Meta — pausa de ${RATE_LIMIT_BACKOFF_MS / 1000}s (retry ${retries})`);
        await sleep(RATE_LIMIT_BACKOFF_MS);
        continue;
      }
      throw error;
    }
  }
};

const processBatch = async (batchId) => {
  if (activeBatches.has(batchId)) return;
  activeBatches.add(batchId);

  try {
    for (;;) {
      const { data: item, error: itemError } = await supabase
        .from('invitation_send_batch_items')
        .select('*')
        .eq('batch_id', batchId)
        .eq('status', 'queued')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (itemError) {
        console.error('[bulk] error leyendo cola:', itemError.message);
        break;
      }

      if (!item) break; // cola vacía → cerrar lote

      let sent = false;
      let errorDetail = null;

      try {
        const data = await sendItem(item);
        const metaMessageId = data?.messages?.[0]?.id || null;

        const { error: dispatchError } = await supabase
          .from('invitation_message_dispatches')
          .insert({
            invitation_id: item.invitation_id,
            guest_id: item.guest_id,
            guest_name: item.guest_name || null,
            guest_phone: item.guest_phone,
            meta_message_id: metaMessageId,
            status: 'processing',
            raw_send_response: data,
          });

        if (dispatchError) console.error('[bulk] error guardando dispatch:', dispatchError.message);

        if (item.side_event_id) {
          await markSideGuestAsInvited(item.guest_id);
        } else {
          await markGuestAsInvited(item.guest_id);
        }
        sent = true;
      } catch (error) {
        errorDetail = JSON.stringify(error?.response?.data?.error ?? { message: error.message });
        console.error('[bulk] envío fallido para guest', item.guest_id, errorDetail);
      }

      await supabase
        .from('invitation_send_batch_items')
        .update({
          status: sent ? 'sent' : 'failed',
          error_detail: errorDetail,
          processed_at: new Date().toISOString(),
        })
        .eq('id', item.id);

      // Contadores del lote (el worker es el único escritor del batch)
      const { data: batch } = await supabase
        .from('invitation_send_batches')
        .select('sent_count, failed_count')
        .eq('id', batchId)
        .maybeSingle();

      await supabase
        .from('invitation_send_batches')
        .update(sent
          ? { sent_count: (batch?.sent_count ?? 0) + 1 }
          : { failed_count: (batch?.failed_count ?? 0) + 1 })
        .eq('id', batchId);

      await sleep(SEND_INTERVAL_MS);
    }

    // Cierre del lote: status + reembolso de créditos por los fallidos
    const { data: finalBatch } = await supabase
      .from('invitation_send_batches')
      .select('invitation_id, failed_count, status')
      .eq('id', batchId)
      .maybeSingle();

    if (finalBatch && finalBatch.status === 'processing') {
      await supabase
        .from('invitation_send_batches')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', batchId);

      if ((finalBatch.failed_count ?? 0) > 0) {
        const { data: inv } = await supabase
          .from('invitations')
          .select('credits')
          .eq('id', finalBatch.invitation_id)
          .maybeSingle();

        if (inv) {
          const { error: refundError } = await supabase
            .from('invitations')
            .update({ credits: (inv.credits ?? 0) + finalBatch.failed_count })
            .eq('id', finalBatch.invitation_id);

          if (refundError) console.error('[bulk] error reembolsando créditos:', refundError.message);
          else console.log(`[bulk] lote ${batchId}: ${finalBatch.failed_count} créditos reembolsados`);
        }
      }
    }

    console.log(`[bulk] lote ${batchId} completado`);
  } finally {
    activeBatches.delete(batchId);
  }
};

// Al arrancar el servidor: retomar lotes que quedaron a medias por un
// redeploy/restart. Fire-and-forget, secuencial entre lotes.
const resumePendingBatches = async () => {
  try {
    const { data: pending, error } = await supabase
      .from('invitation_send_batches')
      .select('id')
      .eq('status', 'processing')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[bulk] error buscando lotes pendientes:', error.message);
      return;
    }

    if (!pending?.length) return;

    console.log(`[bulk] retomando ${pending.length} lote(s) pendiente(s)`);
    for (const batch of pending) {
      await processBatch(batch.id);
    }
  } catch (error) {
    console.error('[bulk] error en resume:', error.message);
  }
};

module.exports = { processBatch, resumePendingBatches };
