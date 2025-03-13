const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

// Esquema de la base de datos
const TareaSchema = new mongoose.Schema({
  descripcion: { type: String, required: true },
  prioridad: { type: String, required: true },
  completada: { type: Boolean, default: false },
});

const Tarea = mongoose.model("Tarea", TareaSchema, "tareas");

// Obtener todas las tareas
router.get("/cargar-tareas", async (req, res) => {
  try {
    const tareas = await Tarea.find();
    res.json(tareas);
  } catch (error) {
    console.error("❌ Error al obtener tareas:", error);
    res.status(500).json({ error: "Error al obtener tareas" });
  }
});

// Agregar una nueva tarea
router.post("/guardar-tareas", async (req, res) => {
  try {
    console.log("📩 Datos recibidos en el backend:", req.body);

    const { descripcion, prioridad } = req.body;

    // Verificar que los campos requeridos existen
    if (!descripcion || !prioridad) {
      console.warn("⚠️ Faltan datos obligatorios: Descripción o Prioridad");
      return res.status(400).json({ error: "Faltan datos obligatorios" });
    }

    // Crear la nueva tarea asegurando que 'completada' siempre tenga un valor predeterminado
    const nuevaTarea = new Tarea({
      descripcion,
      prioridad,
      completada: req.body.completada ?? false,
    });

    await nuevaTarea.save();
    console.log("✅ Tarea guardada con éxito:", nuevaTarea);

    res.status(201).json({ message: "Tarea guardada con éxito", tarea: nuevaTarea });
  } catch (error) {
    console.error("❌ Error al guardar tarea:", error);
    res.status(500).json({ error: "Error al guardar la tarea" });
  }
});

// Marcar una tarea como completada
router.put("/update-tarea", async (req, res) => {
  try {
    const { _id, completada } = req.body;

    if (!_id || typeof completada !== "boolean") {
      console.warn("⚠️ Datos insuficientes para actualizar tarea.");
      return res.status(400).json({ error: "Datos insuficientes para actualizar tarea." });
    }

    const tareaActualizada = await Tarea.findByIdAndUpdate(_id, { completada }, { new: true });

    if (!tareaActualizada) {
      console.warn("⚠️ Tarea no encontrada.");
      return res.status(404).json({ error: "Tarea no encontrada." });
    }

    console.log("✅ Tarea actualizada:", tareaActualizada);
    res.json({ message: "Tarea actualizada con éxito", tarea: tareaActualizada });
  } catch (error) {
    console.error("❌ Error al actualizar tarea:", error);
    res.status(500).json({ error: "Error al actualizar la tarea" });
  }
});

// Eliminar las tareas completadas
router.delete("/limpiar-tareas", async (req, res) => {
  try {
    const resultado = await Tarea.deleteMany({ completada: true });
    
    if (resultado.deletedCount === 0) {
      console.warn("⚠️ No hay tareas completadas para eliminar.");
      return res.status(404).json({ message: "No hay tareas completadas para eliminar." });
    }

    console.log(`✅ ${resultado.deletedCount} tareas completadas eliminadas.`);
    res.json({ message: "Tareas completadas eliminadas correctamente", eliminadas: resultado.deletedCount });
  } catch (error) {
    console.error("❌ Error al eliminar tareas completadas:", error);
    res.status(500).json({ error: "Error al eliminar tareas completadas" });
  }
});

module.exports = router;
