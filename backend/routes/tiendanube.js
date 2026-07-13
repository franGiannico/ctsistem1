const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const router = express.Router();
require('dotenv').config();
const CONFIG_CUOTAS = require("../config/tiendanubeCuotas");

const {
    TIENDANUBE_CLIENT_ID,
    TIENDANUBE_CLIENT_SECRET,
    TIENDANUBE_USER_AGENT
} = process.env;

const REDIRECT_URI = 'https://ctsistem1-e68664e8ae46.herokuapp.com/tiendanube/callback';

// Modelo TiendanubeToken
const TiendanubeTokenSchema = new mongoose.Schema({
    access_token: String,
    token_type: String,
    scope: String,
    user_id: { type: String, unique: true }, // Store ID
    created_at: { type: Date, default: Date.now },
    expires_in: Number // Tiendanube tokens usually don't expire quickly but good to track
});

const TiendanubeToken = mongoose.models.TiendanubeToken || mongoose.model('TiendanubeToken', TiendanubeTokenSchema);

// Modelo Venta (Referencia unificada)
const VentaModel = require("../models/Venta");

const IVA = 1.21;

// Costos fijos validados con una venta real.
const COSTO_COBRO_MP = 0.0079 * IVA; // 0,79% + IVA = 0,9559%
const CPT_TIENDANUBE = 0.01;         // 1%
const IMPUESTO_DEBITOS = 0.006;      // 0,60%
const AUMENTO_PRECIO_LISTA = 0.20;   // Lista 20% mayor al promocional

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

  // Precio de venta para que, después de todos los descuentos,
  // quede neto el precioBase.
  const precioPromocional = Math.ceil(
    precioNetoDeseado / (1 - costoTotal)
  );

  // Regla comercial: precio de lista 20% por encima del promocional.
  const precioLista = Math.ceil(
    precioPromocional * (1 + AUMENTO_PRECIO_LISTA)
  );

  return {
    cuotas: plan.cuotas,
    financiacion: plan.financiacion,
    costoTotal,
    precioPromocional,
    precioLista,
  };
};

// 🔐 Auth: Redirigir a Tiendanube
router.get('/auth', (req, res) => {
    const authUrl = `https://www.tiendanube.com/apps/${TIENDANUBE_CLIENT_ID}/authorize?response_type=code&scope=read_orders,write_orders,read_products,write_products&redirect_uri=${REDIRECT_URI}`;
    console.log("🧪 TIENDANUBE AUTH NUEVO:", authUrl);

    res.json({
      version: "tn-auth-v2-products",
      redirect: authUrl
    });
});

// 🔁 Auth: Callback
router.get('/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send('Código no encontrado');

    try {
        const response = await axios.post('https://www.tiendanube.com/apps/authorize/token', {
            client_id: TIENDANUBE_CLIENT_ID,
            client_secret: TIENDANUBE_CLIENT_SECRET,
            grant_type: 'authorization_code',
            redirect_uri: REDIRECT_URI, // 👈 Importante incluirlo si se usó en el paso anterior
            code
        });

        const { access_token, token_type, scope, user_id } = response.data;

        // Guardar token (Upsert)
        await TiendanubeToken.findOneAndUpdate(
            { user_id: user_id.toString() },
            { access_token, token_type, scope, created_at: new Date() },
            { upsert: true, new: true }
        );

        console.log('✅ Token Tiendanube guardado:', user_id);
        res.redirect('https://ctsistem1.netlify.app/ventas');

    } catch (error) {
        console.error('❌ Error Auth Tiendanube:', error.response?.data || error.message);
        res.status(500).send('Error en autenticación con Tiendanube');
    }
});

// 🔄 Sincronizar Ventas
let sincronizando = false;

