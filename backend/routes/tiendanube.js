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

// Modelo Venta (Referencia)
const Venta = mongoose.models.Venta; // Asumiendo que ya está compilado en otros archivos o usar require si es necesario.
// Mejor definimos el esquema si no está globalmente accesible, o importamos.
// Por consistencia con meli.js, reusamos la definición si Venta ya está cargado en mongoose.
// Ojo: Si meli.js es quien lo define, puede que aquí no esté disponible si no se ha ejecutado.
// Definiremos VentaSchema aquí también para asegurar.
const VentaSchema = new mongoose.Schema({
    sku: String,
    nombre: String,
    cantidad: Number,
    numeroVenta: { type: String, unique: true },
    packId: String,
    cliente: String,
    puntoDespacho: String,
    completada: Boolean,
    entregada: Boolean,
    imagen: String,
    esML: { type: Boolean, default: false },
    esTiendanube: { type: Boolean, default: false }, // Nuevo flag
    variationId: String,
    atributos: [Object],
    tipoEnvio: String,
    nota: String,
});
// Usar modelo existente o crear nuevo
const VentaModel = mongoose.models.Venta || mongoose.model('Venta', VentaSchema);


// 🔐 Auth: Redirigir a Tiendanube
router.get('/auth', (req, res) => {
    const authUrl = `https://www.tiendanube.com/apps/${TIENDANUBE_CLIENT_ID}/authorize?response_type=code&scope=read_orders,write_orders&redirect_uri=${REDIRECT_URI}`;
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
            // Filtrar solo pagadas si es necesario (status 'open' suele incluir pendientes de pago en TN?)
            // status: 'open' significa "Lista para procesar" (normalmente pago confirmado).
            // payment_status: 'paid'
            if (order.payment_status !== 'paid') continue;

            const numeroVenta = `TN-${order.id}`;
            const cliente = order.customer ? `${order.customer.name}` : order.billing_name || 'Desconocido';

            // Mapear Punto de Despacho
            const shippingName = order.row_shipping_method || ""; // old field
            // Or shipping_option field
            const shippingOption = order.shipping_option || "";

            let puntoDespacho = "Punto de Despacho";
            if (shippingOption.toLowerCase().includes("flex")) puntoDespacho = "Flex";
            if (shippingOption.toLowerCase().includes("retiro") || shippingOption.toLowerCase().includes("sucursal")) puntoDespacho = "Punto de Despacho";
            if (shippingOption.toLowerCase().includes("coordinar")) puntoDespacho = "A coordinar";
            if (!shippingOption) puntoDespacho = "A coordinar";

            // Productos
            for (const product of order.products) {
                const sku = product.sku || product.variant_sku || "Sin SKU";
                const nombre = `${product.name} ${product.variant_name ? '- ' + product.variant_name : ''}`;
                const cantidad = parseInt(product.quantity);
                const precio = product.price;
                const imagen = product.image ? product.image.src : null;

                const estadoPrevio = estadosExistentes[numeroVenta] || { completada: false, entregada: false };

                ventasAGuardar.push({
                    numeroVenta: `${numeroVenta}-${product.id}`, // Unique ID per row
                    // Pese a que VentaSchema.numeroVenta es unique, aquí podríamos tener colisión si una orden tiene varios productos.
                    // Ajuste: El esquema actual usa numeroVenta como ID único de la fila en la tabla.
                    // Opción: Usar TN-{orderID}-{productID} para ser únicos por línea.

                    sku,
                    nombre,
                    cantidad,
                    cliente,
                    puntoDespacho,
                    imagen,
                    esTiendanube: true,
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

module.exports = router;
