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

// Ruta de inspección: obtener detalle completo de una orden por ID
router.get('/orden/:id', async (req, res) => {
  const { id } = req.params;

  try {
    // Buscar el token guardado
    const tokenDoc = await MeliToken.findOne();
    if (!tokenDoc || !tokenDoc.access_token) {
      return res.status(401).json({ error: 'No autenticado con Mercado Libre.' });
    }

    const { access_token } = tokenDoc;

    // Llamar al endpoint de órdenes de ML
    const response = await axios.get(
      `https://api.mercadolibre.com/orders/${id}`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    );

    // Devolver el JSON completo de ML
    return res.json(response.data);

  } catch (error) {
    console.error('❌ Error al obtener orden específica:', error.response?.data || error.message);
    return res.status(500).json({ error: 'Error al obtener la orden de ML.' });
  }
});

// Ruta de inspección de un shipment
router.get('/shipment/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const tokenDoc = await MeliToken.findOne();
    if (!tokenDoc || !tokenDoc.access_token) {
      return res.status(401).json({ error: 'No autenticado con Mercado Libre.' });
    }

    const { access_token } = tokenDoc;

    const response = await axios.get(
      `https://api.mercadolibre.com/shipments/${id}`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    );

    res.json(response.data); // Devuelve todo el detalle del envío
  } catch (error) {
    console.error('❌ Error al obtener shipment:', error.response?.data || error.message);
    res.status(500).json({ error: 'Error al obtener shipment.' });
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
        // 1. Obtener las órdenes pagadas (básicas)
        const ordersSearch = await axios.get(
          `https://api.mercadolibre.com/orders/search?seller=${user_id}&order.status=paid&sort=date_desc`,
          { headers: { Authorization: `Bearer ${access_token}` } }
        );


        // Función auxiliar para obtener atributos de la variación
        async function obtenerAtributosDeVariacion(itemId, variationId, accessToken, axios) {
          try {
            const { data } = await axios.get(`https://api.mercadolibre.com/items/${itemId}`, {
              headers: { Authorization: `Bearer ${accessToken}` }
            });

            const variacion = data.variations?.find(v => v.id === variationId);
            if (variacion) {
              return variacion.attribute_combinations.map(attr => ({
                nombre: attr.name,
                valor: attr.value_name
              }));
            }
            return [];
          } catch (error) {
            console.error(`❌ Error obteniendo atributos para ${itemId} - ${variationId}:`, error.response?.data || error.message);
            return [];
          }
        }

        // Función auxiliar para obtener datos del envío
        async function obtenerDatosEnvio(shipmentId, accessToken, axios) {
        if (!shipmentId) {
          return { tipoEnvio: "A coordinar" }; // Sin envío asignado
        }

        try {
          const { data } = await axios.get(
            `https://api.mercadolibre.com/shipments/${shipmentId}`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );

          let tipoEnvio = "Desconocido";

          switch (data.logistic_type) {
            case "fulfillment":
              tipoEnvio = "Full";
              break;
            case "xd_drop_off":
              tipoEnvio = "Punto de Despacho";
              break;
            case "self_service":
              tipoEnvio = "Flex";  // 👈 ahora sí
              break;
            default:
              tipoEnvio = data.logistic_type || "A coordinar";
          }

          // Agregamos status para debug/uso futuro
          return {
            tipoEnvio,
            status: data.status,
            substatus: data.substatus,
            historial: data.substatus_history
          };

        } catch (error) {
          console.error(`❌ Error obteniendo envío ${shipmentId}:`, error.response?.data || error.message);
          return { tipoEnvio: "Error consultando envío" };
        }
      }



        // Importar modelo de ventas manuales (ya existente)
        const VentaSchema = new mongoose.Schema({
        sku: String,
        nombre: String,
        cantidad: Number,
        numeroVenta: { type: String, unique: true },
        cliente: String,
        puntoDespacho: String,
        completada: Boolean,
        entregada: Boolean,
        imagen: String,
        esML: { type: Boolean, default: false },
        variationId: String,
        atributos: [Object],
        tipoEnvio: String,
      });

        const Venta = mongoose.models.Venta || mongoose.model('Venta', VentaSchema);
        
        // 🆕 Función auxiliar para mapear tags de ML a tus puntos de despacho
        function mapTagsToPuntoDespacho(tags = []) {
          if (tags.includes("no_shipping")) return "Guardia";              // Retiro en persona
          if (tags.includes("self_service_in")) return "Punto de Despacho"; // Punto de retiro
          if (tags.includes("to_be_agreed")) return "Llevar al Expreso";    // Envío a coordinar
          if (tags.includes("not_delivered")) return "Punto de Despacho";   // Pendiente de entrega
          return "Punto de Despacho"; // fallback seguro
        }

        const ventasAGuardar = [];


        // Lista de estados permitidos
        const estadosPermitidos = [
          "ready_to_ship",
          "pending",
          "not_delivered",
          "to_be_agreed",
          "paid" // agregado para cubrir más casos
        ];

        // Extraer las órdenes básicas
        const ordenesBasicas = ordersSearch.data.results;
        console.log(`📦 Se encontraron ${ordenesBasicas.length} órdenes pagadas.`);

        // 3. Traer detalles de cada orden
        const ordenesDetalladas = await Promise.all(
          ordenesBasicas.map(async (ordenBasica) => {
            const detalle = await axios.get(
              `https://api.mercadolibre.com/orders/${ordenBasica.id}`,
              { headers: { Authorization: `Bearer ${access_token}` } }
            );
            return detalle.data;
          })
        );
        console.log(`📦 Se obtuvieron detalles de ${ordenesDetalladas.length} órdenes.`);

       // Filtrar órdenes pendientes
        const ordenesFiltradas = ordenesDetalladas.filter((orden) => {
          const tags = orden.tags || [];

          // ✅ Incluir solo las órdenes pagadas
          if (!tags.includes("paid")) return false;

          // ✅ Incluir pendientes
          if (tags.includes("not_delivered")) return true;
          if (tags.includes("no_shipping")) return true;
          if (tags.includes("to_be_agreed")) return true;
          if (tags.includes("new_buyer_free_shipping")) return true;

          // 🚫 Excluir entregadas
          if (tags.includes("delivered")) return false;

          // Por defecto: descartar
          return false;
        });


        // Resumen general
        console.log(`📦 Órdenes filtradas para guardar: ${ordenesFiltradas.length}`);

        // Resumen por status
        const conteoStatus = ordenesDetalladas.reduce((acc, o) => {
          const st = o.shipping?.status || "sin shipping";
          acc[st] = (acc[st] || 0) + 1;
          return acc;
        }, {});
        console.log("📊 Conteo por shipping.status:", conteoStatus);

        // Resumen por tags
        const conteoTags = ordenesDetalladas.reduce((acc, o) => {
          (o.tags || []).forEach(t => acc[t] = (acc[t] || 0) + 1);
          return acc;
        }, {});
        console.log("🏷️ Conteo por tags:", conteoTags);


      // Limpiar ventas anteriores de ML
      await Venta.deleteMany({ esML: true });

        // Acá seguimos igual que antes, pero con ordenesFiltradas
        for (const orden of ordenesFiltradas) {
          const idVenta = orden.id.toString();

          const item = orden.order_items[0];
          const title = item.item.title || "";
          
          const variationId = item.item.variation_id || null;
          const quantity = item.quantity || 1;

          let atributos = [];
          if (variationId) {
            atributos = await obtenerAtributosDeVariacion(
              item.item.id,
              variationId,
              access_token,
              axios
            );
          }

          const sku = item.item.seller_sku || "Sin SKU";
          //  || // si lo cargaste manualmente en la publicación
          // (atributos.find(attr => attr.nombre === "SELLER_SKU")?.valor) || 
          // "Sin SKU";

          const variation = atributos.length > 0
            ? atributos.map(attr => `${attr.nombre}: ${attr.valor}`).join(" - ")
            : item.item.variation_attributes?.map(attr => `${attr.name}: ${attr.value_name}`).join(" - ") || "";

          const nombreFinal = variation ? `${title} (${variation})` : title;

          const imagen = item.item.thumbnail || item.item.secure_thumbnail || "";

          const cliente =
            (orden.buyer?.first_name && orden.buyer?.last_name
              ? `${orden.buyer.first_name} ${orden.buyer.last_name}`
              : orden.buyer?.nickname) || "Cliente Desconocido";

        // 👇 seguimos calculando el punto de despacho como hasta ahora
        const puntoDespacho = mapTagsToPuntoDespacho(orden.tags);

        // 👇 obtenemos info adicional de envío desde /shipments/:id
        const envio = await obtenerDatosEnvio(orden.shipping?.id, access_token, axios);

        console.log(`📦 Orden ${orden.id} - shipmentId: ${orden.shipping?.id}, tipoEnvio: ${envio.tipoEnvio}`);


        // 👇 guardamos la venta en Mongo con ambos campos
        ventasAGuardar.push(new Venta({
          sku,
          nombre: nombreFinal,
          cantidad: quantity,
          numeroVenta: idVenta,
          cliente,
          puntoDespacho,
          completada: false,
          entregada: false,
          imagen,
          esML: true,
          variationId,
          atributos,
          tipoEnvio: envio.tipoEnvio   // 🔑 Nuevo campo
        }));

        }


      // Si no había nada nuevo
      if (ventasAGuardar.length === 0) {
        const ventasFinales = await Venta.find({});
        return res.json({
          mensaje: 'No hay nuevas ventas para sincronizar.',
          ventas: ventasFinales
        });
      }

      // Insertar lo nuevo
      await Venta.insertMany(ventasAGuardar);

      // 🔑 Traemos todas las ventas (manuales + ML) después de insertar
      const ventasFinales = await Venta.find({});

      res.json({
        mensaje: `${ventasAGuardar.length} ventas sincronizadas con éxito.`,
        ventas: ventasFinales
      });


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