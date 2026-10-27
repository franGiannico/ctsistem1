// Migración de precios promocionales -> precio de lista (y su reversión).
//
// Contexto: hasta ahora los productos de Tiendanube tenían el precio de lista inflado y el
// precio real de venta en "precio promocional". Para pasar al modelo nuevo (lista = precio
// real, promocional solo cuando hay una promoción verdadera) hay que copiar el promocional
// actual al precio de lista y dejar el promocional en blanco.

const MigracionPreciosTiendanube = require("../models/MigracionPreciosTiendanube");
const {
  dormir,
  textoError,
  actualizarPreciosVariantes,
  obtenerVariantesConPrecios,
} = require("./tiendanubeApi");

const PAUSA_ENTRE_PRODUCTOS_MS = 550;
const MAX_ERRORES_SEGUIDOS = 5;

// Variantes a migrar a partir del catálogo en vivo, más las que se omiten y por qué.
const planificarMigracion = (variantes) => {
  const candidatas = [];
  const omitidas = [];
  let sinPromocional = 0;

  for (const v of variantes) {
    if (v.promo === null) {
      sinPromocional++;
      continue;
    }

    if (v.price === null || !Number.isFinite(v.price) || v.price <= 0) {
      omitidas.push({ ...v, motivo: "El producto no tiene precio de lista válido." });
      continue;
    }

    if (v.promo >= v.price) {
      omitidas.push({
        ...v,
        motivo: "El promocional es igual o mayor que el precio de lista (revisar a mano).",
      });
      continue;
    }

    candidatas.push({
      productId: v.productId,
      variantId: v.variantId,
      sku: v.sku,
      nombre: v.nombre,
      antes: { price: v.price, promo: v.promo },
      despues: { price: v.promo, promo: null },
    });
  }

  return { candidatas, omitidas, sinPromocional, totalVariantes: variantes.length };
};

// Procesa un trabajo (migración o reversión): un pedido por producto.
const procesarMigracionPrecios = async ({ job, tokenDoc, userAgent }) => {
  const { access_token: accessToken, user_id: userId } = tokenDoc;

  job.estado = "procesando";
  job.fechaInicio = job.fechaInicio || new Date();
  await job.save();

  // Agrupar ítems pendientes por producto.
  const porProducto = new Map();
  for (const item of job.items) {
    if (item.estado !== "pendiente") continue;
    if (!porProducto.has(item.productId)) porProducto.set(item.productId, []);
    porProducto.get(item.productId).push(item);
  }

  let erroresSeguidos = 0;
  let abortado = false;

  for (const [productId, items] of porProducto.entries()) {
    try {
      const resultados = await actualizarPreciosVariantes({
        userId,
        accessToken,
        userAgent,
        productId,
        variantes: items.map((i) => ({
          id: i.variantId,
          price: i.despues.price,
          promo: i.despues.promo === undefined ? null : i.despues.promo,
        })),
      });

      for (const item of items) {
        const r = resultados.find((x) => String(x.id) === String(item.variantId));

        if (r && r.ok) {
          item.estado = "ok";
          item.error = undefined;
        } else {
          item.estado = "error";
          item.error = r?.error || "Tiendanube no confirmó el cambio.";
        }
      }
    } catch (error) {
      const detalle = textoError(error);
      console.error(`❌ [MIGRACIÓN] Producto ${productId}:`, detalle);

      for (const item of items) {
        item.estado = "error";
        item.error = detalle;
      }
    }

    const huboError = items.some((i) => i.estado === "error");
    erroresSeguidos = huboError ? erroresSeguidos + items.length : 0;

    job.procesados = job.items.filter((i) => i.estado !== "pendiente").length;
    job.exitosos = job.items.filter((i) => i.estado === "ok").length;
    job.errores = job.items.filter((i) => i.estado === "error").length;
    await job.save();

    // Si fallan varios seguidos hay algo sistemático (permisos, token, TN no deja borrar el
    // promocional...): se frena para no seguir tocando la tienda.
    if (erroresSeguidos >= MAX_ERRORES_SEGUIDOS) {
      job.mensajeError =
        `Se frenó la migración después de ${erroresSeguidos} errores seguidos. ` +
        `Último error: ${items.find((i) => i.error)?.error || "desconocido"}`;
      abortado = true;
      break;
    }

    await dormir(PAUSA_ENTRE_PRODUCTOS_MS);
  }

  job.estado = abortado ? "error" : "finalizado";
  job.fechaFinalizacion = new Date();
  await job.save();

  console.log(
    `✅ [MIGRACIÓN] ${job.tipo} ${job._id}: ${job.exitosos} ok, ${job.errores} con error` +
      (abortado ? " (frenada)" : "")
  );
};

