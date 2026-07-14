const axios = require("axios");
const mongoose = require("mongoose");

const CONFIG_CUOTAS = require("../config/tiendanubeCuotas");
const SincronizacionTiendanube = require(
  "../models/SincronizacionTiendanube"
);

const IVA = 1.21;
const COSTO_COBRO_MP = 0.0079 * IVA;
const CPT_TIENDANUBE = 0.01;
const IMPUESTO_DEBITOS = 0.006;
const AUMENTO_PRECIO_LISTA = 0.2;

const CACHE_CATALOGO_TN_MS = 5 * 60 * 1000;

let cacheCatalogoTN = {
  userId: null,
  creadoEn: 0,
  mapaVariantes: null,
};

const dormir = (milisegundos) =>
  new Promise((resolve) => setTimeout(resolve, milisegundos));

const obtenerPlanPorPrecio = (precioBase) => {
  const precio = Number(precioBase);

  if (!Number.isFinite(precio) || precio <= 0) {
    throw new Error('"precioBase" debe ser un número mayor que 0.');
  }

  const plan = CONFIG_CUOTAS.find(
    (configuracion) => precio >= configuracion.minimo
  );

  if (!plan) {
    throw new Error("No se encontró una configuración de cuotas válida.");
  }

  return plan;
};

const calcularPreciosTiendanube = (precioBase) => {
  const precioNetoDeseado = Number(precioBase);
  const plan = obtenerPlanPorPrecio(precioNetoDeseado);

  const costoFinanciacionConIVA = plan.financiacion * IVA;

  const costoTotal =
    COSTO_COBRO_MP +
    CPT_TIENDANUBE +
    IMPUESTO_DEBITOS +
    costoFinanciacionConIVA;

  if (costoTotal >= 1) {
    throw new Error("El costo total calculado es inválido.");
  }

  const precioPromocional = Math.ceil(
    precioNetoDeseado / (1 - costoTotal)
  );

  const precioLista = Math.ceil(
    precioPromocional * (1 + AUMENTO_PRECIO_LISTA)
  );

  return {
    cuotas: plan.cuotas,
    costoTotal,
    precioPromocional,
    precioLista,
  };
};

const obtenerMapaVariantesTN = async ({
  accessToken,
  userId,
  userAgent,
}) => {
  const ahora = Date.now();

  const cacheValido =
    cacheCatalogoTN.mapaVariantes &&
    cacheCatalogoTN.userId === String(userId) &&
    ahora - cacheCatalogoTN.creadoEn < CACHE_CATALOGO_TN_MS;

  if (cacheValido) {
    console.log(
      `⚡ [TN WORKER] Usando catálogo en caché: ` +
        `${cacheCatalogoTN.mapaVariantes.size} variantes`
    );

    return cacheCatalogoTN.mapaVariantes;
  }

  const mapaVariantes = new Map();
  const perPage = 50;
  let page = 1;

  while (page <= 100) {
    const response = await axios.get(
      `https://api.tiendanube.com/v1/${userId}/products`,
      {
        headers: {
          Authentication: `bearer ${accessToken}`,
          "User-Agent": userAgent,
        },
        params: {
          page,
          per_page: perPage,
        },
      }
    );

    const catalogo = response.data || [];

    console.log(
      `📦 [TN WORKER] Página ${page}: ${catalogo.length} productos`
    );

    for (const producto of catalogo) {
      for (const variante of producto.variants || []) {
        const skuNormalizado = String(variante.sku || "")
          .trim()
          .toLowerCase();

        if (!skuNormalizado) continue;

        mapaVariantes.set(skuNormalizado, {
          productId: producto.id,
          variantId: variante.id,
          inventoryLevels: variante.inventory_levels || [],
        });
      }
    }

    if (catalogo.length < perPage) break;

    page++;
  }

  cacheCatalogoTN = {
    userId: String(userId),
    creadoEn: Date.now(),
    mapaVariantes,
  };

  console.log(
    `✅ [TN WORKER] ${mapaVariantes.size} variantes indexadas`
  );

  return mapaVariantes;
};

