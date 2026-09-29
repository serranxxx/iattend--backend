const { registrarVentaEcommerce } = require('./ventasEcommerce');
const supabase = require("../config/supabase");
const { sendMail } = require("./mailer");
const { giftEmailTemplate } = require("./templates/giftEmail");
const { PRODUCTS } = require("../config/stripe.products");
const { getPlan, getPlanByPriceId, planEntitlements } = require("../config/plans");

/**
 * Guarda preview data en checkout_queue y devuelve el ID
 */
async function createCheckoutQueue(userId, userEmail, data) {
  const { data: row, error } = await supabase
    .from("checkout_queue")
    .insert({ user_id: userId, user_email: userEmail || null, data: data || null })
    .select("id")
    .single();

  if (error) {
    console.error("Error guardando checkout queue:", error);
    return null;
  }
  return row.id;
}

/**
 * Crea la invitación final a partir del queue (se llama desde el webhook)
 */
async function createInvitationFromQueue(queueId, planName) {
  const { data: entry, error: fetchError } = await supabase
    .from("checkout_queue")
    .select("*")
    .eq("id", queueId)
    .single();

  if (fetchError || !entry) {
    console.error("checkout_queue entry no encontrado:", queueId, fetchError);
    return;
  }

  const { user_id, user_email, data } = entry;

  const entitlements = await planEntitlements(planName);

  const payload = {
    user_id,
    user_email: user_email || null,
    plan: planName,
    label: data?.generals?.event?.label || null,
    name: data?.generals?.event?.name || null,
    phone_number: null,
    type: "closed",
    active: true,
    ...entitlements,
    tickets: 300,
    owners: [],
    url_image: null,
    data: data || {},
  };

  const { data: creada, error: insertError } = await supabase
    .from("invitations")
    .insert(payload)
    .select("id")
    .single();

  if (insertError) {
    console.error("Error creando invitación desde queue:", insertError);
    return null;
  }

  await supabase.from("checkout_queue").delete().eq("id", queueId);
  return creada?.id ?? null;
}

/**
 * Procesa el pago desde una sesión de Stripe
 */
async function processingPayment(session) {

  if (!session?.metadata) return;

  const { invitationId, userId, queueId, priceId, giftType } = session.metadata;
  if (!priceId) return;

  if (giftType === "gift") {
    await processGiftPayment(session.metadata);
    return;
  }

  // Price nuevo puesto desde Admin → Planes que todavía no está en
  // stripe.products.js: se resuelve contra el catálogo.
  const catalogPlan = PRODUCTS[priceId] ? null : await getPlanByPriceId(priceId);
  const product = PRODUCTS[priceId] || (catalogPlan && { type: "plan", value: catalogPlan.id });
  if (!product) return;

  // Preview/checkout flow: create invitation from queued data after payment
  if (queueId && product.type === "plan") {
    const nuevaId = await createInvitationFromQueue(queueId, product.value);
    await registrarVentaEcommerce({ invitationId: nuevaId, planName: product.value, session });
    return;
  }

  if (!invitationId && userId) {
    if (product.type === "plan") {
      const nuevaId = await createInvitationWithPlan(userId, product.value, session.metadata);
      await registrarVentaEcommerce({ invitationId: nuevaId, planName: product.value, session });
    }
    return;
  }

  if (!invitationId) return;

  switch (product.type) {
    case "credits":
      await incrementCredits(invitationId, product.value);
      break;
    case "side":
      await addSideEvent(invitationId);
      break;
    case "plan":
      await activatePlan(invitationId, product.value);
      await registrarVentaEcommerce({ invitationId, planName: product.value, session });
      break;
    default:
      break;
  }
}

/**
 * Incremento atómico de créditos
 */
