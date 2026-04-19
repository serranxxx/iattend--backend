const supabase = require("../config/supabase");

/**
 * Catálogo de productos indexado por priceId
 */
const PRODUCTS = {
  price_1T1DRoAAdNlITNVbLwiUVWAj: { type: "credits", value: 3 },
  price_1Sx8PvAAdNlITNVbchl6tJBW: { type: "credits", value: 50 },
  price_1Sx8QpAAdNlITNVbIod9MW44: { type: "credits", value: 100 },
  price_1Sx8RWAAdNlITNVbj7c85GlG: { type: "credits", value: 200 },
  price_1T1H17AAdNlITNVbrTS94Xdr: { type: "credits", value: 1 },

  price_1SkRvtAAdNlITNVbj8BA6F2Q: { type: "plan", value: "paperless" },
  price_1SkRwZAAdNlITNVbEsPlYN0F: { type: "plan", value: "lite" },
  price_1SkRxCAAdNlITNVbB0AB16LN: { type: "plan", value: "pro" },
  price_1TO1kjAAdNlITNVbmfuaY1nm: { type: "plan", value: "pro" },

  price_1T1VeXAAdNlITNVbXeWLTh3Y: { type: "side", value: "side_event" },
  price_1T1WY5AAdNlITNVbGrRJx77i: {type: "side", value: "side_event"}
};

/**
 * Procesa el pago desde una sesión de Stripe
 */
async function processingPayment(session) {

  console.log("🔔 [webhook] processingPayment iniciado");
  console.log("🔔 [webhook] session.metadata:", JSON.stringify(session.metadata));

  if (!session?.metadata) {
    console.log("❌ [webhook] Sin metadata, abortando");
    return;
  }

  const { invitationId, userId, priceId } = session.metadata;
  console.log(`🔔 [webhook] invitationId=${invitationId} | userId=${userId} | priceId=${priceId}`);

  if (!priceId) {
    console.log("❌ [webhook] Sin priceId, abortando");
    return;
  }

  const product = PRODUCTS[priceId];
  console.log("🔔 [webhook] product:", product);

  if (!product) {
    console.log("❌ [webhook] priceId no encontrado en PRODUCTS, abortando");
    return;
  }

  // Compra de nueva invitación (sin invitationId existente)
  if (!invitationId && userId) {
    console.log("🔔 [webhook] Ruta: nueva invitación con userId");
    if (product.type === "plan") {
      await createInvitationWithPlan(userId, product.value, session.metadata);
    } else {
      console.log(`❌ [webhook] product.type=${product.type}, se esperaba 'plan'`);
    }
    return;
  }

  if (!invitationId) {
    console.log("❌ [webhook] Sin invitationId ni userId, abortando");
    return;
  }

  console.log(`🔔 [webhook] Ruta: invitación existente id=${invitationId}`);
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
      console.log(`❌ [webhook] product.type desconocido: ${product.type}`);
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
 * Inserta una invitación pendiente antes del pago y devuelve su ID
 */
async function createPendingInvitation(invitation) {
  const { data, error } = await supabase
    .from("invitations")
    .insert([invitation])
    .select("id")
    .single();

  if (error) {
    console.error("Error creando invitación pendiente:", error);
    return null;
  }

  return data.id;
}

/**
 * Crea una nueva invitación en Supabase con el plan comprado
 */
async function createInvitationWithPlan(userId, planName, metadata = {}) {
  const { name, phoneNumber, label, userEmail } = metadata;

  const payload = {
    user_id: userId,
    user_email: userEmail || null,
    plan: planName,
    label: label || null,
    name: name || null,
    phone_number: phoneNumber || null,
    type: "closed",
    active: true,
    credits: planName === "pro" ? 300 : 0,
    tickets: 300,
    owners: [],
    url_image: null,
    data: null,
  };

  console.log("🔔 [webhook] createInvitationWithPlan payload:", JSON.stringify(payload));

  const { error } = await supabase.from("invitations").insert(payload);

  if (error) {
    console.error("❌ [webhook] Error creando invitación:", JSON.stringify(error));
  } else {
    console.log("✅ [webhook] Invitación creada correctamente");
  }
}

/**
 * Activación de plan (placeholder para futura lógica)
 */
async function activatePlan(invitationId, planName) {
  const { error } = await supabase
    .from("invitations")
    .update({ plan: planName, active: true })
    .eq("id", invitationId);

  if (error) {
    console.error("Error activando plan:", error);
  }
}

module.exports = {
  processingPayment
};
