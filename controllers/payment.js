const express = require("express");
const router = express.Router();
const Stripe = require("stripe");
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const { createInvitationWithPlan, createCheckoutQueue } = require("./supabase");
const { PLAN_PRICES, PRODUCTS } = require("../config/stripe.products");
const { getPlan, getPlanByPriceId } = require("../config/plans");
const { resolveInstallmentLookupKey, installmentsOptions } = require("../config/stripe.installments");

// Un price de plan es válido si está en la lista histórica o si es el que el
// catálogo tiene hoy para algún plan (Admin → Planes puede cambiarlo).
const esPrecioDePlan = async (priceId) =>
  PLAN_PRICES.includes(priceId) || Boolean(await getPlanByPriceId(priceId));
const supabase = require("../config/supabase");

// Precio a cobrar por un plan. Con `lookupKey` es un plazo a meses sin
// intereses: el price sale de Stripe por su lookup_key (el cliente nunca manda
// el price de MSI). Sin él es contado y el priceId tiene que ser de un plan.
// Devuelve { priceId, months } o { error }.
const resolverPrecioDePlan = async ({ priceId, lookupKey }) => {
  if (lookupKey) {
    const msi = await resolveInstallmentLookupKey(lookupKey);
    if (!msi) return { error: "Plazo de meses sin intereses no válido" };
    return { priceId: msi.priceId, months: msi.months, lookupKey };
  }
  if (!(await esPrecioDePlan(priceId))) return { error: "priceId no válido para un plan" };
  return { priceId, months: 0 };
};

// Metadata del plazo: el webhook la compara con el plazo que de verdad se cobró.
const metadataPlazo = ({ months, lookupKey }) =>
  months ? { msiMonths: String(months), lookupKey } : {};

/**
 * Crear sesión de Checkout
 */
router.post("/create-checkout", async (req, res) => {
  try {
    const { invitationId, priceId } = req.body;

    // Validación básica
    if (!invitationId || !priceId) {
      return res.status(400).json({
        error: "invitationId y priceId son requeridos",
      });
    }

    // Side events sueltos: solo si el plan de la invitación los permite (hoy
    // Lite ya no puede comprarlos; tiene que subir a PRO).
    if (PRODUCTS[priceId]?.type === "side") {
      const { data: inv } = await supabase
        .from("invitations")
        .select("plan")
        .eq("id", invitationId)
        .maybeSingle();

      const plan = await getPlan(inv?.plan);
      if (!plan?.can_buy_side_events) {
        return res.status(403).json({
          error: "Este plan no permite comprar side events. Cámbiate a PRO para agregarlos.",
          code: "SIDE_EVENTS_NOT_ALLOWED",
        });
      }
    }

    // Crear sesión en Stripe
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",

      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      payment_method_options: installmentsOptions(0),

      metadata: {
        invitationId,
        priceId,
      },

      success_url: `https://www.iattend.site/dashboard?id=${invitationId}&success=true`,
      cancel_url: `https://www.iattend.site/dashboard?id=${invitationId}&canceled=true`,

    });

    return res.status(200).json({
      url: session.url,
    });

  } catch (error) {
    console.error("❌ Error creando checkout:", error.message);

    return res.status(500).json({
      error: "Error creando checkout",
    });
  }
});

router.post("/create-checkout-invitation", async (req, res) => {
  try {
    const { invitation } = req.body;

    if ((!req.body.priceId && !req.body.lookupKey) || !invitation) {
      return res.status(400).json({ error: "priceId e invitation son requeridos" });
    }

    const precio = await resolverPrecioDePlan(req.body);
    if (precio.error) return res.status(400).json({ error: precio.error });
    const { priceId } = precio;

    const { userId, userEmail, name, phoneNumber, label, plan, owners } = invitation;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      payment_method_options: installmentsOptions(precio.months),
      metadata: {
        priceId,
        ...metadataPlazo(precio),
        userId: userId || "",
        userEmail: userEmail || "",
        name: name || "",
        phoneNumber: phoneNumber || "",
        label: label || "",
        plan: plan || "",
        owners: owners ? JSON.stringify(owners) : "[]",
      },
      success_url: `https://www.iattend.site/dashboard?success=true`,
      cancel_url: `https://www.iattend.site/dashboard?canceled=true`,
    });

    return res.status(200).json({ url: session.url });

  } catch (error) {
    console.error("❌ Error creando checkout:", error.message);
    return res.status(500).json({ error: "Error creando checkout" });
  }
});

