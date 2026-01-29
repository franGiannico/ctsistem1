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
  // Log removido por seguridad

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
    // Log removido por seguridad
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
    // Log removido por seguridad

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

    // Función auxiliar para obtener notas de la orden
    async function obtenerNotasOrden(orderId, accessToken, axios) {
      try {
        console.log(`🕵️ Buscando notas para orden ${orderId}...`);
        const { data } = await axios.get(
          `https://api.mercadolibre.com/orders/${orderId}/notes`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        console.log(`📦 Respuesta Notas para ${orderId}:`, JSON.stringify(data));

        // data es un array de objetos (uno por cada orden solicitada).
        // Estructura: [{ "order_id": ..., "results": [ { "note": "..." }, ... ] }]
        if (data && data.length > 0 && data[0].results) {
          const notasDetectadas = data[0].results.map(n => n.note).join(" | ");
          console.log(`✅ Notas encontradas: ${notasDetectadas}`);
          return notasDetectadas;
        }
        console.log(`⚠️ Array de notas vacío o sin resultados para ${orderId}`);
        return "";
      } catch (error) {
        // Es común que no haya notas o de 404 si no existen, no es crítico
        console.error(`❌ Error buscando notas orden ${orderId}:`, error.response?.data || error.message);
        return "";
      }
    }



    // Importar modelo de ventas unificado
    const Venta = require("../models/Venta");

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
    // Log removido por seguridad

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
    // Log removido por seguridad

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
    // Log removido por seguridad

    // Resumen por status
    const conteoStatus = ordenesDetalladas.reduce((acc, o) => {
      const st = o.shipping?.status || "sin shipping";
      acc[st] = (acc[st] || 0) + 1;
      return acc;
    }, {});
    // Log removido por seguridad

    // Resumen por tags
    const conteoTags = ordenesDetalladas.reduce((acc, o) => {
      (o.tags || []).forEach(t => acc[t] = (acc[t] || 0) + 1);
      return acc;
    }, {});
    // Log de tags removido por seguridad


    // Obtener estados existentes de ventas ML antes de sincronizar
    const ventasExistentes = await Venta.find({ esML: true });
    const estadosExistentes = {};
    ventasExistentes.forEach(venta => {
      estadosExistentes[venta.numeroVenta] = {
        completada: venta.completada,
        entregada: venta.entregada
      };
    });
    console.log(`📊 Estados preservados para ${Object.keys(estadosExistentes).length} ventas ML existentes`);

    // Limpiar ventas anteriores de ML
    await Venta.deleteMany({ esML: true });
    // Log removido por seguridad

    // Acá seguimos igual que antes, pero con ordenesFiltradas
    for (const orden of ordenesFiltradas) {
      const packId = orden.pack_id ? orden.pack_id.toString() : null;
      const orderId = orden.id.toString();
      const numeroVenta = packId ? `${packId}-${orderId}` : orderId;
      const packLog = packId ? packId : 'null';
      console.log(`🔍 Procesando orden: ID=${orden.id}, PackID=${packLog}, Usando=${numeroVenta}`);

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

      const sku = item.item.seller_sku ||
        (atributos.find(attr => attr.nombre === "SELLER_SKU")?.valor) ||
        "Sin SKU";

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

      // Log removido por seguridad

      // 🔍 Filtrar ventas ya entregadas (fulfilled: true)
      if (orden.fulfilled === true) {
        // Log removido por seguridad
        continue; // Saltar esta orden
      }

      // 🔍 Debug: mostrar info de la orden
      // Log removido por seguridad

      // 🔍 Filtrar solo ventas con status "ready_to_ship" (solo para órdenes CON envío)
      if (orden.shipping?.id && envio.status !== "ready_to_ship") {
        // Log removido por seguridad
        continue; // Saltar esta orden
      }

      // ✅ Las órdenes SIN shipment (A coordinar) se incluyen automáticamente
      if (!orden.shipping?.id) {
        // Log removido por seguridad
      }

      // 🚫 Filtrar ventas de tipo "Full" - no nos interesan por el momento (solo si tienen shipment)
      if (orden.shipping?.id && envio.tipoEnvio === "Full") {
        // Log removido por seguridad
        continue; // Saltar esta orden
      }

      // 👇 calculamos el punto de despacho basado en el tipo de envío real
      const puntoDespacho = orden.shipping?.id ? envio.tipoEnvio : "A coordinar";

      // Obtener imagen del producto
      const imagen = await obtenerImagenProducto(item.item.id, access_token, axios);

      // 👇 Obtener notas SOLO si es 'A coordinar' (o para todas si prefieres)
      // El usuario pidió específicamente para las ventas "a acordar".
      let notaOrden = "";
      console.log(`🧐 Verificando orden ${numeroVenta}: PuntoDespacho='${puntoDespacho}'`);

      if (puntoDespacho === "A coordinar") {
        console.log(`🚀 Intentando obtener notas para ${numeroVenta}`);
        notaOrden = await obtenerNotasOrden(orden.id, access_token, axios);
        if (notaOrden) console.log(`📝 Nota FINAL encontrada para venta ${numeroVenta}: ${notaOrden}`);
      }

      // 👇 guardamos la venta en Mongo preservando estados existentes
      const estadoExistente = estadosExistentes[numeroVenta] || { completada: false, entregada: false };
      const ventaAGuardar = new Venta({
        sku,
        nombre: nombreFinal,
        cantidad: quantity,
        numeroVenta,
        packId,
        cliente,
        puntoDespacho,
        completada: estadoExistente.completada,
        entregada: estadoExistente.entregada,
        imagen,
        esML: true,
        variationId,
        atributos,
        tipoEnvio: envio.tipoEnvio,
        nota: notaOrden // 🔑 Guardamos la nota
      });

      console.log(`💾 Guardando venta: Usando=${numeroVenta} (ID=${orden.id}, PackID=${packLog}) - ${nombreFinal} - ${cliente} - Estados: completada=${estadoExistente.completada}, entregada=${estadoExistente.entregada}`);

      // Log removido por seguridad
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
    // Log removido por seguridad

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

// Ruta para obtener datos de facturación de una venta ML
router.get('/factura/:id', async (req, res) => {
  const numeroVenta = req.params.id;
  console.log(`🔍 Buscando factura para venta: ${numeroVenta}`);

  // Obtener token fuera del try para que esté disponible en el catch
  let tokenDoc = await MeliToken.findOne();
  console.log(`🔑 Token encontrado:`, tokenDoc ? 'Sí' : 'No');

  if (!tokenDoc || !tokenDoc.access_token) {
    console.log('❌ No hay token válido');
    return res.status(401).json({ error: 'No autenticado con Mercado Libre.' });
  }

  console.log(`🔑 Token válido encontrado, user_id: ${tokenDoc.user_id}`);

  // Verificar si el token ha expirado o está cerca de expirar
  const now = Date.now();
  const tokenCreatedAt = new Date(tokenDoc.created_at).getTime();
  const expiresInMs = tokenDoc.expires_in * 1000; // Convertir segundos a milisegundos
  const bufferTimeMs = 5 * 60 * 1000; // 5 minutos antes de la expiración real

  if (now > tokenCreatedAt + expiresInMs - bufferTimeMs) {
    console.log('🔄 Token de ML está expirado o a punto de expirar. Intentando refrescar...');
    try {
      tokenDoc.access_token = await refreshMeliToken(tokenDoc);
      console.log('✅ Token refrescado exitosamente');
    } catch (refreshError) {
      console.error('❌ Fallo al refrescar el token:', refreshError.message);
      return res.status(401).json({ error: 'Token de Mercado Libre expirado y no se pudo refrescar. Por favor, vuelve a autenticarte.' });
    }
  }

  const accessToken = tokenDoc.access_token;

  try {
    console.log(`🌐 Consultando orden ${numeroVenta} en ML...`);

    // Buscar la orden en ML
    const ordenResponse = await axios.get(`https://api.mercadolibre.com/orders/${numeroVenta}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const orden = ordenResponse.data;

    // Los datos de facturación están en la orden misma, no en un endpoint separado
    console.log(`🔍 Analizando datos de facturación en la orden...`);
    console.log(`📋 Buyer completo:`, orden.buyer);
    console.log(`📋 Payments:`, orden.payments);
    console.log(`📋 Shipping:`, orden.shipping);

    // Intentar obtener datos del usuario para facturación
    let datosUsuario = {};
    if (orden.buyer?.id) {
      try {
        console.log(`🔍 Consultando datos del usuario: ${orden.buyer.id}`);
        const usuarioResponse = await axios.get(`https://api.mercadolibre.com/users/${orden.buyer.id}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        datosUsuario = usuarioResponse.data;
        console.log(`✅ Datos del usuario obtenidos:`, datosUsuario);
      } catch (usuarioError) {
        console.log(`⚠️ No se pudo obtener datos del usuario:`, usuarioError.message);
      }
    }

    // Intentar obtener datos de billing info para el DNI
    let datosBilling = {};
    if (orden.buyer?.billing_info?.id) {
      try {
        console.log(`🔍 Consultando billing info: ${orden.buyer.billing_info.id}`);
        const billingResponse = await axios.get(`https://api.mercadolibre.com/users/${orden.buyer.id}/billing_info`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        datosBilling = billingResponse.data;
        console.log(`✅ Datos de billing obtenidos:`, datosBilling);
      } catch (billingError) {
        console.log(`⚠️ No se pudo obtener billing info:`, billingError.message);
      }
    }

    // Declarar payment antes de usarlo
    const payment = orden.payments?.[0];

    // Intentar obtener datos del payment específico
    let datosPayment = {};
    if (payment?.id) {
      try {
        console.log(`🔍 Consultando payment: ${payment.id}`);
        const paymentResponse = await axios.get(`https://api.mercadolibre.com/v1/payments/${payment.id}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        datosPayment = paymentResponse.data;
        console.log(`✅ Datos de payment obtenidos:`, datosPayment);
      } catch (paymentError) {
        console.log(`⚠️ No se pudo obtener payment:`, paymentError.message);
      }
    }

    // Intentar obtener datos de shipping para la dirección
    let datosEnvio = {};
    if (orden.shipping?.id) {
      try {
        console.log(`🔍 Consultando shipping: ${orden.shipping.id}`);
        const shippingResponse = await axios.get(`https://api.mercadolibre.com/shipments/${orden.shipping.id}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        datosEnvio = shippingResponse.data;
        console.log(`✅ Shipping obtenido:`, datosEnvio);
      } catch (shippingError) {
        console.log(`⚠️ No se pudo obtener shipping:`, shippingError.message);
      }
    } else {
      console.log(`⚠️ Orden sin shipping.id - tipo "Acordás la entrega"`);
    }

    const producto = orden.order_items[0]?.item.title || '';
    const cantidad = orden.order_items[0]?.quantity || 1;
    const precio = orden.order_items[0]?.unit_price || 0;
    const total = orden.total_amount;

    // Extraer datos de facturación de la orden misma
    // Los datos pueden estar en payments[0] o en buyer
    // (payment ya está declarado arriba)

    // Mejorar extracción del nombre del cliente
    const nombreCompleto = `${orden.buyer?.first_name || ''} ${orden.buyer?.last_name || ''}`.trim();
    const cliente = nombreCompleto || orden.buyer?.nickname || 'Cliente Desconocido';

    // Extraer dirección de FACTURACIÓN (no de envío)
    // La dirección de facturación está en buyer.billing_info o en payments
    const direccionFacturacion = datosEnvio.receiver_address?.address_line ||
      datosEnvio.receiver_address?.street_name ||
      datosUsuario.address?.address_line ||
      datosUsuario.address?.street_name ||
      orden.buyer?.billing_info?.address_line ||
      orden.buyer?.billing_info?.street_name ||
      payment?.billing_address?.address_line ||
      '---';

    // Para órdenes "Acordás la entrega", usar datos del usuario
    const direccionFinal = direccionFacturacion === '---' && datosUsuario.address ?
      `${datosUsuario.address.city?.name || '---'}, ${datosUsuario.address.state?.name || '---'}` :
      direccionFacturacion;

    // Extraer ciudad de diferentes fuentes
    const ciudad = datosEnvio.receiver_address?.city_name ||
      datosEnvio.receiver_address?.city?.name ||
      datosUsuario.address?.city?.name ||
      orden.buyer?.billing_info?.city ||
      payment?.billing_address?.city ||
      '---';

    // Dirección de envío (para referencia, pero no para facturación)
    const direccionEnvio = datosEnvio.receiver_address?.address_line ||
      datosEnvio.receiver_address?.street_name ||
      orden.shipping?.receiver_address?.address_line ||
      '---';

    // Extraer datos de facturación del usuario
    // Buscar el DNI en todos los campos posibles
    console.log(`🔍 Buscando DNI en todos los campos...`);
    console.log(`📋 Receiver name:`, datosEnvio.receiver_address?.receiver_name);
    console.log(`📋 Payment payer_id:`, payment?.payer_id);
    console.log(`📋 Buyer billing_info:`, orden.buyer?.billing_info);
    console.log(`📋 Datos billing completos:`, JSON.stringify(datosBilling, null, 2));
    console.log(`📋 Receiver address completo:`, JSON.stringify(datosEnvio.receiver_address, null, 2));

    // El DNI puede estar en billing info, payment o en otros campos
    const dni = datosBilling.doc_number ||
      datosBilling.identification?.number ||
      datosPayment.payer?.identification?.number ||
      datosPayment.payer?.doc_number ||
      datosEnvio.receiver_address?.receiver_name?.match(/\d+/)?.[0] ||
      payment?.payer_id?.toString() ||
      orden.buyer?.billing_info?.doc_number ||
      '';
    const cuit = dni; // En ML, DNI y CUIT suelen ser lo mismo
    // Campo booleano para indicar si necesita selección de tipo de consumidor
    const necesitaSeleccionTipoConsumidor = true;

    // Información adicional para debug
    const infoAdicional = {
      buyerId: orden.buyer?.id,
      nickname: orden.buyer?.nickname,
      billingInfoId: orden.buyer?.billing_info?.id,
      shippingId: orden.shipping?.id,
      paymentId: payment?.id,
      payerId: payment?.payer_id,
      tieneBillingInfo: !!orden.buyer?.billing_info,
      tieneDireccionFacturacion: !!direccionFacturacion && direccionFacturacion !== '---',
      tieneDireccionEnvio: !!direccionEnvio && direccionEnvio !== '---',
      tienePayment: !!payment,
      tieneDatosUsuario: !!datosUsuario.identification,
      tieneDatosBilling: !!datosBilling.doc_number,
      tieneDatosPayment: !!datosPayment.payer,
      datosUsuarioCompleto: datosUsuario,
      datosBillingCompleto: datosBilling,
      datosPaymentCompleto: datosPayment
    };

    return res.json({
      producto,
      cantidad,
      precio,
      total,
      cliente,
      direccion: direccionFinal, // Usar dirección final (incluye "Acordás la entrega")
      direccionEnvio, // Para referencia
      ciudad, // Ciudad extraída de diferentes fuentes
      dni,
      cuit,
      necesitaSeleccionTipoConsumidor,
      infoAdicional // Para debug
    });

  } catch (err) {
    console.error('❌ Error buscando venta individual:', err.message);

    // Si no se encuentra como orden individual, intentar como pack
    if (err.response?.status === 404) {
      console.log(`🔄 Intentando buscar como pack: ${numeroVenta}`);
      try {
        const packResponse = await axios.get(`https://api.mercadolibre.com/marketplace/orders/pack/${numeroVenta}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        const packData = packResponse.data;
        console.log(`✅ Pack encontrado con ${packData.orders?.length || 0} órdenes`);

        // Si el pack tiene órdenes, tomar la primera
        if (packData.orders && packData.orders.length > 0) {
          const primeraOrden = packData.orders[0];
          console.log(`📦 Usando primera orden del pack: ${primeraOrden.id}`);

          // Procesar la primera orden del pack como si fuera una orden individual
          // (Aquí podrías repetir la lógica de procesamiento, pero por simplicidad devolvemos info del pack)
          return res.json({
            producto: primeraOrden.order_items?.[0]?.item?.title || 'Producto del pack',
            cantidad: primeraOrden.order_items?.[0]?.quantity || 1,
            precio: primeraOrden.order_items?.[0]?.unit_price || 0,
            total: primeraOrden.total_amount || 0,
            cliente: `${primeraOrden.buyer?.first_name || ''} ${primeraOrden.buyer?.last_name || ''}`.trim() || primeraOrden.buyer?.nickname || 'Cliente del pack',
            direccion: '---', // Los packs pueden tener múltiples direcciones
            ciudad: '---',
            dni: primeraOrden.buyer?.id?.toString() || '---',
            cuit: primeraOrden.buyer?.id?.toString() || '---',
            necesitaSeleccionTipoConsumidor: true,
            infoAdicional: {
              esPack: true,
              packId: numeroVenta,
              totalOrdenes: packData.orders?.length || 0,
              ordenes: packData.orders?.map(o => o.id) || []
            }
          });
        }
      } catch (packError) {
        console.error('❌ Error buscando pack:', packError.message);
        console.error('📊 Status del error pack:', packError.response?.status);
        console.error('📊 Response pack:', packError.response?.data);
      }
    }

    // Determinar el tipo de error específico
    let errorMessage = 'No se encontró la venta en Mercado Libre';
    let posibleCausa = 'Orden no existe, no es tuya, o ML no la expone';
    let sugerencia = 'Verifica en tu panel de ML que la orden existe y es tuya';

    if (err.response?.status === 403 && err.response?.data?.message === 'Invalid caller.id') {
      errorMessage = 'Esta venta no pertenece a tu cuenta de Mercado Libre';
      posibleCausa = 'El pack/orden pertenece a otro vendedor';
      sugerencia = 'Verifica que estés usando el ID correcto de una venta tuya';
    } else if (err.response?.status === 404) {
      errorMessage = 'La venta no existe en Mercado Libre';
      posibleCausa = 'ID incorrecto o venta eliminada';
      sugerencia = 'Verifica el número de venta en tu panel de ML';
    }

    return res.status(404).json({
      error: errorMessage,
      orden_id: numeroVenta,
      detalles: err.message,
      posible_causa: posibleCausa,
      sugerencia: sugerencia
    });
  }
});

// Endpoint público para debug - NO requiere autenticación
router.get('/debug/orden/:id', async (req, res) => {
  const numeroVenta = req.params.id;
  console.log(`🔍 [DEBUG] Consultando orden completa: ${numeroVenta}`);

  try {
    let tokenDoc = await MeliToken.findOne();
    if (!tokenDoc || !tokenDoc.access_token) {
      return res.status(401).json({ error: 'No autenticado con Mercado Libre.' });
    }

    // Verificar si el token ha expirado o está cerca de expirar
    const now = Date.now();
    const tokenCreatedAt = new Date(tokenDoc.created_at).getTime();
    const expiresInMs = tokenDoc.expires_in * 1000;
    const bufferTimeMs = 5 * 60 * 1000;

    if (now > tokenCreatedAt + expiresInMs - bufferTimeMs) {
      console.log('🔄 [DEBUG] Token expirado, refrescando...');
      try {
        tokenDoc.access_token = await refreshMeliToken(tokenDoc);
      } catch (refreshError) {
        console.error('❌ [DEBUG] Fallo al refrescar token:', refreshError.message);
        return res.status(401).json({ error: 'Token expirado y no se pudo refrescar.' });
      }
    }

    const accessToken = tokenDoc.access_token;
    console.log(`🌐 [DEBUG] Consultando orden ${numeroVenta} en ML...`);

    // Buscar la orden completa en ML
    const ordenResponse = await axios.get(`https://api.mercadolibre.com/orders/${numeroVenta}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const orden = ordenResponse.data;
    console.log(`✅ [DEBUG] Orden obtenida exitosamente`);

    // Devolver el JSON completo
    return res.json(orden);

  } catch (err) {
    console.error('❌ [DEBUG] Error consultando orden:', err.message);
    return res.status(404).json({ error: 'No se encontró la orden' });
  }
});

// Ruta pública para debug de billing info (sin autenticación)
router.get('/debug/billing/:user_id', async (req, res) => {
  const userId = req.params.user_id;
  console.log(`🔍 [DEBUG] Consultando billing info para usuario: ${userId}`);

  try {
    let tokenDoc = await MeliToken.findOne();
    if (!tokenDoc || !tokenDoc.access_token) {
      return res.status(401).json({ error: 'No autenticado con Mercado Libre.' });
    }

    // Verificar si el token ha expirado o está cerca de expirar
    const now = Date.now();
    const tokenCreatedAt = new Date(tokenDoc.created_at).getTime();
    const expiresInMs = tokenDoc.expires_in * 1000;
    const bufferTimeMs = 5 * 60 * 1000; // 5 minutos antes de la expiración real

    if (now > tokenCreatedAt + expiresInMs - bufferTimeMs) {
      console.log('🔄 [DEBUG] Token de ML está expirado. Intentando refrescar...');
      try {
        tokenDoc.access_token = await refreshMeliToken(tokenDoc);
        console.log('✅ [DEBUG] Token refrescado exitosamente');
      } catch (refreshError) {
        console.error('❌ [DEBUG] Fallo al refrescar el token:', refreshError.message);
        return res.status(401).json({ error: 'Token de Mercado Libre expirado y no se pudo refrescar.' });
      }
    }

    const accessToken = tokenDoc.access_token;

    // Consultar billing info del usuario
    const billingResponse = await axios.get(`https://api.mercadolibre.com/users/${userId}/billing_info`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const billingInfo = billingResponse.data;

    // Devolver la información de billing completa para debug
    return res.json({
      billing_info_completo: billingInfo,
      info_debug: {
        user_id: userId,
        doc_number: billingInfo.doc_number,
        company_name: billingInfo.company_name,
        consumer_type: billingInfo.consumer_type,
        address: billingInfo.address
      }
    });

  } catch (err) {
    console.error('❌ [DEBUG] Error consultando billing info:', err.message);
    return res.status(404).json({
      error: 'No se pudo obtener billing info',
      details: err.message,
      status_code: err.response?.status,
      url_tentada: `https://api.mercadolibre.com/users/${userId}/billing_info`
    });
  }
});

module.exports = router;