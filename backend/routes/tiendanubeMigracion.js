// Migración de precios promocionales -> precio de lista (ver services/migracionPreciosTiendanubeService.js).
//
// Flujo:
//   1) POST /analizar          -> el worker mira la tienda y arma la lista de cambios (no toca nada).
//   2) GET  /estado/:id        -> mientras tanto la pantalla consulta; cuando el estado es "borrador"
//                                 se puede ver la lista completa (?items=1) y bajar el respaldo.
//   3) POST /confirmar/:id     -> recién acá se aplica (todo, o solo los primeros N con "limite").
//   4) POST /revertir/:id      -> deshace una migración (vuelve cada producto a como estaba).
//
// Todas las rutas requieren autenticación (server.js).

const express = require("express");
const mongoose = require("mongoose");

const MigracionPreciosTiendanube = require("../models/MigracionPreciosTiendanube");

const router = express.Router();

const ESTADOS_ACTIVOS = ["por_analizar", "analizando", "pendiente", "procesando"];

const trabajoActivo = () =>
  MigracionPreciosTiendanube.findOne({ estado: { $in: ESTADOS_ACTIVOS } }).select("_id tipo estado");

const idValido = (id) => mongoose.Types.ObjectId.isValid(id);

const resumirTrabajo = (job, { conItems = false } = {}) => {
  const porcentaje =
    job.total > 0 ? Number(((job.procesados / job.total) * 100).toFixed(1)) : 0;

  const salida = {
    id: job._id,
    tipo: job.tipo,
    migracionOrigen: job.migracionOrigen,
    estado: job.estado,
    total: job.total,
    procesados: job.procesados,
    exitosos: job.exitosos,
    errores: job.errores,
    porcentaje,
    resumen: job.resumen,
    omitidas: job.omitidas,
    mensajeError: job.mensajeError,
    createdAt: job.createdAt,
    fechaInicio: job.fechaInicio,
    fechaFinalizacion: job.fechaFinalizacion,
  };

  if (conItems) {
    salida.items = job.items;
  } else {
    // Sin la lista completa, igual se devuelven los que fallaron.
    salida.itemsConError = job.items.filter((i) => i.estado === "error");
  }

  return salida;
};

// 1) Pedir el análisis
router.post("/analizar", async (req, res) => {
  try {
    const activo = await trabajoActivo();
    if (activo) {
      return res.status(409).json({
        error: "Ya hay una migración en curso. Esperá a que termine.",
        jobId: activo._id,
      });
    }

    const job = await MigracionPreciosTiendanube.create({
      tipo: "migracion",
      estado: "por_analizar",
    });

    return res.status(202).json({ success: true, jobId: job._id });
  } catch (error) {
    console.error("❌ [MIGRACIÓN] No se pudo pedir el análisis:", error.message);
    return res.status(500).json({ error: "No se pudo iniciar el análisis." });
  }
});

