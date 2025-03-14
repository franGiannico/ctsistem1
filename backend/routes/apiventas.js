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
  completada: { type: Boolean, default: false },
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
    const { sku, nombre, cantidad, numeroVenta, cliente, puntoDespacho } = req.body;

    if (!sku || !nombre || !cantidad || !numeroVenta || !cliente || !puntoDespacho) {
      return res.status(400).json({ error: "Todos los campos son obligatorios" });
    }

    const nuevaVenta = new Venta({ ...req.body, completada: false });
    await nuevaVenta.save();
    res.json({ message: "Venta guardada con éxito", venta: nuevaVenta });
  } catch (error) {
    res.status(500).json({ error: "Error al guardar la venta" });
  }
});

// Actualizar el estado de completada en una venta
router.patch("/actualizar-venta/:id", async (req, res) => {
  try {
    const { completada } = req.body;
    if (typeof completada !== "boolean") {
      return res.status(400).json({ error: "Formato de datos incorrecto" });
    }

    const ventaActualizada = await Venta.findByIdAndUpdate(
      req.params.id,
      { completada },
      { new: true }
    );

    if (!ventaActualizada) {
      return res.status(404).json({ error: "Venta no encontrada" });
    }

    res.json({ message: "Venta actualizada correctamente", venta: ventaActualizada });
  } catch (error) {
    res.status(500).json({ error: "Error al actualizar la venta" });
  }
});

// Borrar una venta por ID
router.delete("/borrar-venta/:id", async (req, res) => {
  try {
    const ventaEliminada = await Venta.findByIdAndDelete(req.params.id);
    
    if (!ventaEliminada) {
      return res.status(404).json({ error: "Venta no encontrada" });
    }

    res.json({ message: "Venta eliminada correctamente" });
  } catch (error) {
    res.status(500).json({ error: "Error al eliminar la venta" });
  }
});

// Ruta para actualizar la hora límite
router.post("/actualizar-hora-limite", (req, res) => {
  try {
    const { horaLimite } = req.body;
    console.log("Hora límite recibida:", horaLimite);
    res.json({ message: "Hora límite actualizada con éxito" });
  } catch (error) {
    res.status(500).json({ error: "Error al actualizar la hora límite" });
  }
});

module.exports = router;
