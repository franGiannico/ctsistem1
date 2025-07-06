// Archivo: backend/routes/meli.js

const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const router = express.Router();

require('dotenv').config();

// --- Modelos de Mongoose ---

// Esquema y Modelo para el Token de Mercado Libre
const MeliTokenSchema = new mongoose.Schema({
    user_id: String,
    access_token: String,
    refresh_token: String,
    expires_in: Number,
    scope: String,
    created_at: { type: Date, default: Date.now },
});
const MeliToken = mongoose.models.MeliToken || mongoose.model('MeliToken', MeliTokenSchema);

// Esquema y Modelo para las Ventas
const VentaSchema = new mongoose.Schema({
    sku: String,
    nombre: String,
    cantidad: Number,
    numeroVenta: { type: String, unique: true }, // Asegura que las ventas ML sean únicas
    cliente: String,
    puntoDespacho: String,
    completada: { type: Boolean, default: false }, // Por defecto, no completada
    entregada: { type: Boolean, default: false }, // Por defecto, no entregada
    imagen: String
});
const Venta = mongoose.models.Venta || mongoose.model('Venta', VentaSchema);

// --- Variables de Entorno ---
const {
    MELI_CLIENT_ID,
    MELI_CLIENT_SECRET,
    MELI_REDIRECT_URI
} = process.env;

// --- Función Auxiliar: Refrescar Token de Mercado Libre ---
// Esta función se encarga de renovar el token de acceso de Mercado Libre
// cuando está a punto de expirar o ya ha expirado.
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

        // Actualiza el documento del token con los nuevos valores
        tokenDoc.access_token = access_token;
        tokenDoc.refresh_token = refresh_token; // El refresh token también puede cambiar
        tokenDoc.expires_in = expires_in;
        tokenDoc.created_at = new Date(); // Actualiza la fecha de creación para reflejar la nueva expiración
        tokenDoc.user_id = user_id; // Asegura que el user_id sea consistente
        await tokenDoc.save(); // Guarda el documento del token actualizado en la base de datos

        console.log('✅ Token de Mercado Libre refrescado y guardado correctamente.');
        return access_token; // Devuelve el nuevo access token
    } catch (error) {
        console.error('❌ Error al refrescar token de Mercado Libre:', error.response?.data || error.message);
        throw new Error('No se pudo refrescar el token de Mercado Libre.');
    }
}

// ### Rutas de la API de Mercado Libre

// Esta ruta inicia el proceso de autenticación con Mercado Libre o verifica si ya se está autenticado.
router.get('/auth', async (req, res) => {
    try {
        const token = await MeliToken.findOne();
        if (token && token.access_token) {
            // Verifica si el token existente está cerca de expirar
            const now = Date.now();
            const tokenCreatedAt = new Date(token.created_at).getTime();
            const expiresInMs = token.expires_in * 1000;
            const bufferTimeMs = 5 * 60 * 1000; // 5 minutos antes de la expiración real

            if (now < tokenCreatedAt + expiresInMs - bufferTimeMs) {
                // Si el token es válido y no está cerca de expirar, se considera autenticado
                return res.json({ autenticado: true });
            } else {
                console.log('Token de ML existe pero está cerca de expirar, se solicita re-autenticación.');
                return res.json({ autenticado: false, error: 'Token expirado, necesita re-autenticar.' });
            }
        }

        // Si no hay token o está expirado/cerca de expirar, se genera la URL de autenticación
        const authUrl = `https://auth.mercadolibre.com.ar/authorization?response_type=code&client_id=${MELI_CLIENT_ID}&redirect_uri=${MELI_REDIRECT_URI}`;
        res.json({ redirect: authUrl });
    } catch (err) {
        console.error('Error en /meli/auth', err);
        res.status(500).json({ error: 'Error al generar URL de autenticación' });
    }
});

