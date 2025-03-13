const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

// Esquema de la base de datos
const TareaSchema = new mongoose.Schema({
  descripcion: String,
  prioridad: String,
  completada: Boolean,
});

const Tarea = mongoose.model("Tarea", TareaSchema, "tareas");

// Obtener todas las tareas
router.get("/cargar-tareas", async (req, res) => {
  try {
    const tareas = await Tarea.find();
    res.json(tareas);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener tareas" });
  }
});

// Agregar una nueva tarea
router.post("/guardar-tareas", async (req, res) => {
  try {
    console.log("Datos recibidos en el backend:", req.body); // <-- DEBUG para ver qué llega

    const { descripcion, prioridad } = req.body;

    // Verificar que los campos requeridos existen
    if (!descripcion || !prioridad) {
      return res.status(400).json({ error: "Faltan datos obligatorios" });
    }

    // Crear la nueva tarea asegurando que 'completada' siempre tenga un valor
    const nuevaTarea = new Tarea({
      descripcion,
      prioridad,
      completada: req.body.completada ?? false, // Si no envían 'completada', se pone en false
    });

    await nuevaTarea.save();
    res.json({ message: "Tarea guardada con éxito", tarea: nuevaTarea });
  } catch (error) {
    console.error("Error al guardar tarea:", error);
    res.status(500).json({ error: "Error al guardar la tarea" });
  }
});

// Marcar una tarea como completada
router.post("/update-tarea", async (req, res) => {
  try {
    const { _id, completada } = req.body;
    await Tarea.findByIdAndUpdate(_id, { completada });
    res.json({ message: "Tarea actualizada" });
  } catch (error) {
    res.status(500).json({ error: "Error al actualizar la tarea" });
  }
});

// Eliminar las tareas completadas
router.post("/limpiar-tareas", async (req, res) => {
  try {
    await Tarea.deleteMany({ completada: true });
    res.json({ message: "Tareas completadas eliminadas correctamente" });
  } catch (error) {
    res.status(500).json({ error: "Error al eliminar tareas completadas" });
  }
});

module.exports = router;
