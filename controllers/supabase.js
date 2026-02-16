const supabase = require("../config/supabase");

/**
 * Catálogo de productos indexado por priceId
 */
const PRODUCTS = {
  price_1T1DRoAAdNlITNVbLwiUVWAj: { type: "credits", value: 3 },
  price_1Sx8PvAAdNlITNVbchl6tJBW: { type: "credits", value: 50 },
  price_1Sx8QpAAdNlITNVbIod9MW44: { type: "credits", value: 100 },
  price_1Sx8RWAAdNlITNVbj7c85GlG: { type: "credits", value: 200 },
  // price_1T1H17AAdNlITNVbrTS94Xdr: { type: "credits", value: 1 },

  price_1SkRvtAAdNlITNVbj8BA6F2Q: { type: "plan", value: "paperless" },
  price_1SkRwZAAdNlITNVbEsPlYN0F: { type: "plan", value: "lite" },
  price_1SkRxCAAdNlITNVbB0AB16LN: { type: "plan", value: "pro" },

  price_1T1VeXAAdNlITNVbXeWLTh3Y: { type: "side", value: "side_event" },
  price_1T1WY5AAdNlITNVbGrRJx77i: {type: "side", value: "side_event"}
};

/**
 * Procesa el pago desde una sesión de Stripe
 */
async function processingPayment(session) {

  console.log('session: ', session.object)
  if (!session?.metadata) return;

  const { invitationId, priceId } = session.metadata;
  if (!invitationId || !priceId) return;

  const product = PRODUCTS[priceId];
  if (!product) return;

  switch (product.type) {
    case "credits":
      await incrementCredits(invitationId, product.value);
      break;

    case "side":
      await addSideEvent(invitationId);
      break;

    case "plan":
      await activatePlan(invitationId, product.value);
      break;

    default:
      break;
  }
}

/**
 * Incremento atómico de créditos
 */
async function incrementCredits(invitationId, amount) {
  console.log('credtis: ', amount)
  const { error } = await supabase.rpc("increment_invitation_credits", {
    invitation_id: invitationId,
    amount
  });

  if (error) {
    console.error("Error incrementando créditos:", error);
  }
}

/**
 * Inserta un side event por defecto
 */
async function addSideEvent(invitationId) {
  console.log('side_event to: ', invitationId)
  const defaultBody = {
    address: {
      street: null,
      number: null,
      neighborhood: null,
      zipcode: null,
      country: null,
      state: null,
      city: null,
      url: null
    },
    hour: null,
    image: null,
    title: {
      font: "Poppins",
      size: 36,
      weight: 600,
      opacity: 1,
      line_height: 1.4
    },
    font: "Poppins",
    color: "#000000",
    extras: null
  };

  const { error } = await supabase
    .from("side_events")
    .insert({
      invitation_id: invitationId,
      date: new Date().toISOString(),
      name: null,
      body: defaultBody
    });

  if (error) {
    console.error("Error creando side event:", error);
  }
}

/**
 * Activación de plan (placeholder para futura lógica)
 */
async function activatePlan(invitationId, planName) {
  const { error } = await supabase
    .from("invitations")
    .update({ plan: planName })
    .eq("id", invitationId);

  if (error) {
    console.error("Error activando plan:", error);
  }
}

module.exports = {
  processingPayment
};