// GET /meli/callback`
// Esta es la ruta de callback a la que Mercado Libre redirige después de que el usuario se autentica.
router.get('/callback', async (req, res) => {
    const code = req.query.code;
    console.log('🔔 [CALLBACK] Ruta /meli/callback invocada.');
    console.log('🔔 [CALLBACK] Código de autorización recibido:', code ? code.substring(0, 10) + '...' : 'N/A');

    if (!code) {
        console.error('❌ [CALLBACK] Código de autorización no encontrado.');
        return res.status(400).send('Código de autorización no encontrado.');
    }

    try {
        console.log('🔔 [CALLBACK] Solicitando token de acceso a la API de Mercado Libre...');
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
        console.log('✅ [CALLBACK] Token obtenido de Mercado Libre. User ID:', user_id);

        // Almacena o actualiza el token en la base de datos.
        // Para una aplicación de un solo usuario, borramos los anteriores y creamos uno nuevo.
        try {
            console.log('🔔 [CALLBACK] Guardando/actualizando token en la base de datos...');
            await MeliToken.deleteMany({}); // Elimina tokens anteriores para asegurar solo un documento de token válido
            const newToken = await MeliToken.create({ user_id, access_token, refresh_token, expires_in, scope });
            console.log('🎉 [CALLBACK] Token guardado en la DB. Documento ID:', newToken._id);

            // Redirige al frontend después de una autenticación exitosa
            res.redirect('https://ctsistem1.netlify.app/ventas');
        } catch (dbError) {
            console.error('❌ [CALLBACK] Error al guardar/actualizar el token en la base de datos:', dbError);
            res.status(500).send('Error al guardar el token en la base de datos.');
        }

    } catch (error) {
        console.error('❌ [CALLBACK] Error completo en /meli/callback:', error);
        console.error('❌ [CALLBACK] Error de respuesta de ML:', error.response?.data || error.message);
        // Si hay un error, redirige al frontend con un parámetro de error para que lo maneje
        res.redirect('https://ctsistem1.netlify.app/ventas?error=meli_auth_failed');
    }
});

