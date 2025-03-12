const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

// Esquema de la base de datos
const VentaSchema = new mongoose.Schema({
  sku: String,
  nombre: String,
  cantidad: Number,
  numeroVenta: Number,
  cliente: String,
  puntoDespacho: String,
  completada: Boolean,
});

const Venta = mongoose.model("Venta", VentaSchema, "ventas");

// Obtener todas las ventas
router.get("/cargar-ventas", async (req, res) => {
  try {
    const ventas = await Venta.find();
    res.json(ventas);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener ventas" });
  }
});

// Agregar una nueva venta
router.post("/guardar-ventas", async (req, res) => {
  try {
    const nuevaVenta = new Venta(req.body);
    await nuevaVenta.save();
    res.json({ message: "Venta guardada con éxito" });
  } catch (error) {
    res.status(500).json({ error: "Error al guardar la venta" });
  }
});

// Borrar una venta por ID
router.delete("/borrar-venta/:id", async (req, res) => {
  try {
    await Venta.findByIdAndDelete(req.params.id);
    res.json({ message: "Venta eliminada correctamente" });
  } catch (error) {
    res.status(500).json({ error: "Error al eliminar la venta" });
  }
});

module.exports = router;
