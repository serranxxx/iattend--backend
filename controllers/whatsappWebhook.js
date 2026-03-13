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

const receiveWhatsappWebhook = async (req, res) => {
    try {
  
      const body = req.body;
  
    //   console.log("Webhook received:", JSON.stringify(body, null, 2));
  
      if (!body.entry) {
        return res.sendStatus(200);
      }
  
      for (const entry of body.entry) {
  
        if (!entry.changes) continue;
  
        for (const change of entry.changes) {
  
          const value = change.value;
  
          if (!value || !value.statuses) continue;
  
          for (const statusItem of value.statuses) {
  
            const metaMessageId = statusItem.id;
            const newStatus = statusItem.status;
            const recipientId = statusItem.recipient_id;
  
            console.log("Message update:", metaMessageId, newStatus);
  
            const { error } = await supabase
              .from("invitation_message_dispatches")
              .update({
                status: newStatus,
                recipient_id: recipientId,
                raw_webhook: statusItem
              })
              .eq("meta_message_id", metaMessageId);
  
            if (error) {
              console.error("Supabase update error:", error);
            }
  
          }
  
        }
  
      }
  
      return res.sendStatus(200);
  
    } catch (error) {
  
    //   console.error("Webhook error:", error);
  
      return res.sendStatus(500);
  
    }
  };

module.exports = {
  verifyWhatsappWebhook,
  receiveWhatsappWebhook,
};