// GET /meli/sincronizar-ventas`
// Esta ruta se encarga de obtener las ventas de Mercado Libre y sincronizarlas con la base de datos de la aplicación.
router.get('/sincronizar-ventas', async (req, res) => {
    try {
        let tokenDoc = await MeliToken.findOne(); // Busca el token existente
        if (!tokenDoc || !tokenDoc.access_token) {
            return res.status(401).json({ error: 'No autenticado con Mercado Libre. Por favor, conecta tu cuenta.' });
        }

        // Verifica si el token ha expirado o está cerca de expirar y lo refresca si es necesario
        const now = Date.now();
        const tokenCreatedAt = new Date(tokenDoc.created_at).getTime();
        const expiresInMs = tokenDoc.expires_in * 1000;
        const bufferTimeMs = 5 * 60 * 1000; // Un buffer de 5 minutos antes de la expiración real

        if (now > tokenCreatedAt + expiresInMs - bufferTimeMs) {
            console.log('El token de ML está expirado o a punto de expirar. Intentando refrescar...');
            try {
                tokenDoc.access_token = await refreshMeliToken(tokenDoc); // Llama a la función auxiliar de refresco
            } catch (refreshError) {
                console.error('Fallo al refrescar el token:', refreshError.message);
                return res.status(401).json({ error: 'Token de Mercado Libre expirado y no se pudo refrescar. Por favor, vuelve a autenticarte.' });
            }
        }

        const { access_token, user_id } = tokenDoc;

        // Obtener las órdenes pagadas del vendedor desde la API de Mercado Libre
        const ordersRes = await axios.get(
            `https://api.mercadolibre.com/orders/search?seller=${user_id}&order.status=paid`,
            { headers: { Authorization: `Bearer ${access_token}` } }
        );

        const ordenes = ordersRes.data.results;
        const ventasAGuardar = [];

        for (const orden of ordenes) {
            const idVenta = orden.id.toString();

            const shippingStatus = orden.shipping?.status;
            const logisticType = orden.shipping?.logistic_type;

            // --- FILTRO 1: Excluir ventas de tipo 'fulfillment' (gestionadas por ML Full) ---
            if (logisticType === 'fulfillment') {
                console.log(`Orden ML ${idVenta} es de tipo 'fulfillment', omitiendo.`);
                continue; // Saltar esta orden y pasar a la siguiente del bucle
            }

            // --- FILTRO 2: Incluir solo los estados de envío considerados "pendientes" ---
            // Estos son los estados que indican que el producto aún no ha sido entregado al comprador.
            const estadosPendientes = ['ready_to_ship', 'pending', 'handling', 'shipped', 'out_for_delivery'];
            if (!estadosPendientes.includes(shippingStatus)) {
                console.log(`Orden ML ${idVenta} con estado '${shippingStatus}' no es pendiente, omitiendo.`);
                continue; // Saltar esta orden si su estado no es uno de los "pendientes"
            }

            // Evitar duplicados: verifica si la venta ya existe en la base de datos local
            const existe = await Venta.findOne({ numeroVenta: idVenta });
            if (existe) {
                console.log(`Venta ML ${idVenta} ya existe en la base de datos local, omitiendo.`);
                continue; // Si ya existe, no la vuelve a guardar
            }

            // Extraer detalles del producto y la venta
            const item = orden.order_items[0]; // Asumimos que solo hay un item por orden para simplificar
            const title = item.item.title || '';
            const sku = item.item.seller_sku || '';
            const quantity = item.quantity || 1;
            const variation = item.item.variation_attributes?.map(attr => `${attr.name}: ${attr.value_name}`).join(' - ') || '';
            const nombreFinal = variation ? `${title} (${variation})` : title;
            const imagen = item.item.picture || '';

            const cliente = orden.buyer?.nickname || 'Cliente';
            const numeroVenta = idVenta;

            // --- Determinación del "Punto de Despacho" según tus categorías ---
            // Mapea los tipos de envío de Mercado Libre a tus categorías personalizadas.
            const shippingType = orden.shipping?.shipping_type;
            let puntoDespacho = 'Punto de Despacho'; // Valor por defecto si no hay un mapeo específico

            if (shippingType === 'me2') { // Si el tipo de envío es Mercado Envíos (ME2)
                if (logisticType === 'self_service') {
                    puntoDespacho = 'Flex'; // Mercado Envíos Flex
                } else if (logisticType === 'drop_off' || logisticType === 'xd_drop_off' || logisticType === 'pickup') {
                    puntoDespacho = 'Punto de Despacho'; // Para despachar en correos, agencias o puntos de retiro de ML
                } else if (logisticType === 'cross_docking') {
                    puntoDespacho = 'Retira el Expreso'; // Cuando ML (o su transportista) recolecta en el domicilio del vendedor
                }
            } else if (shippingType === 'not_specified' || shippingType === 'custom') {
                // Para envíos donde el vendedor acuerda la logística con el comprador o es personalizada.
                // Aquí se incluirían tus categorías "Llevar al Expreso", "Showroom", "Domicilio", "Guardia".
                // Como la API no provee más detalles para diferenciarlos, se usa un valor predeterminado.
                puntoDespacho = 'Llevar al Expreso';
            } else {
                // Cualquier otro tipo de envío no mapeado explícitamente se asigna a "Punto de Despacho"
                puntoDespacho = 'Punto de Despacho';
            }

            // Agrega la nueva venta a la lista para guardar
            ventasAGuardar.push(new Venta({
                sku,
                nombre: nombreFinal,
                cantidad: quantity,
                numeroVenta,
                cliente,
                puntoDespacho,
                completada: false, // Las ventas sincronizadas son por definición "pendientes"
                entregada: false, // Las ventas sincronizadas son por definición "pendientes"
                imagen
            }));
        }

        // Si no hay nuevas ventas después de los filtros, se informa
        if (ventasAGuardar.length === 0) {
            return res.json({ mensaje: 'No hay nuevas ventas pendientes para sincronizar.' });
        }

        // Inserta las nuevas ventas en la base de datos
        await Venta.insertMany(ventasAGuardar);
        res.json({ mensaje: `${ventasAGuardar.length} ventas pendientes sincronizadas con éxito.` });

    } catch (error) {
        // Manejo de errores para la ruta de sincronización
        console.error('❌ Error al sincronizar ventas:', error.response?.data || error.message);
        if (error.response && error.response.status === 403) {
            // Error 403: Puede ser por token inválido o permisos insuficientes
            return res.status(403).json({ error: 'Permisos insuficientes o ID de usuario no coincide con el token. Por favor, re-autentica o verifica la configuración de tu aplicación en Mercado Libre.' });
        }
        res.status(500).json({ error: 'Error interno al sincronizar ventas desde Mercado Libre' });
    }
});

// Exporta el router para que pueda ser utilizado por tu aplicación Express principal
module.exports = router;