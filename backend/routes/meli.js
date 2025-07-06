// File: backend/routes/meli.js

const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const router = express.Router();

require('dotenv').config();

// Modelo MeliToken
const MeliTokenSchema = new mongoose.Schema({
  user_id: String,
  access_token: String,
  refresh_token: String,
  expires_in: Number,
  scope: String,
  created_at: { type: Date, default: Date.now },
});

const MeliToken = mongoose.models.MeliToken || mongoose.model('MeliToken', MeliTokenSchema);

const {
  MELI_CLIENT_ID,
  MELI_CLIENT_SECRET,
  MELI_REDIRECT_URI
} = process.env;

// 🔐 Ruta para iniciar autenticación o devolver si ya está autenticado
router.get('/auth', async (req, res) => {
  try {
    const token = await MeliToken.findOne();
    if (token && token.access_token) {
      return res.json({ autenticado: true });
    }

    const authUrl = `https://auth.mercadolibre.com.ar/authorization?response_type=code&client_id=${MELI_CLIENT_ID}&redirect_uri=${MELI_REDIRECT_URI}`;
    res.json({ redirect: authUrl });
  } catch (err) {
    console.error('Error en /meli/auth', err);
    res.status(500).json({ error: 'Error al generar URL de autenticación' });
  }
});

// 🔁 Callback después del login de Mercado Libre
router.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('Código no encontrado');

  try {
    const response = await axios.post('https://api.mercadolibre.com/oauth/token', null, {
      params: {
        grant_type: 'authorization_code',
        client_id: MELI_CLIENT_ID,
        client_secret: MELI_CLIENT_SECRET,
        code,
        redirect_uri: MELI_REDIRECT_URI,
      },
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    const { access_token, refresh_token, expires_in, scope, user_id } = response.data;

    await MeliToken.findOneAndUpdate(
      { user_id },
      { access_token, refresh_token, expires_in, scope },
      { upsert: true, new: true }
    );

    res.redirect(`${MELI_REDIRECT_URI}?success=true`);
  } catch (error) {
    console.error('Error en /meli/callback:', error.response?.data || error.message);
    res.status(500).send('Error al obtener el token');
  }
});

// Ruta: GET /meli/sincronizar-ventas
router.get('/sincronizar-ventas', async (req, res) => {
  try {
    const tokenDoc = await MeliToken.findOne();
    if (!tokenDoc || !tokenDoc.access_token) {
      return res.status(401).json({ error: 'No autenticado con Mercado Libre' });
    }

    const { access_token } = tokenDoc;

    // Obtener las órdenes pagadas
    const ordersRes = await axios.get(
      'https://api.mercadolibre.com/orders/search?seller=me&order.status=paid',
      { headers: { Authorization: `Bearer ${access_token}` } }
    );

    const ordenes = ordersRes.data.results;

    // Importar modelo de ventas manuales (ya existente)
    const Venta = mongoose.models.Venta || mongoose.model('Venta', new mongoose.Schema({
      sku: String,
      nombre: String,
      cantidad: Number,
      numeroVenta: String,
      cliente: String,
      puntoDespacho: String,
      completada: Boolean,
      entregada: Boolean,
      imagen: String // 🔸 Campo opcional para ventas ML
    }));

    const ventasAGuardar = [];

    for (const orden of ordenes) {
      const idVenta = orden.id.toString();

      // Evitar duplicados
      const existe = await Venta.findOne({ numeroVenta: idVenta });
      if (existe) continue;

      const item = orden.order_items[0];
      const title = item.item.title || '';
      const sku = item.item.seller_sku || '';
      const quantity = item.quantity || 1;
      const variation = item.item.variation_attributes?.map(attr => `${attr.name}: ${attr.value_name}`).join(' - ') || '';
      const nombreFinal = variation ? `${title} (${variation})` : title;
      const imagen = item.item.picture || ''; // La imagen del producto

      const cliente = orden.buyer?.nickname || 'Cliente';
      const numeroVenta = idVenta;

      // Determinar tipo de entrega
      const tipoEnvio = orden.shipping?.logistic_type;
      let puntoDespacho = 'Punto de Despacho';
      if (tipoEnvio === 'xd_drop_off') puntoDespacho = 'Llevar al Punto de Despacho';
      else if (tipoEnvio === 'pickup') puntoDespacho = 'Showroom';
      else if (tipoEnvio === 'fulfillment') puntoDespacho = 'Flex';
      else if (tipoEnvio === 'not_specified') puntoDespacho = 'Llevar al Expreso';

      ventasAGuardar.push(new Venta({
        sku,
        nombre: nombreFinal,
        cantidad: quantity,
        numeroVenta,
        cliente,
        puntoDespacho,
        completada: false,
        entregada: false,
        imagen
      }));
    }

    if (ventasAGuardar.length === 0) {
      return res.json({ mensaje: 'No hay nuevas ventas para sincronizar.' });
    }

    await Venta.insertMany(ventasAGuardar);
    res.json({ mensaje: `${ventasAGuardar.length} ventas sincronizadas con éxito.` });

  } catch (error) {
    console.error('❌ Error al sincronizar ventas:', error.response?.data || error.message);
    res.status(500).json({ error: 'Error al sincronizar ventas desde Mercado Libre' });
  }
});


module.exports = router;
