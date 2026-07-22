const express = require('express');
require('dotenv').config();
const cors = require('cors');
const { dbConnection } = require('./database/config');
const nocache = require('nocache');

const Stripe = require("stripe");
const { processingPayment } = require('./controllers/supabase');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

// Crear el servidor de express
const app = express();
app.use(nocache());

// Base de datos
dbConnection();


const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173',
    'http://localhost:3050',
    'https://www.iattend.mx',
    'https://www.iattend.site',
    'https://www.iattend.events',
];

const corsOptions = {
    origin: (origin, callback) => {
        // Permitir solicitudes sin origen (como móviles o curl)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        } else {
            return callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'token', 'vendor-token'],
};

app.use(cors(corsOptions));

app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));
app.use('/drafts', express.static('drafts'));

app.use('/api/ai/credits', require('./router/ai.credits.route'));

app.post(
    "/api/payment/webhook",
    express.raw({ type: "application/json" }),
    async (req, res) => {
        const sig = req.headers["stripe-signature"];

        let event;

        try {
            event = stripe.webhooks.constructEvent(
                req.body,
                sig,
                process.env.STRIPE_WEBHOOK_SECRET
            );
        } catch (err) {
            console.log("❌ Error webhook:", err.message);
            return res.status(400).send(`Webhook Error: ${err.message}`);
        }

        if (event.type === "checkout.session.completed") {
            const session = event.data.object;
            await processingPayment(session)
        }

        res.json({ received: true });
    }
);


app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Rutas
app.use('/api/auth', require('./router/auth'));
app.use('/api/ai', require('./router/iattendai'));
app.use('/api/ai', require('./router/ai.chat.route'));
app.use('/api/mail', require('./router/mailer'));
app.use('/api/whats', require('./router/whatsapp'));
app.use('/api/invitation', require('./router/invitation'));
app.use("/api/payment", require("./controllers/payment"));
app.use('/api/webhook', require('./router/webhook'));
app.use('/api/wallet', require('./router/wallet'));
app.use('/api/photos', require('./router/photos'));
app.use('/api/guests/import', require('./router/guestImport'));
app.use('/api/vendedores', require('./router/vendedores'));
app.use('/api/ventas', require('./router/ventas'));
app.use('/api/pagos', require('./router/pagos'));
app.use('/api/admin', require('./router/adminVentas'));
app.use('/api/configuracion-pagos', require('./router/configuracionPagos'));


// Escuchar peticiones
app.listen(process.env.PORT, () => {
    console.log(`Servidor corriendo en puerto ${process.env.PORT}`);
});