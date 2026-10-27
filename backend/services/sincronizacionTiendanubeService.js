const axios = require("axios");
const mongoose = require("mongoose");

const SincronizacionTiendanube = require(
  "../models/SincronizacionTiendanube"
);
const {
  calcularPreciosTiendanube,
  normalizarDescuento,
} = require("./preciosTiendanube");
const {
  conReintentos,
  textoError,
  actualizarPreciosVariantes,
} = require("./tiendanubeApi");

const CACHE_CATALOGO_TN_MS = 5 * 60 * 1000;

let cacheCatalogoTN = {
  userId: null,
  creadoEn: 0,
  mapaVariantes: null,
};

const dormir = (milisegundos) =>
  new Promise((resolve) => setTimeout(resolve, milisegundos));

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
    const response = await conReintentos(() =>
      axios.get(`https://api.tiendanube.com/v1/${userId}/products`, {
        headers: {
          Authentication: `bearer ${accessToken}`,
          "User-Agent": userAgent,
        },
        params: {
          page,
          per_page: perPage,
        },
      })
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

  // Si el trabajo es viejo (de antes de este cambio) no va a tener estos campos:
  // en ese caso se mantiene el comportamiento anterior (sincronizar todo).
  const necesitaStock = job.sincronizarStock !== false;
  const necesitaPrecios = job.sincronizarPrecios !== false;

  for (let inicio = 0; inicio < productos.length; inicio += TAMANIO_LOTE) {
    const loteEntrada = productos.slice(inicio, inicio + TAMANIO_LOTE);

    // Cada entrada: el resultado que se va a guardar + lo que hay que mandar a TN.
    const entradas = [];

    for (const productoEntrada of loteEntrada) {
      const sku = String(productoEntrada.sku || "").trim();

      const cantidad = Number(productoEntrada.cantidad);
      const precioBase = Number(productoEntrada.precioBase);

      const productoValido =
        sku &&
        (!necesitaStock || (Number.isInteger(cantidad) && cantidad >= 0)) &&
        (!necesitaPrecios || (Number.isFinite(precioBase) && precioBase > 0));

      if (!productoValido) {
        entradas.push({
          resultado: {
            sku: sku || "Sin SKU",
            success: false,
            error: "SKU, cantidad o precio base inválido.",
            cantidad,
            precioBase,
          },
        });

        continue;
      }

      const encontrada = mapaVariantes.get(sku.toLowerCase());

      if (!encontrada) {
        entradas.push({
          resultado: {
            sku,
            success: false,
            error: `No se encontró el SKU "${sku}" en Tiendanube.`,
            cantidad,
            precioBase,
          },
        });

        continue;
      }

      // Solo calculamos precios si realmente los vamos a tocar.
      // El precio base va al precio de LISTA. El promocional solo se completa si el producto
      // tiene % de descuento; si no, se deja en blanco (y se limpia si tenía uno).
      let precios = null;
      let descuento = null;

      if (necesitaPrecios) {
        try {
          descuento = normalizarDescuento(productoEntrada.descuento);
          precios = calcularPreciosTiendanube(precioBase, descuento);
        } catch (error) {
          entradas.push({
            resultado: {
              sku,
              success: false,
              error: error.message,
              cantidad,
              precioBase,
            },
          });

          continue;
        }
      }

      entradas.push({
        encontrada,
        precios,
        cantidad,
        precioBase,
        sku,
        descuento,
        stockOk: true,
        precioOk: true,
        errores: [],
        resultado: null,
      });
    }

    const validas = entradas.filter((e) => e.encontrada);

    // ---- 1) Stock (endpoint masivo /products/stock-price; solo stock, no precios) ----
    if (necesitaStock && validas.length > 0) {
      const actualizacionesPorProducto = new Map();

      for (const e of validas) {
        const nivelActual = e.encontrada.inventoryLevels?.[0] || {};
        const inventoryLevel = { stock: e.cantidad };

        if (nivelActual.id !== undefined) inventoryLevel.id = nivelActual.id;
        if (nivelActual.location_id !== undefined) {
          inventoryLevel.location_id = nivelActual.location_id;
        }

        if (!actualizacionesPorProducto.has(e.encontrada.productId)) {
          actualizacionesPorProducto.set(e.encontrada.productId, {
            id: e.encontrada.productId,
            variants: [],
          });
        }

        actualizacionesPorProducto.get(e.encontrada.productId).variants.push({
          id: e.encontrada.variantId,
          inventory_levels: [inventoryLevel],
        });
      }

      try {
        await conReintentos(() =>
          axios.patch(
            `https://api.tiendanube.com/v1/${userId}/products/stock-price`,
            Array.from(actualizacionesPorProducto.values()),
            {
              headers: {
                Authentication: `bearer ${accessToken}`,
                "User-Agent": userAgent,
                "Content-Type": "application/json",
              },
            }
          )
        );
      } catch (error) {
        const detalle = textoError(error);
        console.error("❌ [TN WORKER] Error actualizando stock del lote:", detalle);

        for (const e of validas) {
          e.stockOk = false;
          e.errores.push(`No se pudo actualizar el stock: ${detalle}`);
        }
      }
    }

    // ---- 2) Precios (lista + promocional juntos, un pedido por producto) ----
    if (necesitaPrecios && validas.length > 0) {
      const preciosPorProducto = new Map();

      for (const e of validas) {
        if (!preciosPorProducto.has(e.encontrada.productId)) {
          preciosPorProducto.set(e.encontrada.productId, []);
        }

        preciosPorProducto.get(e.encontrada.productId).push({
          id: e.encontrada.variantId,
          price: e.precios.precioLista,
          promo: e.precios.precioPromocional,
          entrada: e,
        });
      }

      for (const [productId, variantes] of preciosPorProducto.entries()) {
        try {
          const resultadosApi = await actualizarPreciosVariantes({
            userId,
            accessToken,
            userAgent,
            productId,
            variantes: variantes.map(({ id, price, promo }) => ({ id, price, promo })),
          });

          for (const v of variantes) {
            const r = resultadosApi.find((x) => String(x.id) === String(v.id));

            if (r && !r.ok) {
              v.entrada.precioOk = false;
              v.entrada.errores.push(r.error);
            }
          }
        } catch (error) {
          const detalle = textoError(error);
          console.error(
            `❌ [TN WORKER] Error actualizando precios del producto ${productId}:`,
            detalle
          );

          for (const v of variantes) {
            v.entrada.precioOk = false;
            v.entrada.errores.push(`No se pudieron actualizar los precios: ${detalle}`);
          }
        }

        // Pausa pequeña para no golpear demasiado la API (límite de TN: ~2 pedidos por segundo).
        await dormir(350);
      }
    }

    // ---- 3) Resultados del lote ----
    const resultadosLote = entradas.map((e) => {
      if (e.resultado) return e.resultado;

      const base = {
        sku: e.sku,
        cantidad: e.cantidad,
        precioBase: e.precioBase,
        ...(necesitaPrecios
          ? {
              precioLista: e.precios.precioLista,
              precioPromocional: e.precios.precioPromocional ?? undefined,
              descuento: e.descuento ?? undefined,
              cuotas: e.precios.cuotas,
            }
          : {}),
      };

      if (e.errores.length > 0) {
        return { ...base, success: false, error: e.errores.join(" | ") };
      }

      let mensaje;
      if (necesitaStock && necesitaPrecios) {
        mensaje = "Stock y precios actualizados.";
      } else if (necesitaStock) {
        mensaje = "Stock actualizado.";
      } else if (necesitaPrecios) {
        mensaje = "Precios actualizados.";
      } else {
        mensaje = "Sin cambios (no se seleccionó stock ni precios).";
      }

      return { ...base, success: true, mensaje };
    });

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