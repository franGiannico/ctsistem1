const mongoose = require("mongoose");

// Un trabajo que cambia precios de lista y promocionales de variantes de Tiendanube.
// Sirve para dos cosas con el mismo formato:
//   - tipo "migracion": pasa el precio promocional actual al precio de lista y deja el
//     promocional en blanco;
//   - tipo "reversion": deshace una migración (vuelve cada variante a como estaba antes).
// Cada ítem guarda cómo estaba la variante ("antes") y cómo debe quedar ("despues"),
// así el trabajo mismo es el respaldo.
const ItemSchema = new mongoose.Schema(
  {
    productId: { type: Number, required: true },
    variantId: { type: Number, required: true },
    sku: String,
    nombre: String,
    antes: {
      price: Number,
      promo: Number, // vacío = sin promocional
    },
    despues: {
      price: Number,
      promo: Number, // vacío = en blanco
    },
    estado: {
      type: String,
      enum: ["pendiente", "ok", "error"],
      default: "pendiente",
    },
    error: String,
  },
  { _id: false }
);

const MigracionPreciosTiendanubeSchema = new mongoose.Schema({
  tipo: {
    type: String,
    enum: ["migracion", "reversion"],
    default: "migracion",
  },

  // En una reversión: la migración que se está deshaciendo.
  migracionOrigen: { type: mongoose.Schema.Types.ObjectId, default: null },

  estado: {
    type: String,
    // por_analizar -> analizando -> borrador (esperando confirmación del usuario)
    //   -> pendiente -> procesando -> finalizado | error
    // Una reversión arranca directamente en "pendiente".
    enum: [
      "por_analizar",
      "analizando",
      "borrador",
      "pendiente",
      "procesando",
      "finalizado",
      "error",
    ],
    default: "por_analizar",
    index: true,
  },

  items: [ItemSchema],

  // Resultado del análisis (solo migraciones): qué se encontró en la tienda.
  resumen: {
    totalVariantes: Number,
    sinPromocional: Number,
  },

  // Variantes con promocional que NO se migran, con el motivo (revisar a mano).
  omitidas: [
    {
      _id: false,
      sku: String,
      nombre: String,
      price: Number,
      promo: Number,
      motivo: String,
    },
  ],

  total: { type: Number, default: 0 },
  procesados: { type: Number, default: 0 },
  exitosos: { type: Number, default: 0 },
  errores: { type: Number, default: 0 },

  mensajeError: String,

  fechaInicio: Date,
  fechaFinalizacion: Date,

  createdAt: { type: Date, default: Date.now, index: true },
});

module.exports =
  mongoose.models.MigracionPreciosTiendanube ||
  mongoose.model("MigracionPreciosTiendanube", MigracionPreciosTiendanubeSchema);