router.get('/sincronizar-ventas', async (req, res) => {
    if (sincronizando) return res.json({ mensaje: 'Ya se está sincronizando...', sincronizando: true });

    sincronizando = true;
    res.json({ mensaje: 'Sincronización Tiendanube iniciada...', sincronizando: true });

    try {
        const tokenDoc = await TiendanubeToken.findOne();
        if (!tokenDoc) {
            console.error('❌ No hay token de Tiendanube');
            sincronizando = false;
            return;
        }

        const { access_token, user_id } = tokenDoc;

        // Obtener órdenes abiertas (pagadas, no archivadas, status 'open')
        // Tiendanube 'open' status generally means paid but not shipped/archived?
        // Let's verify 'status'. 'paid' payment status and 'unpacked' shipping status?
        // Simplest: get list and filter.

        console.log(`🌐 Consultando órdenes Tiendanube Store ${user_id}...`);

        const response = await axios.get(`https://api.tiendanube.com/v1/${user_id}/orders`, {
            headers: {
                'Authentication': `bearer ${access_token}`,
                'User-Agent': TIENDANUBE_USER_AGENT
            },
            params: {
                status: 'open', // Trae órdenes abiertas
                per_page: 50
            }
        });

        const orders = response.data;
        const ventasAGuardar = [];

        // Obtener estados existentes para preservar 'completada' / 'entregada'
        const ventasExistentes = await VentaModel.find({ esTiendanube: true });
        const estadosExistentes = {};
        ventasExistentes.forEach(v => {
            estadosExistentes[v.numeroVenta] = { completada: v.completada, entregada: v.entregada };
        });

        // Limpiar para resincronizar (estrategia simple: borrar y reinsertar, preservando flag)
        await VentaModel.deleteMany({ esTiendanube: true });

        for (const order of orders) {
            // Filtrar solo pagadas y NO enviadas/entregadas
            if (order.payment_status !== 'paid') continue;
            if (order.shipping_status === 'shipped' || order.shipping_status === 'delivered') continue; // 👈 Oculta enviadas/entregadas

            const numeroVenta = `TN-${order.id}`;
            const cliente = order.customer ? `${order.customer.name}` : order.billing_name || 'Desconocido';

            // Mapear Punto de Despacho
            const shippingOption = order.shipping_option || "";

            // Categoría fija para que Tiendanube no se mezcle con ML/manuales
            const puntoDespacho = "Ventas Tiendanube";

            // Productos
            for (const product of order.products) {
                const sku = product.sku || product.variant_sku || "Sin SKU";
                const nombre = `${product.name} ${product.variant_name ? '- ' + product.variant_name : ''}`;
                const cantidad = parseInt(product.quantity);
                const precio = product.price;
                const imagen = product.image ? product.image.src : null;

                const estadoPrevio = estadosExistentes[numeroVenta] || { completada: false, entregada: false };

                ventasAGuardar.push({
                numeroVenta: `${numeroVenta}-${product.id}`,
                sku,
                nombre,
                cantidad,
                cliente,
                puntoDespacho,
                imagen,
                esTiendanube: true,
                origen: "tiendanube",
                nota: order.note || "",
                tipoEnvio: shippingOption,
                completada: estadoPrevio.completada,
                entregada: estadoPrevio.entregada
                });
            }
        }

        if (ventasAGuardar.length > 0) {
            await VentaModel.insertMany(ventasAGuardar);
            console.log(`✅ ${ventasAGuardar.length} items de Tiendanube sincronizados.`);
        } else {
            console.log('ℹ️ No se encontraron ventas nuevas de Tiendanube.');
        }

    } catch (error) {
        console.error('❌ Error Sync Tiendanube:', error.response?.data || error.message);
    } finally {
        sincronizando = false;
    }
});

router.get('/estado-sincronizacion', (req, res) => {
    res.json({ sincronizando });
});



