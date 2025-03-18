const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

// Esquema de ingresos
const IngresoSchema = new mongoose.Schema({
  codigoBarras: String,
  sku: String,
  articulo: String,
  cantidad: Number,
  checked: Boolean,
});

const Ingreso = mongoose.model("Ingreso", IngresoSchema, "ingresos");

// Esquema de productos (Para la búsqueda de SKU y descripción)
const ProductoSchema = new mongoose.Schema({
  codigoBarras: String,
  sku: String,
  descripcion: String
});

const Producto = mongoose.model("Producto", ProductoSchema, "productos");

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

// ✅ Nueva versión: Actualizar estado checked de un ingreso
router.patch("/update-item/:id", async (req, res) => {
  try {
    const { checked } = req.body;

    if (typeof checked !== "boolean") {
      return res.status(400).json({ error: "Formato de datos incorrecto" });
    }

    const articuloActualizado = await Ingreso.findByIdAndUpdate(
      req.params.id,
      { checked },
      { new: true }
    );

    if (!articuloActualizado) {
      return res.status(404).json({ error: "Artículo no encontrado" });
    }

    res.json({ message: "Artículo actualizado correctamente", articulo: articuloActualizado });
  } catch (error) {
    res.status(500).json({ error: "Error al actualizar el artículo" });
  }
});

// ✅ Nueva versión: Eliminar todos los ingresos marcados como publicados
router.delete("/clear-checked-items", async (req, res) => {
  try {
    const result = await Ingreso.deleteMany({ checked: true });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "No hay artículos publicados para eliminar" });
    }

    res.json({ message: `Se eliminaron ${result.deletedCount} artículos publicados` });
  } catch (error) {
    res.status(500).json({ error: "Error al eliminar artículos publicados" });
  }
});


// 🚀 NUEVO ENDPOINT: Buscar producto por código de barras
router.get("/buscar-producto/:codigoBarras", async (req, res) => {
  try {
    const { codigoBarras } = req.params;
    const producto = await Producto.findOne({ codigoBarras });

    if (!producto) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    res.json(producto);
  } catch (error) {
    res.status(500).json({ error: "Error al buscar el producto" });
  }
});

module.exports = router;
