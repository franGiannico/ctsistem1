// Cálculo de precios de Tiendanube (compartido por las rutas y por el worker).
//
// Modelo de precios:
//   - El precio base es lo que queremos cobrar NETO (después de comisiones y financiación).
//   - Precio de LISTA = precio base + comisiones + financiación. Es el precio "real" del producto.
//   - Precio PROMOCIONAL = solo existe si el producto tiene un % de descuento:
//     lista menos ese %. Sin descuento, el promocional queda vacío (null).

const CONFIG_CUOTAS = require("../config/tiendanubeCuotas");

const IVA = 1.21;

// Costos fijos validados con una venta real.
const COSTO_COBRO_MP = 0.0079 * IVA; // 0,79% + IVA
const CPT_TIENDANUBE = 0.01; // 1%
const IMPUESTO_DEBITOS = 0.006; // 0,60%

const obtenerPlanPorPrecio = (precioBase) => {
  const precio = Number(precioBase);

  if (!Number.isFinite(precio) || precio <= 0) {
    throw new Error('"precioBase" debe ser un número mayor que 0.');
  }

  const plan = CONFIG_CUOTAS.find((c) => precio >= c.minimo);

  if (!plan) {
    throw new Error("No se encontró una configuración de cuotas válida.");
  }

  return plan;
};

// Devuelve el % de descuento como número (0 < d < 100) o null si no hay descuento.
// Acepta vacío, null, 0 y "" como "sin descuento". Lanza error si el valor es inválido.
const normalizarDescuento = (valor) => {
  if (valor === undefined || valor === null) return null;

  if (typeof valor === "string") {
    const texto = valor.replace("%", "").replace(",", ".").trim();
    if (texto === "") return null;
    valor = Number(texto);
  }

  const d = Number(valor);

  if (!Number.isFinite(d)) {
    throw new Error("El % de descuento no es un número válido.");
  }

  if (d === 0) return null;

  if (d < 0 || d >= 100) {
    throw new Error("El % de descuento debe estar entre 0 y 100.");
  }

  return d;
};

// Precio promocional = lista menos el % de descuento, redondeado hacia arriba.
// (toFixed evita que errores de punto flotante, ej. 900.0000000001, suban un peso de más.)
const aplicarDescuento = (precioLista, descuento) =>
  Math.ceil(Number((precioLista * (100 - descuento) / 100).toFixed(6)));

const costoTotalDePlan = (plan) =>
  COSTO_COBRO_MP + CPT_TIENDANUBE + IMPUESTO_DEBITOS + plan.financiacion * IVA;

// Cálculo sin validar que el promocional quede por debajo de la lista
// (lo usa la búsqueda inversa, que prueba muchos valores).
const calcularSinValidar = (precioBase, descuento) => {
  const base = Number(precioBase);
  const plan = obtenerPlanPorPrecio(base);
  const costoTotal = costoTotalDePlan(plan);

  if (costoTotal >= 1) {
    throw new Error("El costo total calculado es inválido.");
  }

  // Precio de venta para que, después de todos los descuentos, quede neto el precio base.
  const precioLista = Math.ceil(base / (1 - costoTotal));

  const precioPromocional =
    descuento === null ? null : aplicarDescuento(precioLista, descuento);

  return {
    cuotas: plan.cuotas,
    financiacion: plan.financiacion,
    costoTotal,
    precioLista,
    precioPromocional,
    descuento,
  };
};

const calcularPreciosTiendanube = (precioBase, descuento = null) => {
  const d = normalizarDescuento(descuento);
  const precios = calcularSinValidar(precioBase, d);

  if (
    precios.precioPromocional !== null &&
    precios.precioPromocional >= precios.precioLista
  ) {
    throw new Error(
      "El descuento es demasiado chico: el precio promocional quedaría igual al de lista."
    );
  }

  return precios;
};

// Cálculo inverso: dado el precio FINAL al que queremos llegar en TN (el promocional si el
// producto tiene descuento, el de lista si no), devuelve el precio base más alto cuyo precio
// final no lo supere. Sirve para sugerir un precio base que le gane a la competencia.
const calcularBasePorPrecioObjetivo = (objetivo, descuento = null) => {
  const d = normalizarDescuento(descuento);
  const meta = Math.floor(Number(objetivo));

  if (!Number.isFinite(meta) || meta <= 0) {
    throw new Error('"precioObjetivo" debe ser un número mayor que 0.');
  }

  const final = (precios) =>
    precios.precioPromocional === null ? precios.precioLista : precios.precioPromocional;

  const factorDescuento = d === null ? 1 : 1 - d / 100;

  const costoInicial = calcularSinValidar(meta, d).costoTotal;
  let base = Math.max(1, Math.floor((meta * (1 - costoInicial)) / factorDescuento));
  let precios = calcularSinValidar(base, d);

  // Bajar hasta que el precio final no supere el objetivo.
  for (let i = 0; i < 300 && final(precios) > meta && base > 1; i++) {
    const exceso = final(precios) - meta;
    base = Math.max(
      1,
      base - Math.max(1, Math.ceil((exceso * (1 - precios.costoTotal)) / factorDescuento))
    );
    precios = calcularSinValidar(base, d);
  }

  if (final(precios) > meta) {
    throw new Error("No se pudo encontrar un precio base para ese objetivo.");
  }

  // Subir mientras siga sin superarlo (para no regalar margen).
  for (let i = 0; i < 300; i++) {
    const siguiente = calcularSinValidar(base + 1, d);
    if (final(siguiente) > meta) break;
    base += 1;
    precios = siguiente;
  }

  return { precioBase: base, ...precios };
};

module.exports = {
  IVA,
  obtenerPlanPorPrecio,
  normalizarDescuento,
  aplicarDescuento,
  calcularPreciosTiendanube,
  calcularBasePorPrecioObjetivo,
};