// Primera etapa: mira la tienda y arma la lista de lo que se va a cambiar (sin tocar nada).
const analizarMigracion = async ({ job, tokenDoc, userAgent }) => {
  const variantes = await obtenerVariantesConPrecios({
    userId: tokenDoc.user_id,
    accessToken: tokenDoc.access_token,
    userAgent,
  });

  const plan = planificarMigracion(variantes);

  job.items = plan.candidatas.map((c) => ({ ...c, estado: "pendiente" }));
  job.omitidas = plan.omitidas.map((o) => ({
    sku: o.sku,
    nombre: o.nombre,
    price: o.price,
    promo: o.promo,
    motivo: o.motivo,
  }));
  job.resumen = {
    totalVariantes: plan.totalVariantes,
    sinPromocional: plan.sinPromocional,
  };
  job.total = job.items.length;
  job.estado = "borrador";
  await job.save();

  console.log(
    `🔎 [MIGRACIÓN] Análisis ${job._id}: ${job.total} a migrar, ` +
      `${plan.omitidas.length} omitidas, ${plan.sinPromocional} sin promocional`
  );
};

const tomarTrabajo = (estadoActual, estadoNuevo) =>
  MigracionPreciosTiendanube.findOneAndUpdate(
    { estado: estadoActual },
    { $set: { estado: estadoNuevo } },
    { sort: { createdAt: 1 }, new: true }
  );

// Si el worker se reinició a mitad de camino, retoma los trabajos que habían quedado
// "en curso" (los ítems ya procesados no se repiten).
const recuperarTrabajosInterrumpidos = async () => {
  await MigracionPreciosTiendanube.updateMany(
    { estado: "analizando" },
    { $set: { estado: "por_analizar" } }
  );
  await MigracionPreciosTiendanube.updateMany(
    { estado: "procesando" },
    { $set: { estado: "pendiente" } }
  );
};

// Toma y ejecuta el siguiente trabajo de migración que haya. Devuelve true si hizo algo.
const procesarSiguienteMigracion = async ({ obtenerToken, userAgent }) => {
  let job = await tomarTrabajo("por_analizar", "analizando");
  const esAnalisis = Boolean(job);

  if (!job) {
    job = await tomarTrabajo("pendiente", "procesando");
    if (!job) return false;
    job.fechaInicio = job.fechaInicio || new Date();
  }

  try {
    const tokenDoc = await obtenerToken();

    if (!tokenDoc?.access_token) {
      throw new Error("No existe un token válido de Tiendanube.");
    }

    if (esAnalisis) {
      await analizarMigracion({ job, tokenDoc, userAgent });
    } else {
      await procesarMigracionPrecios({ job, tokenDoc, userAgent });
    }
  } catch (error) {
    console.error(`❌ [MIGRACIÓN] Trabajo ${job._id}:`, textoError(error));
    job.estado = "error";
    job.mensajeError = textoError(error);
    job.fechaFinalizacion = new Date();
    await job.save();
  }

  return true;
};

module.exports = {
  planificarMigracion,
  procesarMigracionPrecios,
  recuperarTrabajosInterrumpidos,
  procesarSiguienteMigracion,
};
