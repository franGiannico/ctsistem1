// backend/routes/comparaya.js
// Comparación de precios contra otras tiendas usando las fichas públicas de ComparaYa.
//
// Cómo funciona:
//  - Cada producto (SKU) se asocia UNA vez con el link de su ficha en ComparaYa
//    (https://comparaya.net/p/<slug>). El vínculo queda guardado en MongoDB.
//  - Para comparar se lee esa ficha pública (la misma que abre cualquier persona,
//    permitida por el robots.txt de ComparaYa) y se extraen las ofertas por tienda.
//  - NO se usa el buscador de ComparaYa ni su /api/ (su robots.txt los excluye).
//
// Cuidado con el sitio: una consulta por vez, separadas por al menos 1,2 segundos,
// con User-Agent identificable y caché de 12 horas por ficha.

const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');

const router = express.Router();

const USER_AGENT = 'ConiferalPriceCheck/1.0 (+contacto: fjgiannico@gmail.com)';
const CACHE_MS = 12 * 60 * 60 * 1000;
const PAUSA_ENTRE_CONSULTAS_MS = 1200;
const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ---------------------------------------------------------------------------
// Modelo: vínculo SKU -> ficha de ComparaYa
// ---------------------------------------------------------------------------
const ComparaYaLinkSchema = new mongoose.Schema({
  sku: { type: String, required: true, unique: true, trim: true },
  slug: { type: String, required: true, trim: true },
  actualizadoEn: { type: Date, default: Date.now },
});

const ComparaYaLink =
  mongoose.models.ComparaYaLink ||
  mongoose.model('ComparaYaLink', ComparaYaLinkSchema);

// Acepta el link completo de la ficha o directamente el slug.
const extraerSlug = (entrada) => {
  const texto = String(entrada || '').trim();
  if (!texto) return null;

  if (/^https?:\/\//i.test(texto)) {
    try {
      const url = new URL(texto);
      const host = url.hostname.toLowerCase();
      if (host !== 'comparaya.net' && host !== 'www.comparaya.net') return null;
      const partes = url.pathname.split('/').filter(Boolean);
      if (partes[0] !== 'p' || !partes[1]) return null;
      const slug = decodeURIComponent(partes[1]).toLowerCase();
      return SLUG_REGEX.test(slug) && slug.length <= 150 ? slug : null;
    } catch (e) {
      return null;
    }
  }

  const slug = texto.toLowerCase();
  return SLUG_REGEX.test(slug) && slug.length <= 150 ? slug : null;
};

// ---------------------------------------------------------------------------
// Consulta a ComparaYa (una por vez, con pausa y caché)
// ---------------------------------------------------------------------------
const cacheFichas = new Map(); // slug -> { creadoEn, datos }
let colaConsultas = Promise.resolve();
let ultimaConsulta = 0;

const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const esperarTurno = () => {
  const turno = colaConsultas.then(async () => {
    const espera = Math.max(0, ultimaConsulta + PAUSA_ENTRE_CONSULTAS_MS - Date.now());
    if (espera > 0) await dormir(espera);
    ultimaConsulta = Date.now();
  });
  colaConsultas = turno.catch(() => {});
  return turno;
};

const aTextoPlano = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' | ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/(\s*\|\s*)+/g, ' | ')
    .replace(/\s+/g, ' ');

const parsearPrecio = (texto) => {
  const limpio = String(texto || '').replace(/\./g, '').replace(',', '.');
  const numero = Number(limpio);
  return Number.isFinite(numero) && numero > 0 ? numero : null;
};

const ETIQUETAS_IGNORADAS = new Set([
  'más barato',
  'mas barato',
  'más caro',
  'mas caro',
  'mejor precio',
]);

