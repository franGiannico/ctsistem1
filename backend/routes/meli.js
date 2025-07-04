// backend/routes/meli.js

const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const router = express.Router();

// --- Modelo de Mongoose para almacenar los tokens de Mercado Libre ---
// Este modelo guarda el access_token, refresh_token, etc.
const MeliTokenSchema = new mongoose.Schema({
  user_id: { type: String, required: true, unique: true },
  access_token: { type: String, required: true },
  refresh_token: { type: String, required: true },
  expires_in: { type: Number, required: true }, // Tiempo de vida del access_token en segundos
  scope: String,
  created_at: { type: Date, default: Date.now }, // Fecha de creación/última actualización del token
});

// Usamos mongoose.models?.MeliToken para evitar redefinir el modelo en hot-reloads
const MeliToken = mongoose.models?.MeliToken || mongoose.model('MeliToken', MeliTokenSchema);

// --- Variables de Entorno ---
// Asegúrate de que estas variables estén definidas en tu archivo .env del backend
const MELI_CLIENT_ID = process.env.MELI_CLIENT_ID;
const MELI_CLIENT_SECRET = process.env.MELI_CLIENT_SECRET;
const MELI_REDIRECT_URI = process.env.MELI_REDIRECT_URI; // URL de tu frontend donde ML redirigirá

// --- Función para refrescar el Access Token ---
async function refreshAccessToken(refreshToken) {
  try {
    const response = await axios.post('https://api.mercadolibre.com/oauth/token', null, {
      params: {
        grant_type: 'refresh_token',
        client_id: MELI_CLIENT_ID,
        client_secret: MELI_CLIENT_SECRET,
        refresh_token: refreshToken,
      },
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    const { access_token, refresh_token, expires_in, user_id, scope } = response.data;

    // Actualizar el token en la base de datos
    await MeliToken.findOneAndUpdate(
      { user_id },
      { access_token, refresh_token, expires_in, scope, created_at: Date.now() },
      { upsert: true, new: true } // upsert: crea si no existe, new: devuelve el documento actualizado
    );

    console.log('✅ Access Token de Mercado Libre refrescado exitosamente.');
    return access_token;
  } catch (error) {
    console.error('❌ Error al refrescar el Access Token de Mercado Libre:', error.response?.data || error.message);
    throw new Error('No se pudo refrescar el token de acceso.');
  }
}

// --- Ruta para iniciar la autenticación o verificar el estado ---
router.get('/auth', async (req, res) => {
  try {
    const tokenDoc = await MeliToken.findOne();

    // Verificar si ya tenemos un token y si aún es válido
    if (tokenDoc && tokenDoc.access_token) {
      const expirationTime = tokenDoc.created_at.getTime() + (tokenDoc.expires_in * 1000); // en milisegundos
      if (Date.now() < expirationTime - (60 * 1000)) { // Considerar válido hasta 1 minuto antes de expirar
        console.log('Token de ML existente y válido.');
        return res.json({ autenticado: true });
      } else {
        // El token está a punto de expirar o ya expiró, intentar refrescarlo
        console.log('Token de ML expirado o a punto de expirar, intentando refrescar...');
        try {
          await refreshAccessToken(tokenDoc.refresh_token);
          return res.json({ autenticado: true }); // Si se refrescó, consideramos autenticado
        } catch (refreshError) {
          console.warn('Fallo al refrescar el token, se requerirá nueva autenticación.');
          // Si falla el refresh, continuar con el flujo de autenticación
        }
      }
    }

    // Si no hay token o el refresh falló, redirigir para autenticar
    const authUrl = `https://auth.mercadolibre.com.ar/authorization?response_type=code&client_id=${MELI_CLIENT_ID}&redirect_uri=${MELI_REDIRECT_URI}`;
    console.log('Redirigiendo para autenticación de ML:', authUrl);
    res.json({ redirect: authUrl });
  } catch (err) {
    console.error('Error en /meli/auth:', err);
    res.status(500).json({ error: 'Error al generar URL de autenticación' });
  }
});

// --- Ruta de Callback de Mercado Libre (después de que el usuario autoriza) ---
router.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) {
    console.error('Código de autorización no encontrado en el callback de ML.');
    return res.status(400).send('Código de autorización no encontrado.');
  }

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

    // Guardar o actualizar el token en la base de datos
    await MeliToken.findOneAndUpdate(
      { user_id },
      { access_token, refresh_token, expires_in, scope, created_at: Date.now() },
      { upsert: true, new: true }
    );

    console.log('✅ Token de Mercado Libre obtenido y guardado exitosamente para user_id:', user_id);
    // Redirigir al frontend con un indicador de éxito
    res.redirect(`${MELI_REDIRECT_URI}?success=true`);
  } catch (error) {
    console.error('❌ Error en /meli/callback:', error.response?.data || error.message);
    res.status(500).send('Error al obtener el token de Mercado Libre.');
  }
});

