const express = require("express");
const cors = require("cors"); // Asegúrate de importar CORS
const mongoose = require("mongoose");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;

// 🔹 Habilitar CORS para permitir peticiones desde el frontend
app.use(cors({
  origin: ['http://localhost:5173', 'https://ctsistem1.herokuapp.com', "https://ctsistem1.netlify.app"],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
}));

app.use(express.json());

// Conexión a MongoDB Atlas
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ Conectado a MongoDB Atlas"))
  .catch(err => console.error("❌ Error conectando a MongoDB:", err));

// Definir las rutas de tus APIs
app.use("/apiventas", require("./routes/apiventas"));
app.use("/apiingresos", require("./routes/apiingresos"));
app.use("/apitareas", require("./routes/apitareas"));

// Ruta raíz de prueba
app.get("/", (req, res) => {
  res.send("Bienvenido al backend del sistema CT");
});

// Iniciar el servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
});