// Últimos trabajos (para volver a ver una migración, bajar el respaldo o revertirla)
router.get("/ultimas", async (req, res) => {
  try {
    const jobs = await MigracionPreciosTiendanube.find({
      estado: { $ne: "por_analizar" },
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .select("-items -omitidas");

    // Qué migraciones ya fueron revertidas
    const reversiones = await MigracionPreciosTiendanube.find({
      tipo: "reversion",
      migracionOrigen: { $in: jobs.map((j) => j._id) },
    }).select("migracionOrigen");
    const revertidas = new Set(reversiones.map((r) => String(r.migracionOrigen)));

    return res.json({
      trabajos: jobs.map((j) => ({
        ...resumirTrabajo({ ...j.toObject(), items: [] }),
        revertida: revertidas.has(String(j._id)),
      })),
    });
  } catch (error) {
    return res.status(500).json({ error: "No se pudo consultar el historial." });
  }
});

// 2) Estado de un trabajo (?items=1 incluye la lista completa)
router.get("/estado/:id", async (req, res) => {
  try {
    if (!idValido(req.params.id)) {
      return res.status(404).json({ error: "No se encontró el trabajo." });
    }

    const job = await MigracionPreciosTiendanube.findById(req.params.id);

    if (!job) {
      return res.status(404).json({ error: "No se encontró el trabajo." });
    }

    return res.json(resumirTrabajo(job, { conItems: req.query.items === "1" }));
  } catch (error) {
    return res.status(500).json({ error: "No se pudo consultar el trabajo." });
  }
});

// 3) Confirmar: aplica los cambios del borrador. "limite" = solo los primeros N (para probar).
router.post("/confirmar/:id", async (req, res) => {
  try {
    if (!idValido(req.params.id)) {
      return res.status(404).json({ error: "No se encontró el análisis." });
    }

    const limite = req.body?.limite === undefined ? null : Number(req.body.limite);

    if (limite !== null && (!Number.isInteger(limite) || limite < 1)) {
      return res.status(400).json({ error: '"limite" debe ser un entero mayor o igual a 1.' });
    }

    const activo = await trabajoActivo();
    if (activo) {
      return res.status(409).json({
        error: "Ya hay una migración en curso. Esperá a que termine.",
        jobId: activo._id,
      });
    }

    const job = await MigracionPreciosTiendanube.findOne({
      _id: req.params.id,
      tipo: "migracion",
      estado: "borrador",
    });

    if (!job) {
      return res.status(409).json({
        error: "Este análisis ya no se puede confirmar. Hacé un análisis nuevo.",
      });
    }

    if (job.items.length === 0) {
      return res.status(400).json({ error: "No hay productos para migrar." });
    }

    if (limite !== null) {
      job.items = job.items.slice(0, limite);
      job.total = job.items.length;
    }

    job.estado = "pendiente";
    await job.save();

    return res.status(202).json({ success: true, jobId: job._id, total: job.total });
  } catch (error) {
    console.error("❌ [MIGRACIÓN] No se pudo confirmar:", error.message);
    return res.status(500).json({ error: "No se pudo iniciar la migración." });
  }
});

// Descartar un análisis que no se va a usar
router.post("/descartar/:id", async (req, res) => {
  try {
    if (!idValido(req.params.id)) {
      return res.status(404).json({ error: "No se encontró el análisis." });
    }

    const r = await MigracionPreciosTiendanube.deleteOne({
      _id: req.params.id,
      estado: "borrador",
    });

    return res.json({ success: r.deletedCount === 1 });
  } catch (error) {
    return res.status(500).json({ error: "No se pudo descartar el análisis." });
  }
});

// 4) Revertir una migración: cada producto vuelve a su precio de lista y promocional anteriores.
router.post("/revertir/:id", async (req, res) => {
  try {
    if (!idValido(req.params.id)) {
      return res.status(404).json({ error: "No se encontró la migración." });
    }

    const activo = await trabajoActivo();
    if (activo) {
      return res.status(409).json({
        error: "Hay una migración en curso. Esperá a que termine para revertir.",
        jobId: activo._id,
      });
    }

    const origen = await MigracionPreciosTiendanube.findById(req.params.id);

    if (!origen || origen.tipo !== "migracion" || !["finalizado", "error"].includes(origen.estado)) {
      return res.status(409).json({ error: "Solo se puede revertir una migración ya terminada." });
    }

    const yaRevertida = await MigracionPreciosTiendanube.findOne({
      tipo: "reversion",
      migracionOrigen: origen._id,
    }).select("_id");

    if (yaRevertida) {
      return res.status(409).json({ error: "Esta migración ya fue revertida." });
    }

    const items = origen.items
      .filter((i) => i.estado === "ok")
      .map((i) => ({
        productId: i.productId,
        variantId: i.variantId,
        sku: i.sku,
        nombre: i.nombre,
        antes: { price: i.despues.price, promo: i.despues.promo },
        despues: { price: i.antes.price, promo: i.antes.promo },
        estado: "pendiente",
      }));

    if (items.length === 0) {
      return res.status(400).json({ error: "Esta migración no cambió ningún producto." });
    }

    const job = await MigracionPreciosTiendanube.create({
      tipo: "reversion",
      migracionOrigen: origen._id,
      estado: "pendiente",
      items,
      total: items.length,
    });

    return res.status(202).json({ success: true, jobId: job._id, total: items.length });
  } catch (error) {
    console.error("❌ [MIGRACIÓN] No se pudo revertir:", error.message);
    return res.status(500).json({ error: "No se pudo iniciar la reversión." });
  }
});

module.exports = router;
