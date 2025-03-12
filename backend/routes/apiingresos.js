const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

// Esquema de la base de datos
const IngresoSchema = new mongoose.Schema({
  codigoBarras: String,
  sku: String,
  articulo: String,
  cantidad: Number,
  checked: Boolean,
});

const Ingreso = mongoose.model("Ingreso", IngresoSchema, "ingresos");

// Obtener todos los ingresos
router.get("/get-items", async (req, res) => {
  try {
    const ingresos = await Ingreso.find();
    res.json(ingresos);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener los ingresos" });
  }
});

// Agregar un nuevo ingreso
router.post("/add-item", async (req, res) => {
  try {
    const nuevoIngreso = new Ingreso(req.body);
    await nuevoIngreso.save();
    res.json({ message: "Artículo agregado correctamente" });
  } catch (error) {
    res.status(500).json({ error: "Error al agregar el artículo" });
  }
});

// Marcar un ingreso como publicado (checked)
router.post("/update-item", async (req, res) => {
  try {
    const { _id, checked } = req.body;
    await Ingreso.findByIdAndUpdate(_id, { checked });
    res.json({ message: "Artículo actualizado" });
  } catch (error) {
    res.status(500).json({ error: "Error al actualizar el artículo" });
  }
});

// Eliminar los ingresos marcados como publicados
router.post("/clear-checked-items", async (req, res) => {
  try {
    await Ingreso.deleteMany({ checked: true });
    res.json({ message: "Artículos publicados eliminados correctamente" });
  } catch (error) {
    res.status(500).json({ error: "Error al eliminar artículos publicados" });
  }
});

module.exports = router;
