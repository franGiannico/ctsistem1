// server.js

// Carga las variables de entorno desde el archivo .env
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const meliRoutes = require('./routes/meli');
const app = express();

// Configuración de CORS para permitir solicitudes desde tus dominios de frontend
app.use(cors({
  origin: [
    'http://localhost:5173', // Para desarrollo local del frontend
    'https://ctsistem1.netlify.app', // Para tu frontend desplegado en Netlify
    'https://ctsistem1-e68664e8ae46.herokuapp.com', // Si tu frontend también se despliega aquí
    'https://ctsistem1.herokuapp.com' // Otra posible URL de Heroku
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept"],
  credentials: true // Importante si manejas cookies o sesiones con el frontend
}));

// Maneja las solicitudes OPTIONS previas a las solicitudes CORS complejas
app.options('*', cors());

// Middleware para parsear el cuerpo de las solicitudes JSON
app.use(express.json());

// Define el puerto del servidor, usando la variable de entorno PORT o 5000 por defecto
const PORT = process.env.PORT || 5000;

// Elegir la URI de MongoDB según el entorno (production o development)
// Si NODE_ENV es "production", usa MONGODB_URI (Atlas). Si no, usa MONGO_URI_DEV (local).
const mongoURI = process.env.NODE_ENV === "production"
  ? process.env.MONGODB_URI // URI de MongoDB Atlas (para producción)
  : process.env.MONGO_URI_DEV; // URI de MongoDB local (para desarrollo)

// Configuración para suprimir el DeprecationWarning de Mongoose strictQuery
mongoose.set('strictQuery', true); // Se recomienda true para Mongoose 7+ para un comportamiento más estricto

// Conexión a MongoDB
mongoose.connect(mongoURI)
  .then(() => {
    // Mensaje de éxito más descriptivo
    console.log(`✅ Conectado a MongoDB: ${process.env.NODE_ENV === "production" ? 'Atlas (Producción)' : 'Local (Desarrollo)'}`);
  })
  .catch(err => console.error("❌ Error conectando a MongoDB:", err));

// Definir las rutas de tus APIs
// Usamos require() directamente en app.use() para cargar las rutas
app.use("/apiventas", require("./routes/apiventas"));
app.use("/apiingresos", require("./routes/apiingresos"));
app.use("/apitareas", require("./routes/apitareas"));
app.use('/meli', require('./routes/meli')); // Ruta para la integración con Mercado Libre

// Ruta raíz de prueba del backend
app.get("/", (req, res) => {
  res.send("Bienvenido al backend del sistema CT");
});

// 👉 Esta parte va al final del archivo server.js
if (process.env.NODE_ENV === 'production') {
  const path = require('path');
  app.use(express.static(path.join(__dirname, 'dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
}


// Iniciar el servidor y escuchar en el puerto definido
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
});
