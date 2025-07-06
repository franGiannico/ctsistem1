// server.js

// ✅ Carga las variables de entorno desde el archivo .env o .env.local
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const path = require("path");
const app = express();

// ✅ Importa las rutas personalizadas
const meliRoutes = require('./routes/meli');

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
