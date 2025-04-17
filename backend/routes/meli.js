const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();
const router = express.Router();

// Modelo directamente acá
const MeliTokenSchema = new mongoose.Schema({
  user_id: String,
  access_token: String,
  refresh_token: String,
  expires_in: Number,
  scope: String,
  created_at: { type: Date, default: Date.now },
});

const MeliToken = mongoose.models?.MeliToken || mongoose.model('MeliToken', MeliTokenSchema);

// Variables de entorno
const {
  MELI_CLIENT_ID,
  MELI_CLIENT_SECRET,
  MELI_REDIRECT_URI,
} = process.env;

// Ruta para verificar autenticación o devolver URL de login
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

// Callback de Mercado Libre
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

// Ruta para obtener ventas
router.get('/ventas', async (req, res) => {
  try {
    const tokenDoc = await MeliToken.findOne();
    if (!tokenDoc) return res.status(401).json({ error: 'No autenticado' });

    const { access_token } = tokenDoc;

    const ordersResponse = await axios.get('https://api.mercadolibre.com/orders/search?seller=me&order.status=paid', {
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    });

    const ventas = ordersResponse.data.results.map((orden) => ({
      id: orden.id,
      title: orden.order_items[0].item.title,
      quantity: orden.order_items[0].quantity,
      unit_price: orden.order_items[0].unit_price,
    }));

    res.json({ ventas });
  } catch (error) {
    console.error('Error al obtener ventas:', error.response?.data || error.message);
    res.status(500).json({ error: 'Error al obtener ventas' });
  }
});

module.exports = router;
