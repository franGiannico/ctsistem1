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
    codigoSeguimiento: {
    type: String,
    default: ""},

    // Datos de contacto/domicilio: solo se completan para ventas de Tiendanube
    // con envío Flex casero (no aplica a ML ni al resto de Tiendanube).
    telefono: String,
    direccion: String,
    piso: String,
    barrio: String,

    // Fecha/hora límite que Mercado Libre informa para despachar la venta
    // (lead_time.estimated_handling_limit.date del shipment). Solo aplica a ML.
    horaLimiteDespacho: Date,
});

// Evitar recompilación del modelo si ya existe
module.exports = mongoose.models.Venta || mongoose.model("Venta", VentaSchema, "ventas");