router.post('/actualizar-stock', async (req, res) => {
  const { sku, cantidad, precioBase } = req.body;

  if (!sku || cantidad === undefined || cantidad === null) {
    return res.status(400).json({
      error: 'Se requieren los campos "sku" y "cantidad".'
    });
  }

  if (typeof cantidad !== 'number' || cantidad < 0 || !Number.isInteger(cantidad)) {
    return res.status(400).json({
      error: '"cantidad" debe ser un número entero mayor o igual a 0.'
    });
  }

  if (
  precioBase !== undefined &&
  precioBase !== null &&
  (typeof precioBase !== "number" ||
    !Number.isFinite(precioBase) ||
    precioBase <= 0)
) {
  return res.status(400).json({
    error: '"precioBase" debe ser un número mayor que 0.'
  });
}

  try {
    const tokenDoc = await TiendanubeToken.findOne();

    if (!tokenDoc || !tokenDoc.access_token) {
      return res.status(401).json({
        error: 'No autenticado con Tiendanube.'
      });
    }

    const { access_token, user_id } = tokenDoc;

   console.log(`🔍 [TN] Buscando SKU: ${sku}`);

let productoEncontrado = null;
let varianteEncontrada = null;
let page = 1;
const perPage = 50;
const skuBuscado = String(sku).trim().toLowerCase();

while (!varianteEncontrada && page <= 20) {
  const productosResponse = await axios.get(
    `https://api.tiendanube.com/v1/${user_id}/products`,
    {
      headers: {
        Authentication: `bearer ${access_token}`,
        'User-Agent': TIENDANUBE_USER_AGENT
      },
      params: {
        page,
        per_page: perPage
      }
    }
  );

  const productos = productosResponse.data || [];

  console.log(`📦 [TN] Página ${page}: ${productos.length} productos`);

  for (const producto of productos) {
    const variantes = producto.variants || [];

    const variante = variantes.find((v) => {
      const skuVariante = String(v.sku || '').trim().toLowerCase();
      return skuVariante === skuBuscado;
    });

    if (variante) {
      productoEncontrado = producto;
      varianteEncontrada = variante;
      console.log(
        `✅ [TN] SKU encontrado: ${sku} | Producto ${producto.id} | Variante ${variante.id}`
      );
      break;
    }
  }

  if (productos.length < perPage) break;
  page++;
}

    if (!productoEncontrado || !varianteEncontrada) {
      return res.status(404).json({
        error: `No se encontró el SKU "${sku}" en Tiendanube.`
      });
    }

    let preciosCalculados = null;

if (precioBase !== undefined && precioBase !== null) {
  preciosCalculados = calcularPreciosTiendanube(precioBase);

  console.log(`💰 [TN] Precios calculados para ${sku}:`, {
    precioBase,
    cuotas: preciosCalculados.cuotas,
    costoTotalPorcentaje: Number(
      (preciosCalculados.costoTotal * 100).toFixed(4)
    ),
    precioPromocional: preciosCalculados.precioPromocional,
    precioLista: preciosCalculados.precioLista,
  });
}

   const datosVariante = {
  id: varianteEncontrada.id,
  inventory_levels: [
    {
      stock: cantidad
    }
  ]
};

if (preciosCalculados) {
  datosVariante.price = preciosCalculados.precioLista;
  datosVariante.promotional_price =
    preciosCalculados.precioPromocional;
}

    await axios.patch(
      `https://api.tiendanube.com/v1/${user_id}/products/stock-price`,
      [
        {
          id: productoEncontrado.id,
          variants: [datosVariante]
        }
      ],
      {
        headers: {
          Authentication: `bearer ${access_token}`,
          'User-Agent': TIENDANUBE_USER_AGENT,
          'Content-Type': 'application/json'
        }
      }
    );



    return res.json({
    success: true,
    sku,
    cantidad,
    product_id: productoEncontrado.id,
    variant_id: varianteEncontrada.id,

    precios: preciosCalculados
      ? {
          precioBase,
          cuotas: preciosCalculados.cuotas,
          costoTotalPorcentaje: Number(
            (preciosCalculados.costoTotal * 100).toFixed(4)
          ),
          precioPromocional: preciosCalculados.precioPromocional,
          precioLista: preciosCalculados.precioLista,
        }
      : null,

    mensaje: preciosCalculados
      ? `Stock y precios actualizados. Promocional: $${preciosCalculados.precioPromocional.toLocaleString(
          "es-AR"
        )} | Lista: $${preciosCalculados.precioLista.toLocaleString("es-AR")}`
      : `Stock Tiendanube actualizado correctamente a ${cantidad} unidades.`
  });
  } catch (error) {
    console.error('❌ Error al actualizar stock en Tiendanube:', error.response?.data || error.message);

    return res.status(500).json({
      error: 'Error al actualizar el stock en Tiendanube.',
      detalle: error.response?.data || error.message
    });
  }
});