// --- Ruta para obtener ventas de Mercado Libre ---
router.get('/ventas', async (req, res) => {
  try {
    let tokenDoc = await MeliToken.findOne();
    if (!tokenDoc) {
      console.warn('No hay token de ML guardado, se requiere autenticación.');
      return res.status(401).json({ error: 'No autenticado con Mercado Libre. Por favor, conecta tu cuenta.' });
    }

    let currentAccessToken = tokenDoc.access_token;
    const expirationTime = tokenDoc.created_at.getTime() + (tokenDoc.expires_in * 1000);

    // Verificar si el token está expirado o a punto de expirar y refrescarlo
    if (Date.now() >= expirationTime - (60 * 1000)) { // Si expira en menos de 1 minuto o ya expiró
      console.log('Access token de ML expirado o a punto de expirar. Refrescando...');
      try {
        currentAccessToken = await refreshAccessToken(tokenDoc.refresh_token);
        // Después de refrescar, obtenemos el documento actualizado para asegurar que tenemos el user_id
        tokenDoc = await MeliToken.findOne({ user_id: tokenDoc.user_id });
        if (!tokenDoc) throw new Error('Token document not found after refresh.');
      } catch (refreshError) {
        console.error('Fallo el refresco del token de ML:', refreshError.message);
        return res.status(401).json({ error: 'Token de Mercado Libre expirado o inválido. Por favor, vuelve a conectar tu cuenta.' });
      }
    }

    // Obtener las órdenes/ventas del vendedor
    // Puedes ajustar los parámetros de búsqueda según tus necesidades
    // Por ejemplo: 'order.status=paid' para solo ventas pagadas
    // 'limit', 'offset' para paginación
    const ordersResponse = await axios.get(`https://api.mercadolibre.com/orders/search?seller=${tokenDoc.user_id}&order.status=paid`, {
      headers: {
        Authorization: `Bearer ${currentAccessToken}`,
      },
    });

    // Los datos brutos de las ventas se imprimirán en la consola del backend
    console.log('--- Datos de Ventas de Mercado Libre (RAW desde ML API) ---');
    console.log(ordersResponse.data);
    console.log('----------------------------------------------------------');

    // Puedes mapear los datos a un formato más simple si lo deseas para el frontend
    const ventasSimplificadas = ordersResponse.data.results.map((orden) => ({
      id: orden.id,
      status: orden.status,
      date_created: orden.date_created,
      total_amount: orden.total_amount,
      buyer_nickname: orden.buyer.nickname,
      items: orden.order_items.map(item => ({
        item_id: item.item.id,
        title: item.item.title,
        quantity: item.quantity,
        unit_price: item.unit_price,
      }))
    }));

    res.json({ ventas: ventasSimplificadas });
  } catch (error) {
    console.error('❌ Error al obtener ventas de Mercado Libre:', error.response?.data || error.message);
    res.status(500).json({ error: 'Error al obtener ventas de Mercado Libre.' });
  }
});

module.exports = router;
