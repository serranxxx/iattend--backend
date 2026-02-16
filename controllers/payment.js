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

            success_url: `https://www.iattend.site/dashboard/success`,
            cancel_url: `https://www.iattend.site/dashboard?id=${invitationId}`,
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
