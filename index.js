const express = require('express');
require('dotenv').config();
const cors = require('cors');
const { dbConnection } = require('./database/config');
const nocache = require('nocache');

// Crear el servidor de express
const app = express();
app.use(nocache());

// Base de datos
dbConnection();

// Configuración de CORS para desarrollo
// const corsOptions = {
//     origin: 'http://localhost:3000', // Cambia esto por el puerto que estés utilizando para tu aplicación de frontend
//     methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
//     allowedHeaders: ['Content-Type', 'Authorization', 'token'],
// };

const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'https://iattend-frontend.vercel.app',
    'wwww.iattend.mx'
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
    allowedHeaders: ['Content-Type', 'Authorization', 'token'],
};

app.use(cors(corsOptions));

app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));
app.use('/drafts', express.static('drafts'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Rutas
app.use('/api/auth', require('./router/auth'));
app.use('/api/inv', require('./router/wedInvitation'));
app.use('/api/guests', require('./router/guests'));

// Escuchar peticiones
app.listen(process.env.PORT, () => {
    console.log(`Servidor corriendo en puerto ${process.env.PORT}`);
});