const procesarSincronizacionTiendanube = async ({
  job,
  tokenDoc,
  userAgent,
}) => {
  const { access_token: accessToken, user_id: userId } = tokenDoc;

  job.estado = "procesando";
  job.fechaInicio = new Date();
  await job.save();

  const mapaVariantes = await obtenerMapaVariantesTN({
    accessToken,
    userId,
    userAgent,
  });

  const TAMANIO_LOTE = 20;
  const productos = job.productos || [];

  for (let inicio = 0; inicio < productos.length; inicio += TAMANIO_LOTE) {
    const loteEntrada = productos.slice(inicio, inicio + TAMANIO_LOTE);

    const resultadosLote = [];
    const actualizacionesPorProducto = new Map();
    const preciosPorProducto = new Map();

    for (const productoEntrada of loteEntrada) {
      const sku = String(productoEntrada.sku || "").trim();

      const cantidad = Number(productoEntrada.cantidad);
      const precioBase = Number(productoEntrada.precioBase);

      const productoValido =
        sku &&
        Number.isInteger(cantidad) &&
        cantidad >= 0 &&
        Number.isFinite(precioBase) &&
        precioBase > 0;

      if (!productoValido) {
        resultadosLote.push({
          sku: sku || "Sin SKU",
          success: false,
          error: "SKU, cantidad o precio base inválido.",
          cantidad,
          precioBase,
        });

        continue;
      }

      const encontrada = mapaVariantes.get(sku.toLowerCase());

      if (!encontrada) {
        resultadosLote.push({
          sku,
          success: false,
          error: `No se encontró el SKU "${sku}" en Tiendanube.`,
          cantidad,
          precioBase,
        });

        continue;
      }

      const precios = calcularPreciosTiendanube(precioBase);

      const nivelActual = encontrada.inventoryLevels?.[0] || {};

      const inventoryLevel = {
        stock: cantidad,
      };

      if (nivelActual.id !== undefined) {
        inventoryLevel.id = nivelActual.id;
      }

      if (nivelActual.location_id !== undefined) {
        inventoryLevel.location_id = nivelActual.location_id;
      }

      if (!actualizacionesPorProducto.has(encontrada.productId)) {
        actualizacionesPorProducto.set(encontrada.productId, {
          id: encontrada.productId,
          variants: [],
        });
      }

      actualizacionesPorProducto
        .get(encontrada.productId)
        .variants.push({
          id: encontrada.variantId,
          price: precios.precioLista,
          inventory_levels: [inventoryLevel],
        });

      if (!preciosPorProducto.has(encontrada.productId)) {
        preciosPorProducto.set(encontrada.productId, []);
      }

      preciosPorProducto.get(encontrada.productId).push({
        id: encontrada.variantId,
        price: precios.precioLista,
        promotional_price: precios.precioPromocional,
      });

      resultadosLote.push({
        sku,
        success: true,
        mensaje: `Stock y precios actualizados.`,
        cantidad,
        precioBase,
        precioPromocional: precios.precioPromocional,
        precioLista: precios.precioLista,
        cuotas: precios.cuotas,
      });
    }

    const actualizaciones = Array.from(
      actualizacionesPorProducto.values()
    );

    if (actualizaciones.length > 0) {
      await axios.patch(
        `https://api.tiendanube.com/v1/${userId}/products/stock-price`,
        actualizaciones,
        {
          headers: {
            Authentication: `bearer ${accessToken}`,
            "User-Agent": userAgent,
            "Content-Type": "application/json",
          },
        }
      );
    }

    const gruposPrecios = Array.from(preciosPorProducto.entries());

    for (const [productId, variantes] of gruposPrecios) {
      await axios.patch(
        `https://api.tiendanube.com/v1/${userId}/products/${productId}/variants`,
        variantes,
        {
          headers: {
            Authentication: `bearer ${accessToken}`,
            "User-Agent": userAgent,
            "Content-Type": "application/json",
          },
        }
      );

      // Pausa pequeña para no golpear demasiado la API.
      await dormir(100);
    }

    const exitososLote = resultadosLote.filter(
      (resultado) => resultado.success
    ).length;

    const erroresLote = resultadosLote.length - exitososLote;

    job.resultados.push(...resultadosLote);
    job.procesados += resultadosLote.length;
    job.exitosos += exitososLote;
    job.errores += erroresLote;

    await job.save();

    console.log(
      `📊 [TN WORKER] ${job.procesados}/${job.total} procesados`
    );
  }

  job.estado = "finalizado";
  job.fechaFinalizacion = new Date();
  await job.save();

  console.log(
    `✅ [TN WORKER] Trabajo ${job._id} finalizado: ` +
      `${job.exitosos} exitosos, ${job.errores} errores`
  );
};

module.exports = {
  procesarSincronizacionTiendanube,
};