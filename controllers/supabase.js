const supabase = require("../config/supabase");
const { sendMail } = require("./mailer");
const { giftEmailTemplate } = require("./templates/giftEmail");

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

  if (!session?.metadata) return;

  const { invitationId, userId, priceId, giftType } = session.metadata;
  if (!priceId) return;

  if (giftType === "gift") {
    await processGiftPayment(session.metadata);
    return;
  }

  const product = PRODUCTS[priceId];
  if (!product) return;

  if (!invitationId && userId) {
    if (product.type === "plan") {
      await createInvitationWithPlan(userId, product.value, session.metadata);
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
        event: { name: "test", label: "wedding" },
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

  const { error } = await supabase.from("invitations").insert(payload);

  if (error) {
    console.error("Error creando invitación con plan:", error);
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

async function processGiftPayment(metadata) {
  const { giftEmail, senderName, recipientName, giftMessage } = metadata;
  if (!giftEmail) return;

  const giftCode = Math.floor(100000 + Math.random() * 900000).toString();
  const email = giftEmail.toLowerCase();

  const { data: existingUsers } = await supabase.auth.admin.listUsers();
  const alreadyExists = existingUsers?.users?.find(u => u.email === email);

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
};
