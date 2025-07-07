// File: backend/routes/meli.js

const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const router = express.Router();

require('dotenv').config();

// Modelo MeliToken
const MeliTokenSchema = new mongoose.Schema({
    user_id: { type: String, unique: true, required: true }, // Asegura unicidad del user_id de ML
    access_token: String,
    refresh_token: String,
    expires_in: Number, // Segundos hasta la expiración
    scope: String,
    created_at: { type: Date, default: Date.now }, // Para calcular la expiración
});

// Puedes quitar el user_id de la clave única si solo esperas un token general para la app
// Si es para un solo usuario en tu app, podrías hacer que 'user_id' sea un valor fijo o eliminarlo del findOne.
// Para simplificar, asumo que el user_id de ML siempre será el mismo para esta cuenta única.
const MeliToken = mongoose.models.MeliToken || mongoose.model('MeliToken', MeliTokenSchema);

const {
    MELI_CLIENT_ID,
    MELI_CLIENT_SECRET,
    MELI_REDIRECT_URI
} = process.env;

// Función para refrescar el token
async function refreshMeliToken(tokenDoc) {
    console.log('🔄 Intentando refrescar token de Mercado Libre...');
    try {
        const response = await axios.post('https://api.mercadolibre.com/oauth/token', null, {
            params: {
                grant_type: 'refresh_token',
                client_id: MELI_CLIENT_ID,
                client_secret: MELI_CLIENT_SECRET,
                refresh_token: tokenDoc.refresh_token,
            },
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });

        const { access_token, refresh_token, expires_in, user_id } = response.data;

        // Actualizar el documento del token en la base de datos
        tokenDoc.access_token = access_token;
        tokenDoc.refresh_token = refresh_token;
        tokenDoc.expires_in = expires_in;
        tokenDoc.created_at = new Date(); // Resetear el tiempo de creación para el nuevo token
        tokenDoc.user_id = user_id; // Asegurar que el user_id de ML esté actualizado
        await tokenDoc.save();

        console.log('✅ Token de Mercado Libre refrescado y guardado correctamente.');
        return access_token;
    } catch (error) {
        console.error('❌ Error al refrescar token de Mercado Libre:', error.response?.data || error.message);
        throw new Error('No se pudo refrescar el token de Mercado Libre.');
    }
}