router.post("/create-checkout-plan", async (req, res) => {
  try {
    const { userId, name, phoneNumber, label, userEmail } = req.body;

    if (!userId || (!req.body.priceId && !req.body.lookupKey)) {
      return res.status(400).json({ error: "userId y priceId son requeridos" });
    }

    const precio = await resolverPrecioDePlan(req.body);
    if (precio.error) return res.status(400).json({ error: precio.error });
    const { priceId } = precio;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      payment_method_options: installmentsOptions(precio.months),
      metadata: {
        userId,
        priceId,
        ...metadataPlazo(precio),
        name: name || "",
        phoneNumber: phoneNumber || "",
        label: label || "",
        userEmail: userEmail || "",
      },
      success_url: `https://www.iattend.site/dashboard?success=true`,
      cancel_url: `https://www.iattend.site/dashboard?canceled=true`,
    });

    return res.status(200).json({ url: session.url });

  } catch (error) {
    console.error("❌ Error creando checkout de plan:", error.message);
    return res.status(500).json({ error: "Error creando checkout" });
  }
});

router.post("/create-checkout-preview", async (req, res) => {
  try {
    const { userId, userEmail, previewData, successUrl, cancelUrl } = req.body;

    if (!userId || (!req.body.priceId && !req.body.lookupKey)) {
      return res.status(400).json({ error: "userId y priceId son requeridos" });
    }

    const precio = await resolverPrecioDePlan(req.body);
    if (precio.error) return res.status(400).json({ error: precio.error });
    const { priceId } = precio;

    const queueId = await createCheckoutQueue(userId, userEmail, previewData);
    if (!queueId) {
      return res.status(500).json({ error: "Error preparando el checkout" });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      payment_method_options: installmentsOptions(precio.months),
      metadata: {
        queueId,
        userId,
        userEmail: userEmail || "",
        priceId,
        ...metadataPlazo(precio),
      },
      success_url: successUrl || "https://www.iattend.site/invitations?welcome=1",
      cancel_url: cancelUrl || "https://www.iattend.site/preview-mood",
    });

    return res.status(200).json({ url: session.url });

  } catch (error) {
    console.error("❌ Error creando checkout preview:", error.message);
    return res.status(500).json({ error: "Error creando checkout" });
  }
});

router.post("/create-checkout-gift", async (req, res) => {
  try {
    const { senderName, recipientName, email, giftMessage, priceId } = req.body;

    if (!email || !priceId) {
      return res.status(400).json({ error: "email y priceId son requeridos" });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      payment_method_options: installmentsOptions(0),
      metadata: {
        giftType: "gift",
        priceId,
        giftEmail: email,
        senderName: senderName || "",
        recipientName: recipientName || "",
        giftMessage: giftMessage ? giftMessage.slice(0, 490) : "",
      },
      success_url: `https://www.iattend.site/dashboard?gift=sent`,
      cancel_url: `https://www.iattend.site/dashboard`,
    });

    return res.status(200).json({ url: session.url });

  } catch (error) {
    console.error("❌ Error creando checkout gift:", error.message);
    return res.status(500).json({ error: "Error creando checkout" });
  }
});

router.post("/create-free", async (req, res) => {
  const { userId, userEmail, name, phoneNumber, label, plan, owners } = req.body;

  if (!userId || !plan || !name) {
    return res.status(400).json({ ok: false, msg: "userId, plan y name son requeridos" });
  }

  try {
    await createInvitationWithPlan(userId, plan, {
      userEmail: userEmail || "",
      name,
      phoneNumber: phoneNumber || "",
      label: label || "",
      owners: owners ? JSON.stringify(owners) : "[]",
    });

    return res.status(201).json({ ok: true, msg: "Invitación creada" });
  } catch (error) {
    return res.status(500).json({ ok: false, msg: error.message || "Internal Server Error" });
  }
});

router.get("/prices", async (req, res) => {
  try {

    const prices = await stripe.prices.list({
      active: true,
      expand: ["data.product"],
      limit: 100,
    });

    const formattedPrices = prices.data.map((price) => ({
      priceId: price.id,
      productName: price.product.name,
      amount: price.unit_amount / 100,
      currency: price.currency,
      type: price.type,
    }));

    return res.status(200).json(formattedPrices);

  } catch (error) {
    console.error("❌ Error obteniendo prices:", error.message);
    return res.status(500).json({
      error: "Error obteniendo prices",
    });
  }
});


module.exports = router;
