const mongoose = require("mongoose");

const ResultadoProductoSchema = new mongoose.Schema(
  {
    sku: {
      type: String,
      required: true,
    },
    success: {
      type: Boolean,
      default: false,
    },
    mensaje: String,
    error: String,
    cantidad: Number,
    precioBase: Number,
    precioPromocional: Number,
    precioLista: Number,
    cuotas: Number,
  },
  {
    _id: false,
  }
);

const SincronizacionTiendanubeSchema = new mongoose.Schema({
  estado: {
    type: String,
    enum: ["pendiente", "procesando", "finalizado", "error"],
    default: "pendiente",
    index: true,
  },

  productos: [
    {
      sku: String,
      cantidad: Number,
      precioBase: Number,
    },
  ],

  total: {
    type: Number,
    default: 0,
  },

  procesados: {
    type: Number,
    default: 0,
  },

  exitosos: {
    type: Number,
    default: 0,
  },

  errores: {
    type: Number,
    default: 0,
  },

  resultados: [ResultadoProductoSchema],

  mensajeError: String,

  fechaInicio: Date,
  fechaFinalizacion: Date,

  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
});

module.exports =
  mongoose.models.SincronizacionTiendanube ||
  mongoose.model(
    "SincronizacionTiendanube",
    SincronizacionTiendanubeSchema
  );