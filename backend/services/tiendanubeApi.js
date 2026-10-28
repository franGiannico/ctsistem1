// Helpers para hablar con la API de Tiendanube (usados por el worker de sincronización
// y por la herramienta de migración de precios promocionales).

const axios = require("axios");

const BASE = "https://api.tiendanube.com/v1";

const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const cabeceras = ({ accessToken, userAgent }) => ({
  Authentication: `bearer ${accessToken}`,
  "User-Agent": userAgent,
  "Content-Type": "application/json",
});

// Tiendanube limita los pedidos (cubo que se vacía ~2 por segundo). En cada respuesta avisa
// cuánto lugar queda en el cubo (cabecera x-rate-limit-remaining): si queda poco, se frena
// un momento ANTES de recibir el error 429.
const POCO_CUPO = 8;
const PAUSA_POCO_CUPO_MS = 1500;

const frenarSiQuedaPocoCupo = async (respuesta) => {
  const restante = Number(respuesta?.headers?.["x-rate-limit-remaining"]);
  if (Number.isFinite(restante) && restante <= POCO_CUPO) {
    await dormir(PAUSA_POCO_CUPO_MS);
  }
};

// Hace una request y, si Tiendanube responde 429 (demasiadas solicitudes), espera y reintenta.
const conReintentos = async (fn, { maxReintentos = 8 } = {}) => {
  for (let intento = 0; ; intento++) {
    try {
      const respuesta = await fn();
      await frenarSiQuedaPocoCupo(respuesta);
      return respuesta;
    } catch (error) {
      const status = error.response?.status;

      if (status === 429 && intento < maxReintentos) {
        const reset = Number(error.response?.headers?.["x-rate-limit-reset"]);
        const espera = Number.isFinite(reset) && reset > 0 ? reset : 1000 * (intento + 1);
        await dormir(Math.min(Math.max(espera, 1000), 10000));
        continue;
      }

      throw error;
    }
  }
};

const textoError = (error) => {
  const data = error.response?.data;
  if (data) {
    if (typeof data === "string") return data;
    const detalle = data.description || data.message || data.error;
    if (detalle) {
      return typeof detalle === "string" ? detalle : JSON.stringify(detalle);
    }
    return JSON.stringify(data);
  }
  return error.message || "Error desconocido";
};

// ¿El promocional que devuelve TN equivale a "sin precio promocional"?
const promoVacia = (valor) => {
  if (valor === null || valor === undefined) return true;
  const n = Number(valor);
  return !Number.isFinite(n) || n <= 0;
};

const mismoPrecio = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;

// Actualiza precio de lista y precio promocional de variantes de UN producto
// (PATCH /products/{id}/variants). En ese mismo pedido va todo junto, así nunca queda el
// promocional por encima del precio de lista a mitad de camino.
//
// variantes: [{ id, price, promo }]   promo = número, o null para dejarlo en blanco.
//
// Tiendanube no documenta cómo borrar el promocional: se manda null y se verifica con la
// respuesta; si el promocional sigue puesto, se reintenta con "" (texto vacío).
// Nunca se manda 0.
//
// Devuelve un resultado por variante: { id, ok, error?, sinVerificar? }
const actualizarPreciosVariantes = async ({
  userId,
  accessToken,
  userAgent,
  productId,
  variantes,
}) => {
  const url = `${BASE}/${userId}/products/${productId}/variants`;
  const opciones = { headers: cabeceras({ accessToken, userAgent }) };

  const armar = (valorVacio) =>
    variantes.map((v) => ({
      id: v.id,
      price: v.price,
      promotional_price: v.promo === null || v.promo === undefined ? valorVacio : v.promo,
    }));

  const verificar = (respuesta, pendientes) => {
    const lista = Array.isArray(respuesta) ? respuesta : [];
    const resultados = [];

    for (const v of pendientes) {
      const devuelta = lista.find((x) => String(x?.id) === String(v.id));

      if (!devuelta) {
        resultados.push({ id: v.id, ok: true, sinVerificar: true });
        continue;
      }

      const precioOk = mismoPrecio(devuelta.price, v.price);
      const quiereVacia = v.promo === null || v.promo === undefined;
      const promoOk = quiereVacia
        ? promoVacia(devuelta.promotional_price)
        : mismoPrecio(devuelta.promotional_price, v.promo);

      resultados.push({
        id: v.id,
        ok: precioOk && promoOk,
        precioOk,
        promoOk,
        quiereVacia,
      });
    }

    return resultados;
  };

  const r1 = await conReintentos(() => axios.patch(url, armar(null), opciones));
  let resultados = verificar(r1.data, variantes);

  // Las que no lograron dejar el promocional en blanco: segundo intento con "".
  const reintentar = resultados.filter((r) => !r.ok && r.precioOk && r.quiereVacia && !r.promoOk);

  if (reintentar.length > 0) {
    const ids = new Set(reintentar.map((r) => String(r.id)));
    const pendientes = variantes.filter((v) => ids.has(String(v.id)));

    const r2 = await conReintentos(() =>
      axios.patch(
        url,
        pendientes.map((v) => ({ id: v.id, price: v.price, promotional_price: "" })),
        opciones
      )
    );

    const segundo = verificar(r2.data, pendientes);
    resultados = resultados.map((r) => segundo.find((s) => String(s.id) === String(r.id)) || r);
  }

  return resultados.map((r) => {
    if (r.ok) return { id: r.id, ok: true, sinVerificar: Boolean(r.sinVerificar) };

    let error = "Tiendanube no confirmó el cambio de precio.";
    if (!r.precioOk) {
      error = "Tiendanube devolvió un precio distinto al enviado.";
    } else if (r.quiereVacia && !r.promoOk) {
      error = "Tiendanube no permitió dejar en blanco el precio promocional.";
    } else if (!r.promoOk) {
      error = "Tiendanube devolvió un precio promocional distinto al enviado.";
    }
    return { id: r.id, ok: false, error };
  });
};

// Descarga todo el catálogo y devuelve una lista plana de variantes con sus precios.
const obtenerVariantesConPrecios = async ({ userId, accessToken, userAgent }) => {
  const variantes = [];
  const perPage = 50;

  for (let page = 1; page <= 200; page++) {
    const response = await conReintentos(() =>
      axios.get(`${BASE}/${userId}/products`, {
        headers: cabeceras({ accessToken, userAgent }),
        params: { page, per_page: perPage },
      })
    );

    const catalogo = response.data || [];

    for (const producto of catalogo) {
      const nombreProducto =
        typeof producto.name === "string"
          ? producto.name
          : producto.name?.es || producto.name?.pt || Object.values(producto.name || {})[0] || "";

      for (const variante of producto.variants || []) {
        const valoresVariante = Array.isArray(variante.values)
          ? variante.values
              .map((v) => (typeof v === "string" ? v : v?.es || Object.values(v || {})[0] || ""))
              .filter(Boolean)
              .join(" / ")
          : "";

        variantes.push({
          productId: producto.id,
          variantId: variante.id,
          sku: String(variante.sku || "").trim(),
          nombre: valoresVariante ? `${nombreProducto} - ${valoresVariante}` : nombreProducto,
          price: variante.price === null || variante.price === undefined ? null : Number(variante.price),
          promo: promoVacia(variante.promotional_price) ? null : Number(variante.promotional_price),
        });
      }
    }

    if (catalogo.length < perPage) break;
  }

  return variantes;
};

module.exports = {
  dormir,
  promoVacia,
  mismoPrecio,
  conReintentos,
  textoError,
  actualizarPreciosVariantes,
  obtenerVariantesConPrecios,
};
