const mongoose = require("mongoose");

const VentaSchema = new mongoose.Schema({
    sku: String,
    nombre: String,
    cantidad: Number,
    numeroVenta: { type: String, unique: true },
    packId: String,
    cliente: String,
    puntoDespacho: String,
    completada: { type: Boolean, default: false },
    entregada: { type: Boolean, default: false },
    imagen: String,
    esML: { type: Boolean, default: false },
    esTiendanube: { type: Boolean, default: false }, // ✅ Campo unificado
    variationId: String,
    atributos: [Object],
    tipoEnvio: String,
    nota: String,
});

// Evitar recompilación del modelo si ya existe
module.exports = mongoose.models.Venta || mongoose.model("Venta", VentaSchema, "ventas");