async function incrementCredits(invitationId, amount) {
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

  // El side event comprado también sube el tope: si no, quedaría contado
  // contra los incluidos del plan. Se sube aunque el insert falle: ya se
  // cobró, y con el tope arriba el organizador puede crearlo él mismo.
  const { data: inv, error: fetchError } = await supabase
    .from("invitations")
    .select("side_events_included")
    .eq("id", invitationId)
    .single();

  if (fetchError || !inv) {
    console.error("Error leyendo tope de side events:", fetchError);
    return;
  }

  const { error: capError } = await supabase
    .from("invitations")
    .update({ side_events_included: (inv.side_events_included ?? 0) + 1 })
    .eq("id", invitationId);

  if (capError) {
    console.error("Error subiendo tope de side events:", capError);
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
  const { name, phoneNumber, label, userEmail, owners: ownersRaw } = metadata;
  const owners = ownersRaw ? JSON.parse(ownersRaw) : [];

  const entitlements = await planEntitlements(planName);

  const payload = {
    user_id: userId,
    user_email: userEmail || null,
    plan: planName,
    label: label || null,
    name: name || null,
    phone_number: phoneNumber || null,
    type: "closed",
    active: true,
    ...entitlements,
    tickets: 300,
    owners,
    url_image: null,
    data: {
      cover: {
        date: { type: null, color: "#FFFFFF", value: "2026-05-20T00:00:00.000Z", active: true },
        image: { dev: null, blur: false, prod: "https://jblcqcxckefmydvtrxbi.supabase.co/storage/v1/object/public/user_images/14376896-4930-4429-b427-96e047695396/1769460961115-couple.jpeg", zoom: 1, position: { x: 0, y: 0 }, background: true },
        title: { text: { size: 54, color: "#ffffff", value: "Andrés & Julieta", weight: 1000, opacity: 0.95, typeFace: "WindSong" }, position: { align_x: "center", align_y: "flex-end", column_reverse: "column" } },
      },
      gifts: {
        cards: [
          { url: "https://www.amazon.com.mx/", bank: null, kind: "store", name: null, brand: "Palacio de hierro", number: null },
          { url: "https://www.amazon.com.mx/", bank: null, kind: "store", name: null, brand: "Sears", number: null },
          { url: null, bank: "BBVA", kind: "bank", name: "Luis Serrano", brand: null, number: "4242424242424242" },
        ],
        title: "MESA DE REGALOS", active: true, inverted: true, separator: false, background: false,
        description: "¡Tu presencia es el mejor regalo, pero tus buenos deseos se hacen aún más especiales con un toque personal!",
        dynamic_separator: { type: "single", image: { zoom: 1, value: null, width: 100, height: 300, position: { x: 0, y: 0 } }, active: false, single: { color: "#252525", value: 5 } },
        dynamic_background: { color: "#939faf", shape: "square", width: 90, active: false, shadow: true, texture: null, border_radius: 0 },
      },
      quote: {
        text: { font: { size: 18, color: "#ffffff", value: "Nuestro amor es el comienzo de un 'para siempre' que no tiene final.", weight: 500, opacity: 0.87, typeFace: "Noto Sans" }, align: "flex-start", width: 90, shadow: false, justify: "center" },
        image: { dev: null, prod: "https://firebasestorage.googleapis.com/v0/b/iattend-df79a.appspot.com/o/invitations%2F66a31dc63d724e3f40549b95%2Fquote%2FLyPl6vhxCk?alt=media&token=17b6cda0-8146-4100-8f19-2f86f306883a", active: true },
        active: true, inverted: false, separator: false, background: false,
        dynamic_separator: { type: "single", image: { zoom: 1, value: null, width: 100, height: 300, position: { x: 0, y: 0 } }, active: false, single: { color: "#252525", value: 5 } },
        dynamic_background: { color: "#939faf", shape: "square", width: 90, active: false, shadow: true, texture: null, border_radius: 0 },
      },
      people: {
        title: "Nuestros padres", active: true, inverted: true, separator: false, background: false,
        personas: [
          { title: "Padre del novio", description: "Manuel Velázquez " },
          { title: "Madre del novio", description: "María Lourdes " },
          { title: "Padre de la novia", description: "Edgar González " },
          { title: "Madre de la novia", description: "Ericka Gutiérrez " },
        ],
        dynamic_separator: { type: "single", image: { zoom: 1, value: null, width: 100, height: 300, position: { x: 0, y: 0 } }, active: false, single: { color: "#252525", value: 5 } },
        dynamic_background: { color: "#939faf", shape: "square", width: 90, active: true, shadow: true, texture: null, border_radius: 0 },
      },
      gallery: {
        dev: null,
        prod: [
          "https://firebasestorage.googleapis.com/v0/b/iattend-df79a.appspot.com/o/invitations%2F66a31dc63d724e3f40549b95%2Fgallery%2FeFLO43QYMc?alt=media&token=b7898198-6597-4d73-9f02-099a3bd29144",
          "https://firebasestorage.googleapis.com/v0/b/iattend-df79a.appspot.com/o/invitations%2F66a31dc63d724e3f40549b95%2Fgallery%2F1IFd1jvgfo?alt=media&token=71bf153e-7a96-43d3-afa0-f9698f3b7a88",
          "https://firebasestorage.googleapis.com/v0/b/iattend-df79a.appspot.com/o/invitations%2F66a31dc63d724e3f40549b95%2Fgallery%2FToBhZMReXW?alt=media&token=61079e78-25a0-4cf8-92de-1fb1e84ff945",
        ],
        title: "GALERÍA", active: true, inverted: false, separator: false, background: false,
        dynamic_separator: { type: "single", image: { zoom: 1, value: null, width: 100, height: 300, position: { x: 0, y: 0 } }, active: false, single: { color: "#252525", value: 5 } },
        dynamic_background: { color: "#939faf", shape: "square", width: 90, active: false, shadow: true, texture: null, border_radius: 0 },
      },
      notices: {
        title: "AVISOS", active: false, notices: [], inverted: false, separator: false, background: false,
        dynamic_separator: { type: "single", image: { zoom: 1, value: null, width: 100, height: 300, position: { x: 0, y: 0 } }, active: false, single: { color: "#252525", value: 5 } },
        dynamic_background: { color: "#939faf", shape: "square", width: 90, active: false, shadow: true, texture: null, border_radius: 0 },
      },
      generals: {
        event: { name: name || null, label: label || null, },
        fonts: {
          body: { size: 0, color: "#000000", value: "Noto Sans", weight: 0, opacity: 1, typeFace: "Noto Sans" },
          titles: { size: 0, color: "#000000", value: "Noto Sans", weight: 0, opacity: 1, typeFace: "Noto Sans" },
        },
        colors: { accent: "#252525", actions: "#87bee9", primary: "#ffffff", secondary: "#939faf" },
        texture: 9, positions: [1, 2, 3, 4, 5, 6, 7, 8, 9], separator: 5,
      },
      greeting: {
        title: "¡Nos casamos!", active: true, inverted: false, separator: true, background: false,
        description: "Con mucha ilusión y amor, les invitamos a compartir con nosotros uno de los días más importantes de nuestras vidas.",
        dynamic_separator: { type: "single", image: { zoom: 1, value: null, width: 100, height: 300, position: { x: 0, y: 0 } }, active: false, single: { color: "#252525", value: 5 } },
        dynamic_background: { color: "#939faf", shape: "square", width: 90, active: false, shadow: true, texture: null, border_radius: 0 },
      },
      dresscode: {
        dev: null,
        prod: [
          "https://firebasestorage.googleapis.com/v0/b/iattend-df79a.appspot.com/o/invitations%2F66a31dc63d724e3f40549b95%2Fdresscode%2FeaEBaR4QgL?alt=media&token=eba80adb-0251-45b9-b225-3e96d965d49b",
          "https://firebasestorage.googleapis.com/v0/b/iattend-df79a.appspot.com/o/invitations%2F66a31dc63d724e3f40549b95%2Fdresscode%2FdSRYh8q9dX?alt=media&token=2ebda00a-25a8-4d35-aa78-59588fe8f5ff",
        ],
        links: [], title: "Dress code", active: true, colors: ["#e9e9e9", "#79abd1"], inverted: true, separator: false, background: false,
        description: "Sigue el código de vestimenta formal con tu propio toque. Encuentra opciones que se ajusten a tu estilo en nuestra galería de Pinterest.",
        links_active: false, images_active: true,
        dynamic_separator: { type: "single", image: { zoom: 1, value: null, width: 100, height: 300, position: { x: 0, y: 0 } }, active: false, single: { color: "#252525", value: 5 } },
        dynamic_background: { color: "#939faf", shape: "square", width: 90, active: true, shadow: true, texture: null, border_radius: 0 },
      },
      itinerary: {
        type: "cards", title: "ITINERARIO", active: true, inverted: true, separator: false, background: false,
        object: [
          { id: null, icon: 55, name: "Ceremonia", time: "5:00 pm", image: null, music: null, subtext: "San Antonio de Padua" },
          { id: null, icon: 16, name: "Recepción", time: "8:00 pm", image: null, music: null, subtext: "Los Aduanales" },
        ],
        dynamic_separator: { type: "single", image: { zoom: 1, value: null, width: 100, height: 300, position: { x: 0, y: 0 } }, active: false, single: { color: "#252525", value: 5 } },
        dynamic_background: { color: "#939faf", shape: "square", width: 90, active: false, shadow: true, texture: null, border_radius: 0 },
      },
      destinations: {
        cards: [
          { url: "sadcdacc", name: "Sheraton", type: "hotel", image: "https://firebasestorage.googleapis.com/v0/b/iattend-df79a.appspot.com/o/invitations%2F66a31dc63d724e3f40549b95%2Fdestinations%2FcRvWs5A1fe?alt=media&token=92798d5a-e561-46c4-9607-3029db188f5f", description: null },
          { url: "sodded", name: "Hotel One", type: "hotel", image: "https://firebasestorage.googleapis.com/v0/b/iattend-df79a.appspot.com/o/invitations%2F66a31dc63d724e3f40549b95%2Fdestinations%2FzrYoKKvOVx?alt=media&token=4dc56c12-b329-4c97-ab1a-0bdc4f8ef5b4", description: null },
        ],
        title: "DESTINOS", active: true, inverted: false, separator: false, background: false,
        description: "Sabemos que este viaje es especial y queremos que lo disfrutes al máximo. Aquí encontrarás una selección de lugares para hospedarte",
        dynamic_separator: { type: "single", image: { zoom: 1, value: null, width: 100, height: 300, position: { x: 0, y: 0 } }, active: false, single: { color: "#252525", value: 5 } },
        dynamic_background: { color: "#939faf", shape: "square", width: 90, active: false, shadow: true, texture: null, border_radius: 0 },
      },
    },
  };

  // Devuelve el id: el flujo del Save the Date gratis necesita saber a qué
  // invitación asociar la pieza recién creada.
  const { data, error } = await supabase
    .from("invitations")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    console.error("Error creando invitación con plan:", error);
    return null;
  }

  return data?.id ?? null;
}

