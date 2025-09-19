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



// Variable para controlar el estado de sincronización
let sincronizando = false;
let ultimaSincronizacion = null;

// Ruta: GET /meli/sincronizar-ventas
router.get('/sincronizar-ventas', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  
  // Si ya está sincronizando, devolver estado
  if (sincronizando) {
    return res.json({ 
      mensaje: 'Sincronización en progreso...', 
      sincronizando: true,
      ultimaSincronizacion 
    });
  }

  // Iniciar sincronización asíncrona
  sincronizando = true;
  console.log('🔄 Sincronizando ventas desde Mercado Libre...');
  
  // Responder inmediatamente
  res.json({ 
    mensaje: 'Sincronización iniciada. Procesando órdenes...', 
    sincronizando: true 
  });

  // Procesar en background
  procesarSincronizacion();
});

// Función para procesar la sincronización en background
async function procesarSincronizacion() {
  try {
        console.log('➡️ Iniciando sincronización de ventas Mercado Libre');
        let tokenDoc = await MeliToken.findOne(); // Busca el único token existente
        if (!tokenDoc || !tokenDoc.access_token) {
            console.error('❌ No autenticado con Mercado Libre');
            sincronizando = false;
            return;
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

        // Función auxiliar para obtener imagen del producto
        async function obtenerImagenProducto(itemId, accessToken, axios) {
          try {
            const { data } = await axios.get(`https://api.mercadolibre.com/items/${itemId}`, {
              headers: { Authorization: `Bearer ${accessToken}` }
            });

            // Priorizar secure_thumbnail, luego thumbnail, luego la primera imagen de pictures
            let imagenUrl = data.secure_thumbnail || data.thumbnail || (data.pictures && data.pictures[0]?.secure_url) || "";
            
            // Convertir HTTP a HTTPS si es necesario
            if (imagenUrl && imagenUrl.startsWith('http://')) {
              imagenUrl = imagenUrl.replace('http://', 'https://');
            }
            
            return imagenUrl;
          } catch (error) {
            console.error(`❌ Error obteniendo imagen para ${itemId}:`, error.response?.data || error.message);
            return "";
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
        console.log(`📊 Procesando ${ordenesFiltradas.length} órdenes filtradas`);

        // Resumen por tags
        const conteoTags = ordenesDetalladas.reduce((acc, o) => {
          (o.tags || []).forEach(t => acc[t] = (acc[t] || 0) + 1);
          return acc;
        }, {});
        // Log de tags removido por seguridad


      // Limpiar ventas anteriores de ML
      await Venta.deleteMany({ esML: true });
      console.log('🗑️ Ventas ML anteriores eliminadas');

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

          const cliente =
            (orden.buyer?.first_name && orden.buyer?.last_name
              ? `${orden.buyer.first_name} ${orden.buyer.last_name}`
              : orden.buyer?.nickname) || "Cliente Desconocido";

        // 👇 obtenemos info adicional de envío desde /shipments/:id
        const envio = await obtenerDatosEnvio(orden.shipping?.id, access_token, axios);

        // Log de procesamiento sin información sensible
        console.log(`📦 Procesando orden - tipoEnvio: ${envio.tipoEnvio}, status: ${envio.status}`);

        // 🔍 Filtrar ventas ya entregadas (fulfilled: true)
        if (orden.fulfilled === true) {
          console.log(`⏭️ Saltando orden - fulfilled: true (ya entregada)`);
          continue; // Saltar esta orden
        }

        // 🔍 Debug: mostrar info de la orden
        console.log(`🔍 Procesando orden - fulfilled: ${orden.fulfilled}, tags: ${orden.tags?.length || 0} tags`);

        // 🔍 Filtrar solo ventas con status "ready_to_ship" (solo para órdenes CON envío)
        if (orden.shipping?.id && envio.status !== "ready_to_ship") {
          console.log(`⏭️ Saltando orden - status: ${envio.status} (no es ready_to_ship)`);
          continue; // Saltar esta orden
        }

        // ✅ Las órdenes SIN shipment (A coordinar) se incluyen automáticamente
        if (!orden.shipping?.id) {
          console.log(`✅ Incluyendo orden - Sin shipment (A coordinar)`);
        }

        // 🚫 Filtrar ventas de tipo "Full" - no nos interesan por el momento (solo si tienen shipment)
        if (orden.shipping?.id && envio.tipoEnvio === "Full") {
          console.log(`⏭️ Saltando orden - tipoEnvio: ${envio.tipoEnvio} (no nos interesa)`);
          continue; // Saltar esta orden
        }

        // 👇 calculamos el punto de despacho basado en el tipo de envío real
        const puntoDespacho = orden.shipping?.id ? envio.tipoEnvio : "A coordinar";

        // Obtener imagen del producto desde el endpoint de items (solo para órdenes que pasan el filtro)
        const imagen = await obtenerImagenProducto(item.item.id, access_token, axios);
        console.log(`🖼️ Imagen obtenida: ${imagen ? 'Sí' : 'No'}`);

        // 👇 guardamos la venta en Mongo con ambos campos
        const ventaAGuardar = new Venta({
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
        });
        
        console.log(`💾 Guardando venta - Imagen: ${imagen ? 'Sí' : 'No'}`);
        ventasAGuardar.push(ventaAGuardar);

        }


      // Si no había nada nuevo
      if (ventasAGuardar.length === 0) {
        console.log('✅ No hay nuevas ventas para sincronizar.');
        ultimaSincronizacion = { 
          fecha: new Date(), 
          ventasSincronizadas: 0,
          mensaje: 'No hay nuevas ventas para sincronizar.'
        };
        sincronizando = false;
        return;
      }

      // Insertar lo nuevo
      await Venta.insertMany(ventasAGuardar);
      console.log(`✅ ${ventasAGuardar.length} ventas sincronizadas con éxito.`);
      
      // Verificar qué se guardó realmente
      const ventasGuardadas = await Venta.find({ esML: true }).sort({ _id: -1 }).limit(ventasAGuardar.length);
      const ventasConImagen = ventasGuardadas.filter(v => v.imagen && v.imagen.trim() !== '');
      console.log(`🔍 Verificación: ${ventasGuardadas.length} ventas ML en BD, ${ventasConImagen.length} con imagen`);

      ultimaSincronizacion = { 
        fecha: new Date(), 
        ventasSincronizadas: ventasAGuardar.length,
        mensaje: `${ventasAGuardar.length} ventas sincronizadas con éxito.`
      };

    } catch (error) {
        console.error('❌ Error al sincronizar ventas:', error.response?.data || error.message);
        ultimaSincronizacion = { 
          fecha: new Date(), 
          ventasSincronizadas: 0,
          error: error.message
        };
    } finally {
        sincronizando = false;
    }
}

// Ruta para verificar el estado de la sincronización
router.get('/estado-sincronizacion', (req, res) => {
  res.json({
    sincronizando,
    ultimaSincronizacion
  });
});

module.exports = router;