const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const router = express.Router();
require('dotenv').config();

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


// 🔐 Auth: Redirigir a Tiendanube
router.get('/auth', (req, res) => {
    const authUrl = `https://www.tiendanube.com/apps/${TIENDANUBE_CLIENT_ID}/authorize?response_type=code&scope=read_orders,write_orders,read_products,write_products&redirect_uri=${REDIRECT_URI}`;
    res.json({ redirect: authUrl });
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
  const { sku, cantidad } = req.body;

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

  try {
    const tokenDoc = await TiendanubeToken.findOne();

    if (!tokenDoc || !tokenDoc.access_token) {
      return res.status(401).json({
        error: 'No autenticado con Tiendanube.'
      });
    }

    const { access_token, user_id } = tokenDoc;

    const productosResponse = await axios.get(
      `https://api.tiendanube.com/v1/${user_id}/products`,
      {
        headers: {
          Authentication: `bearer ${access_token}`,
          'User-Agent': TIENDANUBE_USER_AGENT
        },
        params: {
          sku,
          per_page: 50
        }
      }
    );

    const productos = productosResponse.data || [];

    let productoEncontrado = null;
    let varianteEncontrada = null;

    for (const producto of productos) {
      const variantes = producto.variants || [];

      const variante = variantes.find((v) => {
        return String(v.sku || '').trim() === String(sku).trim();
      });

      if (variante) {
        productoEncontrado = producto;
        varianteEncontrada = variante;
        break;
      }
    }

    if (!productoEncontrado || !varianteEncontrada) {
      return res.status(404).json({
        error: `No se encontró el SKU "${sku}" en Tiendanube.`
      });
    }

    await axios.patch(
      `https://api.tiendanube.com/v1/${user_id}/products/stock-price`,
      [
        {
          id: productoEncontrado.id,
          variants: [
            {
              id: varianteEncontrada.id,
              inventory_levels: [
                {
                  stock: cantidad
                }
              ]
            }
          ]
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
      mensaje: `Stock Tiendanube actualizado correctamente a ${cantidad} unidades.`
    });
  } catch (error) {
    console.error('❌ Error al actualizar stock en Tiendanube:', error.response?.data || error.message);

    return res.status(500).json({
      error: 'Error al actualizar el stock en Tiendanube.',
      detalle: error.response?.data || error.message
    });
  }
});

module.exports = router;
