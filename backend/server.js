const express = require("express");
const cors = require("cors"); // Asegúrate de importar CORS
const mongoose = require("mongoose");
require("dotenv").config();
const meliRoutes = require('./routes/meli');

const app = express();


app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://ctsistem1.netlify.app',
    'https://ctsistem1-e68664e8ae46.herokuapp.com',
    'https://ctsistem1.herokuapp.com'
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept"],
  credentials: true // Opcional si usás cookies o sesiones
}));

app.options('*', cors());


// Middleware para parsear JSON
app.use(express.json());

const PORT = process.env.PORT || 5000;

// Elegir la URI de MongoDB según el entorno
const mongoURI = process.env.NODE_ENV === "production"
  ? process.env.MONGODB_URI // Atlas
  : process.env.MONGO_URI_DEV; // Local


// Conexión a MongoDB Atlas
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ Conectado a MongoDB Atlas"))
  .catch(err => console.error("❌ Error conectando a MongoDB:", err));

// Definir las rutas de tus APIs
app.use("/apiventas", require("./routes/apiventas"));
app.use("/apiingresos", require("./routes/apiingresos"));
app.use("/apitareas", require("./routes/apitareas"));
app.use('/meli', require('./routes/meli'));


// Ruta raíz de prueba
app.get("/", (req, res) => {
  res.send("Bienvenido al backend del sistema CT");
});

// Iniciar el servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
});
