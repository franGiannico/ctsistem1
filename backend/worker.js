require("dotenv").config();

const mongoose = require("mongoose");

const SincronizacionTiendanube = require(
  "./models/SincronizacionTiendanube"
);

const {
  procesarSincronizacionTiendanube,
} = require("./services/sincronizacionTiendanubeService");

const TiendanubeTokenSchema = new mongoose.Schema({
  access_token: String,
  token_type: String,
  scope: String,
  user_id: {
    type: String,
    unique: true,
  },
  created_at: Date,
  expires_in: Number,
});

const TiendanubeToken =
  mongoose.models.TiendanubeToken ||
  mongoose.model("TiendanubeToken", TiendanubeTokenSchema);

const mongoURI =
  process.env.NODE_ENV === "production"
    ? process.env.MONGODB_URI
    : process.env.MONGO_URI_DEV;

const esperar = (milisegundos) =>
  new Promise((resolve) => setTimeout(resolve, milisegundos));

const tomarTrabajoPendiente = async () => {
  return SincronizacionTiendanube.findOneAndUpdate(
    {
      estado: "pendiente",
    },
    {
      $set: {
        estado: "procesando",
        fechaInicio: new Date(),
      },
    },
    {
      sort: {
        createdAt: 1,
      },
      new: true,
    }
  );
};

const ejecutarWorker = async () => {
  await mongoose.connect(mongoURI);

  console.log("✅ [TN WORKER] Conectado a MongoDB");
  console.log("👷 [TN WORKER] Esperando trabajos...");

  while (true) {
    try {
      const job = await tomarTrabajoPendiente();

      if (!job) {
        await esperar(3000);
        continue;
      }

      console.log(
        `🚀 [TN WORKER] Iniciando trabajo ${job._id} ` +
          `con ${job.total} productos`
      );

      const tokenDoc = await TiendanubeToken.findOne();

      if (!tokenDoc?.access_token) {
        job.estado = "error";
        job.mensajeError = "No existe un token válido de Tiendanube.";
        job.fechaFinalizacion = new Date();
        await job.save();
        continue;
      }

      try {
        await procesarSincronizacionTiendanube({
          job,
          tokenDoc,
          userAgent: process.env.TIENDANUBE_USER_AGENT,
        });
      } catch (error) {
        console.error(
          `❌ [TN WORKER] Error en trabajo ${job._id}:`,
          error.response?.data || error.message
        );

        job.estado = "error";
        job.mensajeError =
          error.response?.data?.message ||
          error.message ||
          "Error desconocido";
        job.fechaFinalizacion = new Date();

        await job.save();
      }
    } catch (error) {
      console.error(
        "❌ [TN WORKER] Error general:",
        error.message
      );

      await esperar(5000);
    }
  }
};

ejecutarWorker().catch((error) => {
  console.error("❌ [TN WORKER] No pudo iniciarse:", error);
  process.exit(1);
});