// Lee las ofertas del bloque "Precios por tienda" de la ficha.
const parsearFicha = (html) => {
  const tituloMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  const titulo = tituloMatch
    ? tituloMatch[1].replace(/:\s*precios en.*$/i, '').replace(/\s*\|\s*ComparaYa.*$/i, '').trim()
    : '';

  const tokens = aTextoPlano(html)
    .split(' | ')
    .map((t) => t.trim())
    .filter(Boolean);

  const inicio = tokens.findIndex((t) => /^precios por tienda$/i.test(t));
  if (inicio === -1) return { titulo, ofertas: [] };

  let fin = tokens.findIndex((t, i) => i > inicio && /^historial de precios$/i.test(t));
  if (fin === -1) fin = tokens.length;

  const bloque = tokens.slice(inicio + 1, fin);
  const ofertas = [];
  let grupo = [];

  for (const token of bloque) {
    if (/^ir a la tienda$/i.test(token)) {
      const oferta = interpretarGrupo(grupo);
      if (oferta) ofertas.push(oferta);
      grupo = [];
    } else {
      grupo.push(token);
    }
  }

  return { titulo, ofertas };
};

// grupo = [tienda, (etiqueta), título, (envío gratis), (N cuotas [sin interés]), "$", precio, ...]
const interpretarGrupo = (grupo) => {
  if (grupo.length < 4) return null;

  const tienda = grupo[0];
  const resto = grupo.slice(1).filter((t) => !ETIQUETAS_IGNORADAS.has(t.toLowerCase()));

  const idxPrecio = resto.findIndex(
    (t, i) => t === '$' && /^[\d.]+(?:,\d+)?$/.test(resto[i + 1] || '')
  );
  if (idxPrecio === -1) return null;
  const precio = parsearPrecio(resto[idxPrecio + 1]);
  if (!precio) return null;

  const antesDelPrecio = resto.slice(0, idxPrecio);

  let cuotas = null;
  let sinInteres = false;
  let envioGratis = false;
  let titulo = '';

  for (const token of antesDelPrecio) {
    const mCuotas = token.match(/^(\d+)\s+cuotas?(\s+sin\s+inter[eé]s)?$/i);
    if (mCuotas) {
      cuotas = Number(mCuotas[1]);
      sinInteres = Boolean(mCuotas[2]);
    } else if (/^env[ií]o gratis$/i.test(token)) {
      envioGratis = true;
    } else if (!titulo) {
      titulo = token;
    }
  }

  return { tienda, titulo, precio, cuotas, sinInteres, envioGratis };
};

const obtenerFicha = async (slug) => {
  const enCache = cacheFichas.get(slug);
  if (enCache && Date.now() - enCache.creadoEn < CACHE_MS) {
    return { ...enCache.datos, desdeCache: true };
  }

  await esperarTurno();

  const respuesta = await axios.get(`https://comparaya.net/p/${slug}`, {
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'es-AR,es;q=0.9' },
    timeout: 20000,
    responseType: 'text',
    transformResponse: [(d) => d],
  });

  const datos = parsearFicha(String(respuesta.data || ''));
  if (datos.ofertas.length === 0) {
    throw new Error(
      'No se pudieron leer las ofertas de la ficha (puede haber cambiado el formato de la página).'
    );
  }

  cacheFichas.set(slug, { creadoEn: Date.now(), datos });
  return { ...datos, desdeCache: false };
};

