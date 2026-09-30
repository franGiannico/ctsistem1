const express = require("express");
const router = express.Router();

const Venta = require("../models/Venta"); // ✅ Importar modelo compartido

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

// Agregar una nueva venta
router.post("/guardar-ventas", async (req, res) => {
  try {
    const { sku, nombre, cantidad, numeroVenta, cliente, puntoDespacho, nota } = req.body;

    // Validar todos los campos necesarios
    if (!sku || !nombre || !cantidad || !numeroVenta || !cliente || !puntoDespacho) {
      return res.status(400).json({ error: "Todos los campos son obligatorios" });
    }

    // Crear venta con valores explícitos (sin dejar campos al azar desde req.body)
    const nuevaVenta = new Venta({
      sku,
      nombre,
      cantidad,
      numeroVenta: numeroVenta.toString(), // Convertir a string para consistencia
      cliente,
      puntoDespacho,
      // 👇 Nota opcional (ej: "Retira en Savio" al cargar un pedido interno pegado).
      // No la pisamos con "" si no viene, así no rompe al resto de las ventas manuales.
      ...(nota ? { nota } : {}),
      completada: false,
      entregada: false
      // Los campos de ML (imagen, esML, etc.) se agregarán automáticamente como undefined/null
    });

    await nuevaVenta.save();
    res.json({ message: "Venta guardada con éxito", venta: nuevaVenta });
  } catch (error) {
    console.error("❌ Error al guardar la venta:", error);
    res.status(500).json({ error: "Error al guardar la venta" });
  }
});


// Actualizar el estado de completada o entregada en una venta
router.patch("/actualizar-venta/:id", async (req, res) => {
  try {
    const { completada, entregada, nota } = req.body;

    // Validar que al menos uno de los campos venga en el body
    if (typeof completada !== "boolean" && typeof entregada !== "boolean" && typeof nota === "undefined") {
      return res.status(400).json({ error: "Debe enviarse 'completada', 'entregada' o 'nota'" });
    }

    // Crear objeto de actualización dinámico
    const updateFields = {};
    if (typeof completada === "boolean") updateFields.completada = completada;
    if (typeof entregada === "boolean") updateFields.entregada = entregada;
    if (typeof nota !== "undefined") {
      // Si la nota está vacía o es null, establecerla como cadena vacía o null
      updateFields.nota = nota === "" || nota === null ? "" : nota;
    }

    const ventaActualizada = await Venta.findByIdAndUpdate(
      req.params.id,
      updateFields,
      { new: true }
    );

    if (!ventaActualizada) {
      return res.status(404).json({ error: "Venta no encontrada" });
    }

    res.json({ message: "Venta actualizada correctamente", venta: ventaActualizada });
  } catch (error) {
    console.error("Error al actualizar la venta:", error);
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

// Borrar todas las ventas que estén completadas Y entregadas
router.delete("/borrar-ventas-completadas", async (req, res) => {
  try {
    const resultado = await Venta.deleteMany({ completada: true, entregada: true }); // 👈 ambas condiciones
    res.json({ message: `Ventas completadas y entregadas eliminadas correctamente (${resultado.deletedCount})` });
  } catch (error) {
    res.status(500).json({ error: "Error al eliminar las ventas completadas y entregadas" });
  }
});

// router.get('/:numeroVenta', async (req, res) => {
//   const { numeroVenta } = req.params;

//   try {
//     const ventaExistente = await Venta.findOne({ numeroVenta });
//     if (ventaExistente) {
//       return res.status(200).json({ existe: true });
//     } else {
//       return res.status(200).json({ existe: false });
//     }
//   } catch (err) {
//     console.error("❌ Error buscando venta:", err);
//     res.status(500).json({ error: "Error verificando la venta" });
//   }
// });


module.exports = router;
