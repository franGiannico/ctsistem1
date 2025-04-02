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

// Esquema de la base de datos para la Hora Límite General
const HoraLimiteGeneralSchema = new mongoose.Schema({
  _id: { type: String, default: 'general' }, // Un ID fijo para el documento
  horaLimiteGeneral: String,
}, { collection: 'configuracion_general' }); // Puedes usar otro nombre de colección si lo prefieres

const HoraLimiteGeneralModel = mongoose.model("HoraLimiteGeneral", HoraLimiteGeneralSchema, "configuracion_general");

// Obtener todas las ventas
router.get("/cargar-ventas", async (req, res) => {
  try {
    const ventas = await Venta.find();
    res.json(ventas);
  } catch (error) {
    console.error("Error al obtener ventas:", error);
    res.status(500).json({ error: "Error al obtener ventas" });
  }
});

// Obtener la hora límite general
router.get("/obtener-hora-limite", async (req, res) => {
  try {
      const config = await HoraLimiteGeneralModel.findById("general");
      const horaLimiteGeneral = config ? config.horaLimiteGeneral : "";
      res.json({ horaLimiteGeneral });
  } catch (error) {
      console.error("Error al obtener la hora límite:", error);
      res.status(500).json({ error: "Error al obtener la hora límite" });
  }
});

// Ruta para actualizar la hora límite
router.post("/actualizar-hora-limite", async (req, res) => {
  try {
      const { horaLimite } = req.body;
      console.log("Hora límite recibida:", horaLimite);

      let config = await HoraLimiteGeneralModel.findById('general');

      if (config) {
          config.horaLimiteGeneral = horaLimite;
          await config.save();
          res.json({ message: "Hora límite actualizada con éxito", horaLimite: config.horaLimiteGeneral });
      } else {
          const nuevaConfig = new HoraLimiteGeneralModel({ _id: 'general', horaLimiteGeneral: horaLimite });
          await nuevaConfig.save();
          res.json({ message: "Hora límite guardada con éxito", horaLimite: nuevaConfig.horaLimiteGeneral });
      }
  } catch (error) {
      console.error("Error al actualizar la hora límite:", error);
      res.status(500).json({ error: "Error al actualizar la hora límite" });
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

// Borrar todas las ventas completadas
router.delete("/borrar-ventas-completadas", async (req, res) => {
  try {
    await Venta.deleteMany({ completada: true });
    res.json({ message: "Ventas completadas eliminadas correctamente" });
  } catch (error) {
    res.status(500).json({ error: "Error al eliminar las ventas completadas" });
  }
});

module.exports = router;
