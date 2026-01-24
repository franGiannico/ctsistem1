// server.js

// ✅ Carga las variables de entorno desde el archivo .env o .env.local
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const path = require("path");
const app = express();
const jwt = require("jsonwebtoken");
const authRoutes = require("./routes/auth");


// Función para sanitizar logs
const sanitizeLog = (data) => {
  if (typeof data === 'string') {
    // Ocultar IDs largos (mostrar solo primeros 8 caracteres)
    return data.replace(/\b\d{10,}\b/g, (match) => match.substring(0, 8) + '...');
  }
  if (typeof data === 'object' && data !== null) {
    const sanitized = { ...data };
    // Ocultar campos sensibles
    if (sanitized.access_token) sanitized.access_token = '***HIDDEN***';
    if (sanitized.refresh_token) sanitized.refresh_token = '***HIDDEN***';
    if (sanitized.user_id) sanitized.user_id = sanitized.user_id.substring(0, 8) + '...';
    if (sanitized.authorization) sanitized.authorization = '***HIDDEN***';
    if (sanitized.authHeader) sanitized.authHeader = '***HIDDEN***';
    if (sanitized.expectedToken) sanitized.expectedToken = '***HIDDEN***';
    return sanitized;
  }
  return data;
};

// Rate limiting simple
const requestCounts = new Map();
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutos
const MAX_REQUESTS_PER_WINDOW = 100; // 100 requests por ventana

const rateLimitMiddleware = (req, res, next) => {
  const clientIP = req.ip || req.connection.remoteAddress;
  const now = Date.now();

  if (!requestCounts.has(clientIP)) {
    requestCounts.set(clientIP, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
  } else {
    const clientData = requestCounts.get(clientIP);

    if (now > clientData.resetTime) {
      // Reset window
      clientData.count = 1;
      clientData.resetTime = now + RATE_LIMIT_WINDOW;
    } else {
      clientData.count++;

      if (clientData.count > MAX_REQUESTS_PER_WINDOW) {
        return res.status(429).json({
          error: 'Demasiadas solicitudes. Intenta más tarde.',
          resetTime: new Date(clientData.resetTime)
        });
      }
    }
  }

  next();
};

// ✅ Importa las rutas personalizadas
const meliRoutes = require('./routes/meli');

app.use(express.static(path.join(__dirname, 'dist')));

// 🔐 Middleware de CORS
app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://ctsistem1.netlify.app',
    'https://ctsistem1-e68664e8ae46.herokuapp.com',
    'https://ctsistem1.herokuapp.com'
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept"],
  credentials: true
}));

app.options('*', cors()); // Para manejar pre-flight requests

// 📦 Middleware para leer JSON
app.use(express.json());

// 🔐 Middleware de autenticación básica
const authMiddleware = (req, res, next) => {
  // Permitir acceso público solo a la ruta raíz y debug
  if (req.path === '/' || req.path === '/health' || req.path.startsWith('/debug/')) {
    return next();
  }

  const authHeader = req.headers.authorization;
  const expectedToken = process.env.API_SECRET_TOKEN || 'default-secret-token';

  if (!authHeader) {
    return res.status(401).json({
      error: 'Acceso no autorizado. Token requerido.',
      hint: 'Incluir header: Authorization: tu-token-secreto'
    });
  }

  // 1. Validar Token Estático (Legacy/Internal)
  if (authHeader === expectedToken) {
    return next();
  }

  // 2. Validar JWT (Bearer Token)
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.split(" ")[1];
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded; // Adjuntar datos del usuario al request
      return next();
    } catch (err) {
      return res.status(401).json({
        error: 'Token inválido o expirado.',
        details: err.message
      });
    }
  }

  // Si no coincide con ninguno
  return res.status(401).json({
    error: 'Acceso no autorizado. Credenciales inválidas.',
    hint: 'Se requiere Header Authorization: <token_estatico> o Bearer <jwt>'
  });
};

// Aplicar rate limiting y autenticación a todas las rutas API
app.use('/apiventas', rateLimitMiddleware, authMiddleware);
app.use('/apiingresos', rateLimitMiddleware, authMiddleware);
app.use('/apitareas', rateLimitMiddleware, authMiddleware);
app.use('/meli', rateLimitMiddleware, authMiddleware);

// 🌐 Configurar conexión a MongoDB
mongoose.set('strictQuery', true); // Recomendado en versiones recientes de Mongoose

const mongoURI = process.env.NODE_ENV === "production"
  ? process.env.MONGODB_URI
  : process.env.MONGO_URI_DEV;

mongoose.connect(mongoURI)
  .then(() => {
    console.log(`✅ Conectado a MongoDB: ${process.env.NODE_ENV === "production" ? 'Atlas (Producción)' : 'Local (Desarrollo)'}`);
  })
  .catch(err => console.error("❌ Error conectando a MongoDB:", err));

// 📁 Definición de rutas principales
app.use("/auth", authRoutes);
app.use("/apiventas", require("./routes/apiventas"));
app.use("/apiingresos", require("./routes/apiingresos"));
app.use("/apitareas", require("./routes/apitareas"));
app.use("/meli", meliRoutes); // ✅ Ruta para autenticación Mercado Libre



// 🔍 Ruta de prueba
app.get("/", (req, res) => {
  res.send("Bienvenido al backend del sistema CT");
});

// 🌐 Producción: servir archivos del frontend desde /dist (por si hacés build de React local)
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
}

// 🚀 Iniciar el servidor
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
});