// ¿El título de la oferta menciona exactamente este código? (AP175 no debe coincidir con AP175B)
const tituloMencionaCodigo = (titulo, codigo) => {
  const cod = String(codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cod) return false;
  const tit = String(titulo || '').toUpperCase();
  const escapado = cod.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Z0-9])${escapado}([^A-Z0-9]|$)`).test(tit);
};

const menorPrecio = (ofertas) =>
  ofertas.length === 0
    ? null
    : ofertas.reduce((min, o) => (o.precio < min.precio ? o : min), ofertas[0]);

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------

// Devuelve los vínculos guardados para una lista de SKUs: { links: { sku: slug } }
router.post('/links/consultar', async (req, res) => {
  try {
    const skus = Array.isArray(req.body?.skus)
      ? req.body.skus.map((s) => String(s || '').trim()).filter(Boolean)
      : [];
    if (skus.length === 0) return res.json({ links: {} });

    const encontrados = await ComparaYaLink.find({ sku: { $in: skus } }).lean();
    const links = {};
    encontrados.forEach((l) => {
      links[l.sku] = l.slug;
    });
    res.json({ links });
  } catch (error) {
    console.error('Error consultando vínculos ComparaYa:', error);
    res.status(500).json({ error: 'No se pudieron consultar los vínculos.' });
  }
});

// Guarda (o actualiza) vínculos SKU -> link de ComparaYa.
// Body: { links: [{ sku, link }] }
router.post('/links', async (req, res) => {
  try {
    const entradas = Array.isArray(req.body?.links) ? req.body.links : [];
    if (entradas.length === 0) {
      return res.status(400).json({ error: 'Se requiere un array "links".' });
    }

    const guardados = {};
    const invalidos = [];

    for (const entrada of entradas) {
      const sku = String(entrada?.sku || '').trim();
      const slug = extraerSlug(entrada?.link);
      if (!sku || !slug) {
        invalidos.push(sku || '(sin SKU)');
        continue;
      }
      await ComparaYaLink.findOneAndUpdate(
        { sku },
        { sku, slug, actualizadoEn: new Date() },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      guardados[sku] = slug;
    }

    res.json({ guardados, invalidos });
  } catch (error) {
    console.error('Error guardando vínculos ComparaYa:', error);
    res.status(500).json({ error: 'No se pudieron guardar los vínculos.' });
  }
});

router.delete('/links/:sku', async (req, res) => {
  try {
    await ComparaYaLink.deleteOne({ sku: String(req.params.sku || '').trim() });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'No se pudo borrar el vínculo.' });
  }
});

// Compara un producto contra las ofertas de su ficha.
// Body: { sku, cuotasPropias }  (cuotasPropias = cuotas sin interés que ofrecemos)
router.post('/comparar', async (req, res) => {
  const sku = String(req.body?.sku || '').trim();
  const cuotasPropias = Number(req.body?.cuotasPropias) || 0;
  if (!sku) return res.status(400).json({ error: 'Falta "sku".' });

  try {
    const vinculo = await ComparaYaLink.findOne({ sku }).lean();
    if (!vinculo) {
      return res.json({ sku, tieneLink: false });
    }

    const ficha = await obtenerFicha(vinculo.slug);

    // Dejamos afuera nuestras propias publicaciones.
    const ajenas = ficha.ofertas.filter((o) => !/coniferal/i.test(o.tienda));

    // Si alguna oferta nombra exactamente el código, nos quedamos solo con esas
    // (evita mezclar variantes, ej. AP175B Blanca). Si ninguna lo nombra, usamos
    // todas pero lo avisamos (verificado: false).
    const coinciden = ajenas.filter((o) => tituloMencionaCodigo(o.titulo, sku));
    const verificado = coinciden.length > 0;
    const consideradas = verificado ? coinciden : ajenas;

    // Comparable = ofertas con cuotas sin interés iguales o mejores que las nuestras.
    // Si nosotros no ofrecemos cuotas sin interés, comparamos contra todas las ofertas.
    const comparables =
      cuotasPropias > 0
        ? consideradas.filter((o) => o.sinInteres && o.cuotas >= cuotasPropias)
        : consideradas;

    res.json({
      sku,
      tieneLink: true,
      slug: vinculo.slug,
      titulo: ficha.titulo,
      desdeCache: ficha.desdeCache,
      verificado,
      ofertasLeidas: ficha.ofertas.length,
      mejorComparable: menorPrecio(comparables),
      mejorGeneral: menorPrecio(consideradas),
      ofertas: consideradas,
    });
  } catch (error) {
    const status = error.response?.status;
    console.error(`Error comparando ${sku} en ComparaYa:`, error.message);
    res.status(200).json({
      sku,
      tieneLink: true,
      error:
        status === 404
          ? 'La ficha de ComparaYa ya no existe (revisá el link).'
          : error.message || 'No se pudo consultar ComparaYa.',
    });
  }
});

// Exportadas para pruebas locales.
router._test = { extraerSlug, parsearFicha, tituloMencionaCodigo };

module.exports = router;