/**
 * Activa un plan sobre una invitación existente: borrador de preview, free que
 * contrata, o upgrade Lite → PRO. Los créditos del plan se SUMAN al saldo (un
 * Lite pudo haber comprado créditos antes de subir) y el tope de side events
 * nunca baja: un Lite viejo con 1 incluido que sube a PRO queda con lo del
 * catálogo de PRO.
 */
async function activatePlan(invitationId, planName) {
  const { data: current, error: fetchError } = await supabase
    .from("invitations")
    .select("plan, active, credits, credits_included, side_events_included, photo_wall_included")
    .eq("id", invitationId)
    .single();

  if (fetchError || !current) {
    console.error("Error leyendo invitación para activar plan:", fetchError);
    return;
  }

  // Stripe reintenta el webhook: si el plan ya quedó activo, no se vuelven a
  // sumar créditos.
  if (current.active && String(current.plan).toLowerCase() === planName) return;

  const plan = await getPlan(planName);
  const credits = plan?.credits_included ?? 0;

  const { error } = await supabase
    .from("invitations")
    .update({
      plan: planName,
      active: true,
      credits: (current.credits ?? 0) + credits,
      credits_included: (current.credits_included ?? 0) + credits,
      side_events_included: Math.max(current.side_events_included ?? 0, plan?.side_events_included ?? 0),
      // Igual que el tope de side events: subir de plan nunca quita el Photo Wall.
      photo_wall_included: Boolean(current.photo_wall_included || plan?.photo_wall_included),
    })
    .eq("id", invitationId);

  if (error) {
    console.error("Error activando plan:", error);
  }
}

