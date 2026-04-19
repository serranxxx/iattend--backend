const express = require("express");
const router = express.Router();
const Stripe = require("stripe");
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

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
    const { priceId, invitation } = req.body;

    if (!priceId || !invitation) {
      return res.status(400).json({ error: "priceId e invitation son requeridos" });
    }

    const PLAN_PRICES = [
      "price_1SkRwZAAdNlITNVbEsPlYN0F", // lite
      "price_1SkRxCAAdNlITNVbB0AB16LN", // pro
      "price_1TO1kjAAdNlITNVbmfuaY1nm" // pro-test
    ];

    if (!PLAN_PRICES.includes(priceId)) {
      return res.status(400).json({ error: "priceId no válido para un plan" });
    }

    const { userId, userEmail, name, phoneNumber, label, plan } = invitation;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: {
        priceId,
        userId: userId || "",
        userEmail: userEmail || "",
        name: name || "",
        phoneNumber: phoneNumber || "",
        label: label || "",
        plan: plan || "",
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
    const { userId, priceId, name, phoneNumber, label, userEmail } = req.body;

    if (!userId || !priceId) {
      return res.status(400).json({ error: "userId y priceId son requeridos" });
    }

    const PLAN_PRICES = [
      "price_1SkRwZAAdNlITNVbEsPlYN0F", // lite
      "price_1SkRxCAAdNlITNVbB0AB16LN", // pro
    ];

    if (!PLAN_PRICES.includes(priceId)) {
      return res.status(400).json({ error: "priceId no válido para un plan" });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: {
        userId,
        priceId,
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

router.get("/prices", async (req, res) => {
  try {

    // Traer todos los prices activos
    const prices = await stripe.prices.list({
      active: true,
      expand: ["data.product"],
    });

    // Formatear respuesta limpia
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
