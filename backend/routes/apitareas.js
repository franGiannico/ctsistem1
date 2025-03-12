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
    const nuevaTarea = new Tarea(req.body);
    await nuevaTarea.save();
    res.json({ message: "Tarea guardada con éxito" });
  } catch (error) {
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