// 🔐 Ruta para iniciar autenticación o devolver si ya está autenticado
router.get('/auth', async (req, res) => {
    try {
        // Busca el token. Para una app de un solo usuario, solo busca cualquier token.
        // Si tu app gestiona usuarios, aquí buscarías el token del usuario actual.
        const token = await MeliToken.findOne();

        if (token && token.access_token) {
            // Opcional: Podrías aquí refrescar el token si está cerca de expirar para evitar fallos inmediatos
            // Pero es mejor dejar el refresh en la ruta de sincronización para mantener /auth simple.
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
    if (!code) return res.status(400).send('Código de autorización no encontrado.');

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

        // **Estrategia para un solo token de ML por aplicación:**
        // Borra cualquier token existente y crea uno nuevo.
        // Esto asegura que siempre solo haya un token activo en la BD.
        await MeliToken.deleteMany({}); // Elimina todos los documentos existentes
        await MeliToken.create({ access_token, refresh_token, expires_in, scope, user_id });

        console.log('✅ Token de Mercado Libre guardado exitosamente.');
        res.redirect('https://ctsistem1.netlify.app/ventas'); // Redirige a tu aplicación frontend después de guardar el token
      } catch (error) {
          console.error('❌ [CALLBACK] Error completo en /meli/callback:', error);
          console.error('❌ [CALLBACK] Error de respuesta de ML:', error.response?.data || error.message);
          // Si hay un error, puedes redirigir a una página de error o a la página principal con un mensaje.
          res.redirect('https://ctsistem1.netlify.app/ventas?error=meli_auth_failed'); // Ejemplo de redirección con error
      }
});

// Ruta: GET /meli/sincronizar-ventas
router.get('/sincronizar-ventas', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  console.log('🔄 Sincronizando ventas desde Mercado Libre...');
    try {
        console.log('➡️ Iniciando sincronización de ventas Mercado Libre');
        let tokenDoc = await MeliToken.findOne(); // Busca el único token existente
        if (!tokenDoc || !tokenDoc.access_token) {
            return res.status(401).json({ error: 'No autenticado con Mercado Libre. Por favor, conecta tu cuenta.' });
        }

        // Verificar si el token ha expirado o está cerca de expirar (ej. en los últimos 5 minutos de su vida útil)
        const now = Date.now();
        const tokenCreatedAt = new Date(tokenDoc.created_at).getTime();
        const expiresInMs = tokenDoc.expires_in * 1000; // Convertir segundos a milisegundos
        const bufferTimeMs = 5 * 60 * 1000; // 5 minutos antes de la expiración real

        if (now > tokenCreatedAt + expiresInMs - bufferTimeMs) {
            console.log('El token de ML está expirado o a punto de expirar. Intentando refrescar...');
            try {
                tokenDoc.access_token = await refreshMeliToken(tokenDoc); // Llama a la función de refresco
            } catch (refreshError) {
                console.error('Fallo al refrescar el token:', refreshError.message);
                return res.status(401).json({ error: 'Token de Mercado Libre expirado y no se pudo refrescar. Por favor, vuelve a autenticarte.' });
            }
        }

        const { access_token, user_id } = tokenDoc; // <-- Aseguramos que user_id también se obtiene
        console.log('✅ Token válido. Obteniendo órdenes del usuario:', user_id);

        // Obtener las órdenes pagadas
        const ordersRes = await axios.get(
            `https://api.mercadolibre.com/orders/search?seller=${user_id}&order.status=paid&sort=date_desc`,
            { headers: { Authorization: `Bearer ${access_token}` } }
        );

        // ✅ Filtrar solo las órdenes con shipping.status deseados
        const estadosPermitidos = ['ready_to_ship', 'not_delivered', 'pending'];

        const ordenes = ordersRes.data.results.filter(orden =>
          estadosPermitidos.includes(orden.shipping?.status));
          console.log(`📦 Se recibieron ${ordenes.length} órdenes desde Mercado Libre`);

          if (ordenes.length === 0) {
            console.log('🔍 No hay órdenes nuevas en ML');
            return res.json({ mensaje: 'No hay nuevas ventas para sincronizar.', ventas: [] });
          }

        // Importar modelo de ventas manuales (ya existente) - asegúrate de que esté definido correctamente
        // Lo ideal es que VentaSchema y Venta model estén definidos al inicio del archivo o en un archivo de modelos separado.
        const VentaSchema = new mongoose.Schema({
            sku: String,
            nombre: String,
            cantidad: Number,
            numeroVenta: { type: String, unique: true },
            cliente: String,
            puntoDespacho: String,
            completada: Boolean,
            entregada: Boolean,
            imagen: String
        });
        const Venta = mongoose.models.Venta || mongoose.model('Venta', VentaSchema);

        const ventasAGuardar = [];

        for (const orden of ordenes) {
            const idVenta = orden.id.toString();

            // Evitar duplicados: Si ya existe una venta con este numeroVenta, no la agregues.
            const existe = await Venta.findOne({ numeroVenta: idVenta });
            if (existe) {
                console.log(`Venta ML ${idVenta} ya existe, omitiendo.`);
                continue;
            }

            const item = orden.order_items[0];
            const title = item.item.title || '';
            const sku = item.item.seller_sku || '';
            const quantity = item.quantity || 1;
            const variation = item.item.variation_attributes?.map(attr => `${attr.name}: ${attr.value_name}`).join(' - ') || '';
            const nombreFinal = variation ? `${title} (${variation})` : title;
            const imagen = item.item.picture || '';

            const cliente = orden.buyer?.nickname || 'Cliente Desconocido';
            const numeroVenta = idVenta;

            // Determinar tipo de entrega
            const shippingMode = orden.shipping?.mode;
            const logisticType = orden.shipping?.logistic_type;
            let puntoDespacho = 'Punto de Despacho';

              if (shippingMode === 'me2') { // Mercado Envíos
              if (logisticType === 'self_service') {
                  puntoDespacho = 'Flex'; // Usado para envíos Flex
              } else if (logisticType === 'drop_off') {
                  puntoDespacho = 'Punto de Despacho'; // El vendedor lleva el paquete a un punto de despacho
              } else if (logisticType === 'xd_drop_off') {
                  puntoDespacho = 'Punto de Despacho'; // El vendedor lleva el paquete a un punto de despacho Express
              } else if (logisticType === 'pickup') {
                  puntoDespacho = 'Showroom'; // El comprador retira el producto por el domicilio del vendedor
              } else if (logisticType === 'cross_docking') {
                  puntoDespacho = 'Retira el Expreso'; // Retira el Expreso por el domicilio del vendedor
              }
          } else if (shippingMode === 'not_specified') {
              puntoDespacho = 'Llevar al Expreso'; // Acordar con el cliente el envío, generalmente se lleva al expreso
          }


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
        // Manejo específico para el error 403 de Mercado Libre
        if (error.response && error.response.status === 403) {
            return res.status(403).json({ error: 'Permisos insuficientes o ID de usuario no coincide con el token. Por favor, re-autentica o verifica la configuración de tu aplicación en Mercado Libre.' });
        }
        res.status(500).json({ error: 'Error al sincronizar ventas desde Mercado Libre' });
    }
});

module.exports = router;