async function processGiftPayment(metadata) {
  const { giftEmail, senderName, recipientName, giftMessage } = metadata;
  if (!giftEmail) return;

  const giftCode = Math.floor(100000 + Math.random() * 900000).toString();
  const email = giftEmail.toLowerCase();

  // Directo en profiles: auth.admin.listUsers() solo trae los primeros 50.
  const { data: perfilExistente } = await supabase
    .from("profiles")
    .select("user_id")
    .ilike("user_email", email.replace(/[%_\\]/g, "\\$&"))
    .limit(1)
    .maybeSingle();
  const alreadyExists = !!perfilExistente;

  if (!alreadyExists) {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: giftCode,
      email_confirm: true,
    });

    if (!error && data?.user) {
      await supabase.from("profiles").insert({
        user_id: data.user.id,
        full_name: recipientName || "",
        user_email: email,
        role: "gift",
        active: true,
      });
    } else if (error) {
      console.error("Error creando usuario gift:", error);
    }
  }

  const activationLink = `https://www.iattend.site/login`;
  const html = giftEmailTemplate({
    senderName: senderName || "Alguien especial",
    personalMessage: giftMessage || "",
    giftCode,
    activationLink,
  });

  try {
    await sendMail(email, "Alguien pensó en ti — I attend 🎁", html);
  } catch (err) {
    console.error("Error enviando gift email:", err.message);
  }
}

module.exports = {
  processingPayment,
  createInvitationWithPlan,
  createCheckoutQueue,
};