router.post("/actualizar-stock-masivo", async (req, res) => {
  const { productos } = req.body;

  if (!Array.isArray(productos) || productos.length === 0) {
    return res.status(400).json({
      error: 'Se requiere un array "productos" con al menos un elemento.',
    });
  }

  const productosInvalidos = productos.filter((producto) => {
    return (
      !producto.sku ||
      typeof producto.cantidad !== "number" ||
      !Number.isInteger(producto.cantidad) ||
      producto.cantidad < 0 ||
      typeof producto.precioBase !== "number" ||
      !Number.isFinite(producto.precioBase) ||
      producto.precioBase <= 0
    );
  });

  if (productosInvalidos.length > 0) {
    return res.status(400).json({
      error: "Hay productos con SKU, cantidad o precioBase inválidos.",
      productosInvalidos: productosInvalidos.map((producto) => producto.sku),
    });
  }

  try {
    const tokenDoc = await TiendanubeToken.findOne();

    if (!tokenDoc?.access_token) {
      return res.status(401).json({
        error: "No autenticado con Tiendanube.",
      });
    }

    const { access_token, user_id } = tokenDoc;

    /*
     * 1. Descargar el catálogo una sola vez.
     */
    const mapaVariantes = new Map();

    let page = 1;
    const perPage = 50;

    while (page <= 100) {
      const response = await axios.get(
        `https://api.tiendanube.com/v1/${user_id}/products`,
        {
          headers: {
            Authentication: `bearer ${access_token}`,
            "User-Agent": TIENDANUBE_USER_AGENT,
          },
          params: {
            page,
            per_page: perPage,
          },
        }
      );

      const catalogo = response.data || [];

      console.log(
        `📦 [TN MASIVO] Página ${page}: ${catalogo.length} productos`
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

    console.log(
      `✅ [TN MASIVO] ${mapaVariantes.size} variantes indexadas por SKU`
    );

    /*
     * 2. Preparar resultados y actualizaciones.
     */
    const resultados = [];
    const actualizacionesPorProducto = new Map();
    const preciosPorProducto = new Map();

    for (const productoEntrada of productos) {
      const sku = String(productoEntrada.sku).trim();
      const skuNormalizado = sku.toLowerCase();

      const encontrada = mapaVariantes.get(skuNormalizado);

      if (!encontrada) {
        resultados.push({
          sku,
          success: false,
          error: `No se encontró el SKU "${sku}" en Tiendanube.`,
        });

        continue;
      }

      const precios = calcularPreciosTiendanube(
        productoEntrada.precioBase
      );

      /*
       * Conservamos el identificador de ubicación si Tiendanube lo devuelve.
       * Esto es importante para tiendas con inventario por sucursal.
       */
      const nivelInventarioActual =
        encontrada.inventoryLevels?.[0] || {};

      const inventoryLevel = {
        stock: productoEntrada.cantidad,
      };

      if (nivelInventarioActual.id !== undefined) {
        inventoryLevel.id = nivelInventarioActual.id;
      }

      if (nivelInventarioActual.location_id !== undefined) {
        inventoryLevel.location_id =
          nivelInventarioActual.location_id;
      }

    // Este objeto va al endpoint masivo /products/stock-price.
    // Ese endpoint solamente admite precio normal y stock.
    const varianteStockPrecio = {
      id: encontrada.variantId,
      price: precios.precioLista,
      inventory_levels: [inventoryLevel],
    };

    // Este objeto va al endpoint de variantes,
    // que sí admite promotional_price.
    const variantePrecios = {
      id: encontrada.variantId,
      price: precios.precioLista,
      promotional_price: precios.precioPromocional,
    };

      if (!actualizacionesPorProducto.has(encontrada.productId)) {
        actualizacionesPorProducto.set(encontrada.productId, {
          id: encontrada.productId,
          variants: [],
        });
      }

      actualizacionesPorProducto
      .get(encontrada.productId)
      .variants.push(varianteStockPrecio);

      if (!preciosPorProducto.has(encontrada.productId)) {
        preciosPorProducto.set(encontrada.productId, []);
      }

      preciosPorProducto
        .get(encontrada.productId)
        .push(variantePrecios);

      resultados.push({
        sku,
        success: true,
        pendienteDeEnvio: true,
        cantidad: productoEntrada.cantidad,
        precios: {
          precioBase: productoEntrada.precioBase,
          cuotas: precios.cuotas,
          costoTotalPorcentaje: Number(
            (precios.costoTotal * 100).toFixed(4)
          ),
          precioPromocional: precios.precioPromocional,
          precioLista: precios.precioLista,
        },
      });
    }

    /*
     * 3. El endpoint admite hasta 50 variantes por request.
     * Como el cuerpo agrupa variantes por producto, armamos lotes
     * contando la cantidad total de variantes.
     */
    const grupos = Array.from(actualizacionesPorProducto.values());

    const lotes = [];
    let loteActual = [];
    let variantesEnLote = 0;

    for (const grupo of grupos) {
      const cantidadVariantes = grupo.variants.length;

      if (
        loteActual.length > 0 &&
        variantesEnLote + cantidadVariantes > 50
      ) {
        lotes.push(loteActual);
        loteActual = [];
        variantesEnLote = 0;
      }

      loteActual.push(grupo);
      variantesEnLote += cantidadVariantes;
    }

    if (loteActual.length > 0) {
      lotes.push(loteActual);
    }

    /*
     * 4. Enviar los lotes a Tiendanube.
     */
    for (let i = 0; i < lotes.length; i++) {
      console.log(
        `🚀 [TN MASIVO] Enviando lote ${i + 1}/${lotes.length}`
      );

      await axios.patch(
        `https://api.tiendanube.com/v1/${user_id}/products/stock-price`,
        lotes[i],
        {
          headers: {
            Authentication: `bearer ${access_token}`,
            "User-Agent": TIENDANUBE_USER_AGENT,
            "Content-Type": "application/json",
          },
        }
      );
    }

    /*
    * 5. Actualizar precios promocionales.
    * /products/stock-price no admite promotional_price,
    * así que usamos el endpoint de variantes de cada producto.
    */
    const gruposPrecios = Array.from(preciosPorProducto.entries());

    for (let i = 0; i < gruposPrecios.length; i++) {
      const [productId, variantes] = gruposPrecios[i];

      console.log(
        `💰 [TN MASIVO] Actualizando promocionales ` +
        `${i + 1}/${gruposPrecios.length} | Producto ${productId}`
      );

      await axios.patch(
        `https://api.tiendanube.com/v1/${user_id}/products/${productId}/variants`,
        variantes,
        {
          headers: {
            Authentication: `bearer ${access_token}`,
            "User-Agent": TIENDANUBE_USER_AGENT,
            "Content-Type": "application/json",
          },
        }
      );
    }

    const exitosos = resultados.filter(
      (resultado) => resultado.success
    ).length;

    const errores = resultados.length - exitosos;

    return res.json({
      success: errores === 0,
      total: resultados.length,
      exitosos,
      errores,
      lotesEnviados: lotes.length,
      resultados: resultados.map(({ pendienteDeEnvio, ...resultado }) => ({
        ...resultado,
        mensaje: resultado.success
          ? `Stock y precios actualizados. Promocional: $${resultado.precios.precioPromocional.toLocaleString(
              "es-AR"
            )} | Lista: $${resultado.precios.precioLista.toLocaleString(
              "es-AR"
            )}`
          : undefined,
      })),
    });
  } catch (error) {
    console.error(
      "❌ Error en actualización masiva Tiendanube:",
      error.response?.data || error.message
    );

    return res.status(500).json({
      error: "Error al actualizar productos en Tiendanube.",
      detalle: error.response?.data || error.message,
    });
  }
});

module.exports = router;
