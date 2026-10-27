// src/components/Apiingresos.jsx
// Nueva funcionalidad: Sincronización de stock desde Excel a Mercado Libre

import React, { useState, useRef } from "react";
import * as XLSX from "xlsx";
import styles from "./Apiingresos.module.css";
import MigracionPromocionales from "./MigracionPromocionales";

// Convierte un valor de celda del Excel en número. Acepta números reales y textos
// como "$ 1.234,56", "1.234,56", "1,234.56" o "1234.5".
const aNumero = (valor) => {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : 0;
  let t = String(valor ?? "").replace(/[^\d.,-]/g, "");
  if (!t) return 0;
  const coma = t.lastIndexOf(",");
  const punto = t.lastIndexOf(".");
  if (coma > -1 && punto > -1) {
    t = coma > punto ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  } else if (coma > -1) {
    t = t.replace(",", ".");
  } else if (punto > -1 && /^-?\d{1,3}(\.\d{3})+$/.test(t)) {
    t = t.replace(/\./g, "");
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
};

const sinAcentos = (texto) =>
  String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

// Interpreta el % de descuento escrito en la tabla.
//   vacío o 0  -> sin descuento (el precio promocional queda en blanco)
//   0 < d < 100 -> descuento válido
//   cualquier otra cosa -> inválido
const leerDescuento = (valor) => {
  const texto = String(valor ?? "").replace("%", "").replace(",", ".").trim();
  if (texto === "") return { valor: null, invalido: false };
  const d = Number(texto);
  if (!Number.isFinite(d) || d < 0 || d >= 100) return { valor: null, invalido: true };
  if (d === 0) return { valor: null, invalido: false };
  return { valor: d, invalido: false };
};

// Precio promocional = lista menos el % de descuento, redondeado hacia arriba
// (misma fórmula que usa el servidor al sincronizar).
const promoDesdeLista = (precioLista, descuento) =>
  Math.ceil(Number(((precioLista * (100 - descuento)) / 100).toFixed(6)));

// Precio promocional de una fila: null si no tiene descuento (o si no sirve).
const promoDeFila = (fila) => {
  const d = leerDescuento(fila.descuento);
  if (d.invalido || d.valor === null || !(fila.precioListaTN > 0)) return null;
  const promo = promoDesdeLista(fila.precioListaTN, d.valor);
  return promo < fila.precioListaTN ? promo : null;
};

// Una fila con descuento que no puede aplicarse (número inválido o descuento tan chico
// que el promocional quedaría igual a la lista).
const descuentoInvalido = (fila) => {
  const d = leerDescuento(fila.descuento);
  if (d.invalido) return "El % de descuento debe estar entre 0 y 100.";
  if (d.valor !== null && fila.precioListaTN > 0 && promoDeFila(fila) === null) {
    return "Descuento demasiado chico: el promocional quedaría igual a la lista.";
  }
  return "";
};

const ApiIngresos = () => {
  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;
  console.log("BACKEND_URL =", BACKEND_URL);
  const API_TOKEN =
    import.meta.env.VITE_API_TOKEN || "ctsistem-token-2024-seguro-123";

  const [filas, setFilas] = useState([]); // { sku, stock, nombre, estado }
  const [procesando, setProcesando] = useState(false);
  const [resumen, setResumen] = useState(null); // { ok, errores, total }
  const [archivoNombre, setArchivoNombre] = useState("");
  const inputRef = useRef(null);
  const [sincronizarML, setSincronizarML] = useState(true);
  const [sincronizarStockTN, setSincronizarStockTN] = useState(true);
  const [sincronizarPreciosTN, setSincronizarPreciosTN] = useState(true);
  const [progresoTN, setProgresoTN] = useState(null);
  const [columnaCosto, setColumnaCosto] = useState(""); // nombre de la columna de costo del Excel
  const [descuentoGeneral, setDescuentoGeneral] = useState(""); // % para "Aplicar a todos"

  // Comparación de precios con la competencia en Mercado Libre (opcional, independiente
  // de la sync de precios TN): agrega una columna a la tabla.
  const [compararPrecios, setCompararPrecios] = useState(false);
  const [comparando, setComparando] = useState(false);
  const [progresoComparacion, setProgresoComparacion] = useState(null);

  // Se sincroniza algo de Tiendanube si al menos una de las dos opciones está tildada
  const activarTN = sincronizarStockTN || sincronizarPreciosTN;

  //Función para calcular stock a publicar (restar 1 al stock real, mínimo 0)
  const calcularStockAPublicar = (stockExcel) => {
  const stock = Number(stockExcel) || 0;
  return Math.max(stock - 1, 0);
  };
  // Lee el Excel y extrae las columnas SKU y Stock
  const handleArchivo = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setArchivoNombre(file.name);
    setResumen(null);

    const reader = new FileReader();
    reader.onload = (evt) => {
      const workbook = XLSX.read(evt.target.result, { type: "binary" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(sheet, { defval: "" });

      // Buscar columnas SKU y Stock (case-insensitive, ignorar "Stock Critico")
      if (data.length === 0) return;

      const headers = Object.keys(data[0]);
      const colSKU = headers.find((h) => h.trim().toLowerCase() === "sku");
      const colStock = headers.find(
        (h) =>
          h.trim().toLowerCase() === "stock" &&
          !h.toLowerCase().includes("critico") &&
          !h.toLowerCase().includes("crítico")
      );
      const colNombre = headers.find(
        (h) =>
          h.trim().toLowerCase() === "nombre" ||
          h.trim().toLowerCase() === "articulo" ||
          h.trim().toLowerCase() === "artículo"
      );
      const colPrecio = headers.find(
        (h) => h.trim().toLowerCase() === "precio"
      );
      // Columna opcional con el costo de cada producto: se aceptan los nombres más
      // comunes y, si no, cualquier columna que contenga "costo" (salvo stock crítico).
      const NOMBRES_COSTO = [
        "costo",
        "precio de costo",
        "precio costo",
        "costo unitario",
        "costo neto",
        "p. costo",
        "p.costo",
      ];
      const colCosto =
        headers.find((h) => NOMBRES_COSTO.includes(sinAcentos(h))) ||
        headers.find((h) => {
          const n = sinAcentos(h);
          return n.includes("costo") && !n.includes("stock") && !n.includes("crit");
        });

      // Columna opcional con el % de descuento de cada producto (para promociones).
      const colDescuento = headers.find((h) =>
        ["descuento", "% descuento", "descuento %", "desc", "desc.", "% desc", "% desc."].includes(
          sinAcentos(h)
        )
      );

      if (!colSKU || !colStock || !colPrecio) {
        alert(
           "No se encontraron las columnas SKU, Stock y/o Precio en el archivo. Verificá el formato."
        );
        return;
      }

      const filasParsed = data
        .filter((row) => row[colSKU] && row[colSKU].toString().trim() !== "")
        .map((row) => {
          const stock = parseInt(row[colStock]) || 0;
          const precioBase = Number(row[colPrecio]) || 0;

          return {
            sku: row[colSKU].toString().trim(),
            stock,
            stockAPublicar: Math.max(stock - 1, 0),
            precioBase,
            costo: colCosto ? aNumero(row[colCosto]) : 0,
            nombre: colNombre ? row[colNombre] : "",
            estado: "pendiente",
            mensaje: "",
            mlEstado: "pendiente",
            mlMensaje: "",
            tnEstado: "pendiente",
            tnMensaje: "",
            // Precio de lista que se publica (precio base + comisiones y financiación).
            // El promocional no se guarda: se deriva de la lista y del % de descuento.
            precioListaTN: null,
            costoTotalTN: null,
            cuotasTN: null,
            // % de descuento ("" = sin promoción: el promocional queda en blanco en TN)
            descuento: colDescuento && leerDescuento(row[colDescuento]).valor !== null
              ? String(leerDescuento(row[colDescuento]).valor)
              : "",
            precioTNError: "",
            precioTNCalculando: true,
            sugBase: null,
            sugLista: null,
            sugCostoTotal: null,
            sugCuotas: null,
            sugTipo: "",
            sugError: "",
            catRef: null,
            catEstado: "pendiente",
            catMensaje: "",
            catMejor: null,
            catComparable: null,
            catParaGanar: null,
            catStatus: "",
          };
        });

      setFilas(filasParsed);
      setColumnaCosto(colCosto || "");
      cargarPreciosTN(filasParsed);
    };
    reader.readAsBinaryString(file);
  };

  // Trae el precio de lista/promocional que Tiendanube va a publicar,
  // aplicando la misma fórmula de costos que usa la sincronización real
  // (pero sin tocar Tiendanube: es solo una previsualización).
  const cargarPreciosTN = async (filasParaCalcular) => {
    if (!filasParaCalcular || filasParaCalcular.length === 0) return;

    try {
      const res = await fetch(
        `${BACKEND_URL}/tiendanube/calcular-precios`,
        {
          method: "POST",
          headers: {
            Authorization: API_TOKEN,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            productos: filasParaCalcular.map((fila) => ({
              sku: fila.sku,
              precioBase: fila.precioBase,
            })),
          }),
        }
      );

      const data = await res.json();
      const resultadosPorSku = new Map(
        (data.resultados || []).map((resultado) => [
          String(resultado.sku || "").trim().toLowerCase(),
          resultado,
        ])
      );

      setFilas((prev) =>
        prev.map((fila) => {
          const resultado = resultadosPorSku.get(
            String(fila.sku).trim().toLowerCase()
          );

          if (!resultado) {
            return {
              ...fila,
              precioTNCalculando: false,
              precioTNError: "No se pudo calcular el precio TN",
            };
          }

          if (resultado.error) {
            return {
              ...fila,
              precioTNCalculando: false,
              precioTNError: resultado.error,
            };
          }

          return {
            ...fila,
            precioTNCalculando: false,
            precioListaTN: resultado.precioLista,
            costoTotalTN: resultado.costoTotal,
            cuotasTN: resultado.cuotas,
            precioTNError: "",
          };
        })
      );
    } catch (error) {
      console.error("Error calculando precios TN:", error);
      setFilas((prev) =>
        prev.map((fila) => ({
          ...fila,
          precioTNCalculando: false,
          precioTNError: "Error al calcular el precio TN",
        }))
      );
    }
  };

  const encabezadosJSON = () => ({
    Authorization: API_TOKEN,
    "Content-Type": "application/json",
  });

  const formatoARS = (n) =>
    Number(n || 0).toLocaleString("es-AR", {
      style: "currency",
      currency: "ARS",
      maximumFractionDigits: 0,
    });

  // Productos con descuento y descuentos que no se pueden aplicar
  const conDescuento = filas.filter((f) => promoDeFila(f) !== null).length;
  const hayDescuentosInvalidos = filas.some((f) => descuentoInvalido(f));

  // Hay costo cargado para al menos un producto: se muestran las columnas de margen
  const tieneCosto = filas.some((f) => f.costo > 0);

  // Margen = (precio neto − costo) / precio neto. Sin descuento, el neto es el precio base
  // (lo que queda después de las comisiones de Tiendanube). Con descuento, el neto es lo
  // que queda de vender al precio promocional: promocional × (1 − costos de TN).
  // Supone que costo y precio base están en la misma base de IVA.
  const netoDeFila = (fila) => {
    const promo = promoDeFila(fila);
    if (promo !== null && fila.costoTotalTN > 0) {
      return promo * (1 - fila.costoTotalTN);
    }
    return fila.precioBase;
  };

  // Neto del precio base sugerido (con descuento: lo que queda de vender al promocional)
  const netoSugerido = (fila) => {
    const d = leerDescuento(fila.descuento);
    if (d.valor !== null && fila.sugLista > 0 && fila.sugCostoTotal > 0) {
      const promo = promoDesdeLista(fila.sugLista, d.valor);
      if (promo < fila.sugLista) return promo * (1 - fila.sugCostoTotal);
    }
    return fila.sugBase;
  };

  const calcularMargen = (precio, costo) => {
    if (!(costo > 0) || !(precio > 0)) return null;
    const monto = precio - costo;
    return { monto, porcentaje: (monto / precio) * 100 };
  };

  const renderMargen = (m) =>
    m ? (
      <span className={m.monto < 0 ? styles.margenNegativo : styles.margenPositivo}>
        {formatoARS(m.monto)} (
        {m.porcentaje.toLocaleString("es-AR", { maximumFractionDigits: 1 })}%)
      </span>
    ) : (
      "—"
    );

  const actualizarFilaPorSku = (sku, cambios) => {
    setFilas((prev) => prev.map((f) => (f.sku === sku ? { ...f, ...cambios } : f)));
  };

  // Recalcula la previsualización TN de UNA fila (después de cambiar su precio base)
  const recalcularPrecioTNFila = async (sku, precioBase) => {
    actualizarFilaPorSku(sku, { precioTNCalculando: true, precioTNError: "" });
    try {
      const res = await fetch(`${BACKEND_URL}/tiendanube/calcular-precios`, {
        method: "POST",
        headers: encabezadosJSON(),
        body: JSON.stringify({ productos: [{ sku, precioBase }] }),
      });
      const data = await res.json();
      const r = (data.resultados || [])[0];

      setFilas((prev) =>
        prev.map((f) => {
          // Si mientras tanto se cambió otra vez el precio, no pisamos con una respuesta vieja
          if (f.sku !== sku || f.precioBase !== precioBase) return f;
          if (!r || r.error) {
            return {
              ...f,
              precioTNCalculando: false,
              precioTNError: (r && r.error) || "No se pudo calcular el precio TN",
            };
          }
          return {
            ...f,
            precioTNCalculando: false,
            precioListaTN: r.precioLista,
            costoTotalTN: r.costoTotal,
            cuotasTN: r.cuotas,
            precioTNError: "",
          };
        })
      );
    } catch (error) {
      actualizarFilaPorSku(sku, {
        precioTNCalculando: false,
        precioTNError: "Error al calcular el precio TN",
      });
    }
  };

  // Confirma un precio base editado a mano (al salir del campo o con Enter)
  const confirmarPrecioBase = (i, valor, input) => {
    const fila = filas[i];
    if (!fila) return;
    const nuevo = Number(String(valor).replace(",", "."));

    if (!Number.isFinite(nuevo) || nuevo <= 0) {
      if (input) input.value = fila.precioBase;
      return;
    }
    if (nuevo === fila.precioBase) return;

    setFilas((prev) =>
      prev.map((f, idx) =>
        idx === i
          ? {
              ...f,
              precioBase: nuevo,
              estado: "pendiente",
              mensaje: "",
              tnEstado: "pendiente",
              tnMensaje: "",
            }
          : f
      )
    );
    recalcularPrecioTNFila(fila.sku, nuevo);
  };

  // Aplica el precio base sugerido (solo cuando el usuario toca el botón)
  const aplicarPrecioSugerido = (sku) => {
    setFilas((prev) =>
      prev.map((f) =>
        f.sku === sku && f.sugBase
          ? {
              ...f,
              precioBase: f.sugBase,
              precioListaTN: f.sugLista,
              costoTotalTN: f.sugCostoTotal,
              cuotasTN: f.sugCuotas,
              precioTNError: "",
              precioTNCalculando: false,
              estado: "pendiente",
              mensaje: "",
              tnEstado: "pendiente",
              tnMensaje: "",
            }
          : f
      )
    );
  };

  // Cambia el % de descuento de una fila. Si ya se comparó con ML, se recalcula el precio
  // base sugerido (porque lo que paga el cliente pasa a ser el promocional).
  const cambiarDescuento = (i, valor) => {
    const fila = filas[i];
    if (!fila) return;
    const texto = String(valor ?? "").trim();
    if (texto === String(fila.descuento ?? "").trim()) return;

    const sku = fila.sku;
    setFilas((prev) =>
      prev.map((f, idx) =>
        idx === i
          ? {
              ...f,
              descuento: texto,
              estado: "pendiente",
              mensaje: "",
              tnEstado: "pendiente",
              tnMensaje: "",
              sugBase: null,
              sugError: "",
            }
          : f
      )
    );

    if (fila.catRef) {
      recalcularSugerencias([{ sku, precioObjetivo: fila.catRef.precio - 1, tipo: fila.catRef.tipo, descuento: texto }]);
    }
  };

  // Aplica el mismo % de descuento a todos los productos del Excel (promoción)
  const aplicarDescuentoATodos = () => {
    const d = leerDescuento(descuentoGeneral);
    if (d.invalido || d.valor === null) {
      alert("Ingresá un % de descuento mayor que 0 y menor que 100.");
      return;
    }
    const texto = String(d.valor);
    const objetivos = [];

    setFilas((prev) =>
      prev.map((f) => ({
        ...f,
        descuento: texto,
        estado: "pendiente",
        mensaje: "",
        tnEstado: "pendiente",
        tnMensaje: "",
        sugBase: null,
        sugError: "",
      }))
    );

    filas.forEach((f) => {
      if (f.catRef) {
        objetivos.push({ sku: f.sku, precioObjetivo: f.catRef.precio - 1, tipo: f.catRef.tipo, descuento: texto });
      }
    });
    if (objetivos.length > 0) recalcularSugerencias(objetivos);
  };

  // Saca todos los descuentos: los productos se publican solo con precio de lista
  const quitarDescuentos = () => {
    const objetivos = [];

    setFilas((prev) =>
      prev.map((f) => ({
        ...f,
        descuento: "",
        estado: "pendiente",
        mensaje: "",
        tnEstado: "pendiente",
        tnMensaje: "",
        sugBase: null,
        sugError: "",
      }))
    );
    setDescuentoGeneral("");

    filas.forEach((f) => {
      if (f.catRef) {
        objetivos.push({ sku: f.sku, precioObjetivo: f.catRef.precio - 1, tipo: f.catRef.tipo, descuento: "" });
      }
    });
    if (objetivos.length > 0) recalcularSugerencias(objetivos);
  };

  // Calcula el precio base que lleva el precio FINAL de TN (el promocional si el producto
  // tiene descuento, el de lista si no) a $1 por debajo de la competencia. Solo sugiere.
  const recalcularSugerencias = async (objetivos) => {
    if (!objetivos || objetivos.length === 0) return;
    try {
      const res = await fetch(`${BACKEND_URL}/tiendanube/calcular-precio-base-objetivo`, {
        method: "POST",
        headers: encabezadosJSON(),
        body: JSON.stringify({
          productos: objetivos.map((o) => ({
            sku: o.sku,
            precioObjetivo: o.precioObjetivo,
            descuento: leerDescuento(o.descuento).valor,
          })),
        }),
      });
      const data = await res.json();
      const porSku = new Map((data.resultados || []).map((r) => [r.sku, r]));

      objetivos.forEach((o) => {
        const r = porSku.get(o.sku);
        if (!r || r.error) {
          actualizarFilaPorSku(o.sku, {
            sugBase: null,
            sugError: (r && r.error) || "No se pudo calcular el precio sugerido",
          });
          return;
        }
        actualizarFilaPorSku(o.sku, {
          sugBase: r.precioBase,
          sugLista: r.precioLista,
          sugCostoTotal: r.costoTotal,
          sugCuotas: r.cuotas,
          sugTipo: o.tipo,
          sugError: "",
        });
      });
    } catch (error) {
      console.error("Error calculando precios sugeridos:", error);
    }
  };

  // Texto de una oferta de la competencia en ML: envío gratis y cuotas sin interés
  const renderOfertaML = (o) => (
    <>
      <strong>{formatoARS(o.precio)}</strong>
      <div className={styles.cmpChips}>
        <span className={o.envioGratis === true ? styles.chipSi : styles.chipNo}>
          {o.envioGratis === true
            ? "🚚 Envío gratis"
            : o.envioGratis === false
            ? "Sin envío gratis"
            : "Envío: sin dato"}
        </span>
        <span className={o.sinInteres ? styles.chipSi : styles.chipNo}>
          {o.sinInteres ? `💳 ${o.cuotas} cuotas sin interés` : "Sin cuotas sin interés"}
        </span>
      </div>
    </>
  );

  // Compara cada producto contra la competencia en Mercado Libre (catálogo, API
  // oficial): automático, solo hace falta tener la publicación con ese SKU vinculada
  // a un producto de catálogo. Después calcula el precio base sugerido. Es solo una
  // sugerencia: no modifica ningún precio por sí sola.
  const consultarFilas = async (lista) => {
    const objetivos = [];

    for (let n = 0; n < lista.length; n++) {
      const f = lista[n];
      setProgresoComparacion({
        hecho: n,
        total: lista.length,
        mensaje: `Consultando ${f.sku}...`,
      });
      actualizarFilaPorSku(f.sku, {
        catEstado: "comparando",
        catMensaje: "",
        catMejor: null,
        catComparable: null,
        catParaGanar: null,
        catRef: null,
        sugBase: null,
        sugError: "",
      });

      let referencia = null; // { precio, tipo }

      try {
        const res = await fetch(`${BACKEND_URL}/meli/competencia-catalogo`, {
          method: "POST",
          headers: encabezadosJSON(),
          body: JSON.stringify({ sku: f.sku }),
        });
        const d = await res.json();

        if (!res.ok || d.error) {
          actualizarFilaPorSku(f.sku, {
            catEstado: "error",
            catMensaje: d.error || "No se pudo consultar Mercado Libre",
          });
        } else if (!d.encontrada || !d.enCatalogo) {
          actualizarFilaPorSku(f.sku, {
            catEstado: "sin_catalogo",
            catMensaje: d.mensaje || "Sin datos de catálogo en Mercado Libre",
          });
        } else {
          // Ofertas ordenadas de menor a mayor precio. "Comparable" = la más barata
          // con cuotas sin interés iguales o mejores que las de Tiendanube.
          const ofertas = Array.isArray(d.ofertas) ? d.ofertas : [];
          const comparable =
            ofertas.find(
              (o) => o.sinInteres && (!f.cuotasTN || o.cuotas >= f.cuotasTN)
            ) || null;
          const mejor = d.mejor || null;

          actualizarFilaPorSku(f.sku, {
            catEstado: "ok",
            catMejor: mejor,
            catComparable:
              comparable && (!mejor || comparable.itemId !== mejor.itemId)
                ? comparable
                : null,
            catParaGanar: d.precioParaGanar || null,
            catStatus: d.estado || "",
          });

          const ref = comparable || mejor;
          if (ref) {
            referencia = { precio: ref.precio, tipo: comparable ? "comparable" : "general" };
          }
        }
      } catch (error) {
        actualizarFilaPorSku(f.sku, {
          catEstado: "error",
          catMensaje: "Error de conexión con Mercado Libre",
        });
      }

      if (referencia && referencia.precio > 1 && f.precioListaTN) {
        // Se guarda la referencia para poder recalcular si después cambia el descuento
        actualizarFilaPorSku(f.sku, { catRef: referencia });
        objetivos.push({
          sku: f.sku,
          precioObjetivo: referencia.precio - 1,
          tipo: referencia.tipo,
          descuento: f.descuento,
        });
      }

      // Pausa corta para no saturar la API
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    // Precio base que lleva el promocional de TN a $1 por debajo de la competencia
    if (objetivos.length > 0) {
      setProgresoComparacion({
        hecho: lista.length,
        total: lista.length,
        mensaje: "Calculando precios sugeridos...",
      });
      await recalcularSugerencias(objetivos);
    }
  };

  // Compara todos los productos cargados contra Mercado Libre
  const handleCompararPrecios = async () => {
    if (filas.length === 0 || comparando) return;
    setComparando(true);
    setProgresoComparacion({ hecho: 0, total: filas.length, mensaje: "Consultando Mercado Libre..." });

    try {
      await consultarFilas(filas);
      setProgresoComparacion({
        hecho: filas.length,
        total: filas.length,
        mensaje: `Listo: ${filas.length} productos comparados con Mercado Libre.`,
      });
    } catch (error) {
      console.error("Error comparando precios:", error);
      setProgresoComparacion({
        hecho: 0,
        total: 0,
        mensaje: "Error al comparar precios. Probá de nuevo.",
      });
    }

    setComparando(false);
  };

  const esperar = (milisegundos) =>
  new Promise((resolve) => setTimeout(resolve, milisegundos));

 // Sincroniza ML individualmente y Tiendanube en una sola operación masiva
const handleSincronizar = async () => {
  if (filas.length === 0) return;

  if (!sincronizarML && !activarTN) {
    alert("Seleccioná al menos una plataforma para sincronizar.");
    return;
  }

  if (sincronizarPreciosTN && hayDescuentosInvalidos) {
    alert("Hay productos con un % de descuento inválido. Corregilos (marcados en rojo) antes de sincronizar.");
    return;
  }

  setProcesando(true);
  setResumen(null);

  let filasActualizadas = filas.map((fila) => ({
    ...fila,
    estado: "procesando",
    mensaje: "Sincronizando...",
    mlEstado: sincronizarML ? "procesando" : "omitido",
    mlMensaje: sincronizarML ? "Esperando sincronización..." : "Omitido",
    tnEstado: activarTN ? "procesando" : "omitido",
    tnMensaje: activarTN ? "Esperando sincronización..." : "Omitido",
  }));

  setFilas([...filasActualizadas]);

  /*
   * 1. MERCADO LIBRE
   * Se mantiene la actualización individual por SKU.
   */
  if (sincronizarML) {
    for (let i = 0; i < filasActualizadas.length; i++) {
      const fila = filasActualizadas[i];

      filasActualizadas[i] = {
        ...fila,
        mlEstado: "procesando",
        mlMensaje: "Sincronizando ML...",
      };

      setFilas([...filasActualizadas]);

      try {
        const responseML = await fetch(
          `${BACKEND_URL}/meli/actualizar-stock`,
          {
            method: "POST",
            headers: {
              Authorization: API_TOKEN,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              sku: fila.sku,
              cantidad: fila.stockAPublicar,
            }),
          }
        );

        const dataML = await responseML.json();

        if (responseML.ok && dataML.success) {
          filasActualizadas[i] = {
            ...filasActualizadas[i],
            mlEstado: "ok",
            mlMensaje:
              dataML.mensaje || "Stock actualizado correctamente en ML",
          };
        } else {
          filasActualizadas[i] = {
            ...filasActualizadas[i],
            mlEstado: "error",
            mlMensaje: dataML.error || "Error desconocido en ML",
          };
        }
      } catch (error) {
        filasActualizadas[i] = {
          ...filasActualizadas[i],
          mlEstado: "error",
          mlMensaje: "Error de conexión con ML",
        };
      }

      setFilas([...filasActualizadas]);

      // Pausa para no saturar la API de Mercado Libre
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  /*
   * 2. TIENDANUBE
   * Trabajo asíncrono masivo: se envía todo el lote y luego se consulta el progreso.
   * El backend se encarga de crear el trabajo en MongoDB y procesarlo en segundo plano.
   */
  if (activarTN) {
  filasActualizadas = filasActualizadas.map((fila) => ({
    ...fila,
    tnEstado: "procesando",
    tnMensaje: "Iniciando sincronización...",
  }));

  setFilas([...filasActualizadas]);
  setProgresoTN({
    estado: "iniciando",
    procesados: 0,
    total: filasActualizadas.length,
    porcentaje: 0,
  });

  try {
    /*
     * 1. Crear el trabajo en MongoDB.
     * El backend responde inmediatamente con el jobId.
     */
    const responseInicio = await fetch(
      `${BACKEND_URL}/tiendanube/iniciar-sincronizacion`,
      {
        method: "POST",
        headers: {
          Authorization: API_TOKEN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          productos: filasActualizadas.map((fila) => ({
            sku: fila.sku,
            cantidad: fila.stockAPublicar,
            precioBase: fila.precioBase,
            // Sin descuento = sin promoción: el servidor deja el promocional en blanco
            descuento: leerDescuento(fila.descuento).valor,
          })),
          sincronizarStock: sincronizarStockTN,
          sincronizarPrecios: sincronizarPreciosTN,
        }),
      }
    );

    const dataInicio = await responseInicio.json();

    if (!responseInicio.ok || !dataInicio.success || !dataInicio.jobId) {
      throw new Error(
        dataInicio.error || "No se pudo iniciar la sincronización de Tiendanube"
      );
    }

    const jobId = dataInicio.jobId;
    let trabajoFinalizado = false;
    let datosFinales = null;

    /*
     * 2. Consultar el progreso cada 3 segundos.
     */
    while (!trabajoFinalizado) {
      await esperar(3000);

      const responseEstado = await fetch(
        `${BACKEND_URL}/tiendanube/estado-sincronizacion/${jobId}`,
        {
          method: "GET",
          headers: {
            Authorization: API_TOKEN,
            Accept: "application/json",
          },
        }
      );

      const dataEstado = await responseEstado.json();

      if (!responseEstado.ok) {
        throw new Error(
          dataEstado.error || "No se pudo consultar el progreso de Tiendanube"
        );
      }

      setProgresoTN({
        estado: dataEstado.estado,
        procesados: dataEstado.procesados,
        total: dataEstado.total,
        porcentaje: dataEstado.porcentaje,
        exitosos: dataEstado.exitosos,
        errores: dataEstado.errores,
      });

      /*
       * Para no modificar 1.200 filas cada tres segundos,
       * mostramos el progreso general en todas mientras procesa.
       */
      filasActualizadas = filasActualizadas.map((fila) => ({
        ...fila,
        tnEstado: "procesando",
        tnMensaje:
          `Procesando ${dataEstado.procesados} de ${dataEstado.total} ` +
          `(${dataEstado.porcentaje}%)`,
      }));

      setFilas([...filasActualizadas]);

      if (dataEstado.estado === "finalizado") {
        trabajoFinalizado = true;
        datosFinales = dataEstado;
      }

      if (dataEstado.estado === "error") {
        throw new Error(
          dataEstado.mensajeError ||
            "La sincronización de Tiendanube terminó con error"
        );
      }
    }

    /*
     * 3. Distribuir los resultados finales por SKU.
     */
    const resultadosPorSku = new Map(
      (datosFinales.resultados || []).map((resultado) => [
        String(resultado.sku || "").trim().toLowerCase(),
        resultado,
      ])
    );

    filasActualizadas = filasActualizadas.map((fila) => {
      const skuNormalizado = String(fila.sku)
        .trim()
        .toLowerCase();

      const resultadoTN = resultadosPorSku.get(skuNormalizado);

      if (!resultadoTN) {
        return {
          ...fila,
          tnEstado: "error",
          tnMensaje: "Tiendanube no devolvió resultado para este SKU",
        };
      }

      if (resultadoTN.success) {
        const mensajePrecio = resultadoTN.precioLista
          ? `Lista: $${Number(resultadoTN.precioLista).toLocaleString("es-AR")} | ` +
            (resultadoTN.precioPromocional
              ? `Promo: $${Number(resultadoTN.precioPromocional).toLocaleString("es-AR")}` +
                (resultadoTN.descuento ? ` (-${resultadoTN.descuento}%)` : "")
              : "Sin promoción")
          : resultadoTN.mensaje || "Actualizado correctamente";

        return {
          ...fila,
          tnEstado: "ok",
          tnMensaje: mensajePrecio,
        };
      }

      return {
        ...fila,
        tnEstado: "error",
        tnMensaje:
          resultadoTN.error || "Error desconocido en Tiendanube",
      };
    });

    setProgresoTN({
      estado: "finalizado",
      procesados: datosFinales.procesados,
      total: datosFinales.total,
      porcentaje: 100,
      exitosos: datosFinales.exitosos,
      errores: datosFinales.errores,
    });

    setFilas([...filasActualizadas]);
  } catch (error) {
    console.error("Error sincronizando Tiendanube:", error);

    filasActualizadas = filasActualizadas.map((fila) => ({
      ...fila,
      tnEstado: "error",
      tnMensaje:
        error.message || "Error al ejecutar la sincronización de Tiendanube",
    }));

    setProgresoTN({
      estado: "error",
      mensajeError: error.message,
    });

    setFilas([...filasActualizadas]);
  }
}

  /*
   * 3. RESULTADO GENERAL POR FILA
   */
  filasActualizadas = filasActualizadas.map((fila) => {
    const mlCorrecto =
      !sincronizarML || fila.mlEstado === "ok";

    const tnCorrecto =
      !activarTN || fila.tnEstado === "ok";

    const filaCorrecta = mlCorrecto && tnCorrecto;

    return {
      ...fila,
      estado: filaCorrecta ? "ok" : "error",
      mensaje: filaCorrecta
        ? "Sincronización completada"
        : "Revisar el resultado de ML y/o TN",
    };
  });

  const ok = filasActualizadas.filter(
    (fila) => fila.estado === "ok"
  ).length;

  const errores = filasActualizadas.filter(
    (fila) => fila.estado === "error"
  ).length;

  setFilas([...filasActualizadas]);

  setResumen({
    ok,
    errores,
    total: filasActualizadas.length,
  });

  setProcesando(false);
};
  
// Función para descargar los resultados en un archivo Excel
const handleDescargarResultados = () => {
  if (filas.length === 0) {
    alert("No hay resultados para descargar.");
    return;
  }

  const datosExcel = filas.map((fila) => ({
    Estado:
      fila.estado === "ok"
        ? "Correcto"
        : fila.estado === "error"
        ? "Error"
        : fila.estado === "procesando"
        ? "Procesando"
        : "Pendiente",

    SKU: fila.sku || "",
    Nombre: fila.nombre || "",
    "Stock original": fila.stock ?? "",
    "Stock publicado": fila.stockAPublicar ?? "",
    "Precio base": fila.precioBase ?? "",
    "Precio de lista TN": fila.precioListaTN ?? "",
    "% Descuento": leerDescuento(fila.descuento).valor ?? "",
    "Precio promocional TN": promoDeFila(fila) ?? "",
    ...(tieneCosto
      ? {
          Costo: fila.costo > 0 ? fila.costo : "",
          "Margen actual ($)": calcularMargen(netoDeFila(fila), fila.costo)?.monto ?? "",
          "Margen actual (%)": (() => {
            const m = calcularMargen(netoDeFila(fila), fila.costo);
            return m ? Number(m.porcentaje.toFixed(1)) : "";
          })(),
        }
      : {}),
    "Competencia ML (más barato)": fila.catMejor ? fila.catMejor.precio : "",
    "Competencia ML: envío gratis": fila.catMejor
      ? fila.catMejor.envioGratis === true
        ? "Sí"
        : fila.catMejor.envioGratis === false
        ? "No"
        : ""
      : "",
    "Competencia ML: cuotas sin interés": fila.catMejor
      ? fila.catMejor.sinInteres
        ? fila.catMejor.cuotas
        : "No"
      : "",
    "Competencia ML (con tus cuotas)": fila.catComparable ? fila.catComparable.precio : "",
    "Precio base sugerido": fila.sugBase ?? "",
    ...(tieneCosto
      ? {
          "Margen con sugerido ($)": calcularMargen(netoSugerido(fila), fila.costo)?.monto ?? "",
          "Margen con sugerido (%)": (() => {
            const m = calcularMargen(netoSugerido(fila), fila.costo);
            return m ? Number(m.porcentaje.toFixed(1)) : "";
          })(),
        }
      : {}),

    "Estado Mercado Libre":
      fila.mlEstado === "ok"
        ? "Correcto"
        : fila.mlEstado === "error"
        ? "Error"
        : fila.mlEstado === "omitido"
        ? "Omitido"
        : fila.mlEstado === "procesando"
        ? "Procesando"
        : "Pendiente",

    "Detalle Mercado Libre": fila.mlMensaje || "",

    "Estado Tiendanube":
      fila.tnEstado === "ok"
        ? "Correcto"
        : fila.tnEstado === "error"
        ? "Error"
        : fila.tnEstado === "omitido"
        ? "Omitido"
        : fila.tnEstado === "procesando"
        ? "Procesando"
        : "Pendiente",

    "Detalle Tiendanube": fila.tnMensaje || "",

    "Resultado general": fila.mensaje || "",
  }));

  const hoja = XLSX.utils.json_to_sheet(datosExcel);

  hoja["!cols"] = [
    { wch: 14 }, // Estado
    { wch: 18 }, // SKU
    { wch: 45 }, // Nombre
    { wch: 15 }, // Stock original
    { wch: 16 }, // Stock publicado
    { wch: 16 }, // Precio base
    { wch: 18 }, // Precio de lista TN
    { wch: 13 }, // % Descuento
    { wch: 20 }, // Precio promocional TN
    ...(tieneCosto
      ? [
          { wch: 14 }, // Costo
          { wch: 18 }, // Margen actual ($)
          { wch: 18 }, // Margen actual (%)
        ]
      : []),
    { wch: 22 }, // Competencia ML (más barato)
    { wch: 18 }, // Competencia ML: envío gratis
    { wch: 22 }, // Competencia ML: cuotas sin interés
    { wch: 22 }, // Competencia ML (con tus cuotas)
    { wch: 18 }, // Precio base sugerido
    ...(tieneCosto
      ? [
          { wch: 22 }, // Margen con sugerido ($)
          { wch: 22 }, // Margen con sugerido (%)
        ]
      : []),
    { wch: 22 }, // Estado ML
    { wch: 60 }, // Detalle ML
    { wch: 20 }, // Estado TN
    { wch: 60 }, // Detalle TN
    { wch: 30 }, // Resultado general
  ];

  // Activa el autofiltro en la primera fila.
  hoja["!autofilter"] = {
    ref: hoja["!ref"],
  };

  const libro = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    libro,
    hoja,
    "Resultado sincronización"
  );

  const ahora = new Date();

  const fecha = ahora
    .toLocaleDateString("es-AR")
    .replaceAll("/", "-");

  const hora = ahora
    .toLocaleTimeString("es-AR", {
      hour: "2-digit",
      minute: "2-digit",
    })
    .replaceAll(":", "-");

  XLSX.writeFile(
    libro,
    `sincronizacion-${fecha}-${hora}.xlsx`
  );
};

  const handleLimpiar = () => {
    setFilas([]);
    setResumen(null);
    setArchivoNombre("");
    setColumnaCosto("");
    setDescuentoGeneral("");
    setProgresoComparacion(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const estadoIcono = (estado) => {
    switch (estado) {
      case "ok":
        return "✅";
      case "error":
        return "❌";
      case "procesando":
        return "⏳";
      default:
        return "⬜";
    }
  };

  const pendientes = filas.filter((f) => f.estado === "pendiente").length;
  const listos = filas.filter((f) => f.estado === "ok").length;
  const conError = filas.filter((f) => f.estado === "error").length;

  const [dragActivo, setDragActivo] = useState(false);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragActivo(false);

    if (procesando) return;

    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    const extensionesValidas = [".xlsx", ".xls"];
    const esValido = extensionesValidas.some((ext) =>
      file.name.toLowerCase().endsWith(ext)
    );

    if (!esValido) {
      alert("Seleccioná un archivo Excel válido.");
      return;
    }

    handleArchivo({
      target: {
        files: [file],
      },
    });
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    if (!procesando) setDragActivo(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setDragActivo(false);
  };

  // Anchos (%) de las columnas según las opcionales visibles (costo y competencia ML)
  const anchosColumnas =
    tieneCosto && compararPrecios
      ? [4, 8, 10, 4, 7, 8, 9, 10, 6, 18, 8, 8]
      : compararPrecios
      ? [4, 8, 13, 4, 7, 8, 10, 6, 22, 9, 9]
      : tieneCosto
      ? [5, 8, 12, 5, 7, 9, 10, 10, 6, 14, 14]
      : [5, 8, 14, 5, 8, 9, 12, 6, 16.5, 16.5];
  const anchoMinimoTabla =
    tieneCosto && compararPrecios ? 1660 : compararPrecios ? 1340 : tieneCosto ? 1110 : 0;

  return (
    <div className={styles.container}>
      <h2 className={styles.title}>Sincronización de Stock → Mercado Libre</h2>
      <p className={styles.subtitle}>
        Cargá el reporte de stock en Excel y actualizá todas las publicaciones
        de ML automáticamente.
      </p>
      {/* Herramienta de una sola vez: pasar promocionales actuales a precio de lista */}
      <MigracionPromocionales backendUrl={BACKEND_URL} apiToken={API_TOKEN} />

      {/* Opciones de sincronización */}
      <div className={styles.opcionesSync}>
        <label className={styles.switchLabel}>
          <input
            type="checkbox"
            checked={sincronizarML}
            onChange={(e) => setSincronizarML(e.target.checked)}
          />
          Sincronizar stock ML
        </label>

        <label className={styles.switchLabel}>
          <input
            type="checkbox"
            checked={sincronizarStockTN}
            onChange={(e) => setSincronizarStockTN(e.target.checked)}
          />
          Sincronizar stock TN
        </label>

        <label className={styles.switchLabel}>
          <input
            type="checkbox"
            checked={sincronizarPreciosTN}
            onChange={(e) => setSincronizarPreciosTN(e.target.checked)}
          />
          Sincronizar precios TN
        </label>

        <label className={styles.switchLabel}>
          <input
            type="checkbox"
            checked={compararPrecios}
            onChange={(e) => setCompararPrecios(e.target.checked)}
          />
          Comparar precios con ML
        </label>
      </div>

      {/* Zona de carga */}
      <div
        className={`${styles.uploadZone} ${dragActivo ? styles.dragActivo : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={handleArchivo}
          className={styles.fileInput}
          id="fileInput"
          disabled={procesando}
        />

        <label htmlFor="fileInput" className={styles.fileLabel}>
          📂 {archivoNombre ? archivoNombre : "Seleccionar archivo Excel"}
        </label>

        <p className={styles.dropText}>
          O arrastrá y soltá el archivo acá
        </p>

        {filas.length > 0 && !procesando && (
          <span className={styles.filasContador}>
            {filas.length} productos cargados
          </span>
        )}
      </div>

     

      {filas.length > 0 && tieneCosto && (
        <p className={styles.notaCosto}>
          Costo tomado de la columna «{columnaCosto}» del Excel.
        </p>
      )}
      {filas.length > 0 && !tieneCosto && compararPrecios && (
        <p className={styles.notaCosto}>
          No se encontró una columna de costo en el Excel: agregá una llamada «Costo» para
          ver el margen de ganancia.
        </p>
      )}

      {/* Botones */}
      {filas.length > 0 && (
        <div className={styles.acciones}>
          <button
            onClick={handleSincronizar}
            className={styles.btnSincronizar}
            disabled={
              procesando ||
              comparando ||
              (sincronizarPreciosTN && hayDescuentosInvalidos)
            }
          >
            {procesando ? "⏳ Sincronizando..." : "🚀 Sincronizar Stock"}
          </button>
          {compararPrecios && (
            <button
              type="button"
              onClick={handleCompararPrecios}
              disabled={
                comparando ||
                procesando ||
                filas.some((f) => f.precioTNCalculando)
              }
              className={styles.btnComparar}
              title="Agrega la columna «Competencia ML» a la tabla. Solo sugiere: no cambia ningún precio."
            >
              {comparando ? "⏳ Comparando..." : "🔎 Comparar precios"}
            </button>
          )}
          <button
            onClick={handleLimpiar}
            className={styles.btnLimpiar}
            disabled={procesando}
          >
            🗑 Limpiar
          </button>
          {resumen && !procesando && (
          <button
            type="button"
            onClick={handleDescargarResultados}
            className={styles.btnDescargar}
          >
            📥 Descargar resultados
          </button>
        )}
        </div>
      )}

      {/* Promoción: descuento general. Sin % de descuento, el producto se publica solo con
          precio de lista y el precio promocional queda en blanco en Tiendanube. */}
      {filas.length > 0 && (
        <div className={styles.panelDescuento}>
          <span className={styles.panelDescuentoTitulo}>🏷 Promoción</span>
          <label className={styles.panelDescuentoCampo}>
            Descuento general
            <input
              type="number"
              min="0"
              max="99.99"
              step="any"
              placeholder="%"
              value={descuentoGeneral}
              disabled={procesando}
              className={styles.inputDescuentoGeneral}
              onChange={(e) => setDescuentoGeneral(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") aplicarDescuentoATodos();
              }}
            />
            %
          </label>
          <button
            type="button"
            className={styles.btnAplicarDescuento}
            onClick={aplicarDescuentoATodos}
            disabled={procesando || comparando || descuentoGeneral === ""}
          >
            Aplicar a todos
          </button>
          <button
            type="button"
            className={styles.btnLimpiar}
            onClick={quitarDescuentos}
            disabled={procesando || comparando || conDescuento === 0}
          >
            Quitar descuentos
          </button>
          <span className={styles.panelDescuentoNota}>
            {conDescuento > 0
              ? `${conDescuento} de ${filas.length} productos con descuento: se publican con precio promocional.`
              : "Sin descuentos: se publica solo el precio de lista y el promocional queda en blanco. Podés poner un % por producto en la columna «% Desc.»."}
          </span>
        </div>
      )}

      {hayDescuentosInvalidos && filas.length > 0 && (
        <div className={styles.avisoDescuento}>
          ⚠ Hay productos con un % de descuento que no se puede aplicar (marcados en rojo). Hay que
          corregirlos antes de sincronizar precios.
        </div>
      )}

      {compararPrecios && progresoComparacion && filas.length > 0 && (
        <div className={styles.progresoComparacion}>
          {progresoComparacion.total > 0 && comparando
            ? `${progresoComparacion.hecho} / ${progresoComparacion.total} · `
            : ""}
          {progresoComparacion.mensaje}
        </div>
      )}

      {/* Resumen final */}
      {resumen && (
        <div className={styles.resumen}>
          <span className={styles.resumenOk}>✅ {resumen.ok} actualizados</span>
          {resumen.errores > 0 && (
            <span className={styles.resumenError}>
              ❌ {resumen.errores} con error
            </span>
          )}
          <span className={styles.resumenTotal}>
            Total: {resumen.total} productos
          </span>
        </div>
      )}

      {/* Barra de progreso */}
      {procesando && filas.length > 0 && (
        <div className={styles.progressBar}>
          <div
            className={styles.progressFill}
            style={{
              width: `${((listos + conError) / filas.length) * 100}%`,
            }}
          />
          <span className={styles.progressText}>
            {listos + conError} / {filas.length}
          </span>
        </div>
      )}
      {progresoTN && activarTN && (
        <div className={styles.progresoTN}>
          <strong>Tiendanube:</strong>{" "}
          {progresoTN.estado === "finalizado"
            ? `✅ Finalizado — ${progresoTN.exitosos} correctos, ${progresoTN.errores} errores`
            : progresoTN.estado === "error"
            ? `❌ ${progresoTN.mensajeError || "Error en la sincronización"}`
            : `⏳ ${progresoTN.procesados || 0} de ${
                progresoTN.total || filas.length
              } (${progresoTN.porcentaje || 0}%)`}
        </div>
      )}
      {/* Tabla de productos */}
      {filas.length > 0 && (
        <div className={styles.tablaWrapper}>
          <table
            className={styles.tabla}
            style={anchoMinimoTabla ? { minWidth: anchoMinimoTabla } : undefined}
          >
            <colgroup>
              {anchosColumnas.map((ancho, idx) => (
                <col key={idx} style={{ width: `${ancho}%` }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th>Estado</th>
                <th>SKU</th>
                <th>Nombre</th>
                <th>Stock</th>
                <th>Stock a publicar</th>
                <th>Precio base</th>
                {tieneCosto && <th>Costo / margen</th>}
                <th>Precio TN</th>
                <th>% Desc.</th>
                {compararPrecios && <th>Competencia ML</th>}
                <th>ML</th>
                <th>TN</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((fila, i) => (
                <tr
                  key={i}
                  className={
                    fila.estado === "ok"
                      ? styles.rowOk
                      : fila.estado === "error"
                      ? styles.rowError
                      : ""
                  }
                >
                  <td className={styles.tdEstado}>
                    {estadoIcono(fila.estado)}
                  </td>
                  <td className={styles.tdSku}>{fila.sku}</td>
                  <td className={styles.tdNombre}>{fila.nombre}</td>
                  <td className={styles.tdStock}>{fila.stock}</td>
                  <td className={styles.tdStock}>
                    <input
                      type="number"
                      min="0"
                      value={fila.stockAPublicar}
                      disabled={procesando}
                      className={styles.inputStock}
                      onChange={(e) => {
                        const nuevasFilas = [...filas];
                        nuevasFilas[i].stockAPublicar = parseInt(e.target.value) || 0;
                        nuevasFilas[i].estado = "pendiente";
                        nuevasFilas[i].mensaje = "";
                        nuevasFilas[i].mlEstado = "pendiente";
                        nuevasFilas[i].mlMensaje = "";
                        nuevasFilas[i].tnEstado = "pendiente";
                        nuevasFilas[i].tnMensaje = "";
                        setFilas(nuevasFilas);
                      }}
                    />
                  </td>
                  <td className={styles.tdPrecio}>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      key={`${fila.sku}-${fila.precioBase}`}
                      defaultValue={fila.precioBase}
                      disabled={procesando || comparando}
                      className={styles.inputPrecioBase}
                      onBlur={(e) =>
                        confirmarPrecioBase(i, e.target.value, e.target)
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.target.blur();
                      }}
                    />
                  </td>
                  {tieneCosto && (
                    <td className={styles.tdCosto}>
                      {fila.costo > 0 ? (
                        <>
                          Costo: <strong>{formatoARS(fila.costo)}</strong>
                          <span className={styles.cmpEtiqueta}>
                            {promoDeFila(fila) !== null ? "Margen con promo" : "Margen actual"}
                          </span>
                          {renderMargen(calcularMargen(netoDeFila(fila), fila.costo))}
                        </>
                      ) : (
                        <span className={styles.cmpDetalle}>Sin costo</span>
                      )}
                    </td>
                  )}
                  <td className={styles.tdPrecioTN}>
                    {fila.precioTNCalculando ? (
                      "Calculando..."
                    ) : fila.precioTNError ? (
                      <span className={styles.mensajeError}>
                        {fila.precioTNError}
                      </span>
                    ) : (
                      <>
                        Lista: <strong>{formatoARS(fila.precioListaTN)}</strong>
                        <br />
                        {promoDeFila(fila) !== null ? (
                          <span className={styles.precioPromo}>
                            Promo: <strong>{formatoARS(promoDeFila(fila))}</strong>
                          </span>
                        ) : (
                          <span className={styles.sinPromo}>Sin promoción</span>
                        )}
                      </>
                    )}
                  </td>
                  <td className={styles.tdDescuento}>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="—"
                      key={`${fila.sku}-desc-${fila.descuento}`}
                      defaultValue={fila.descuento}
                      disabled={procesando || comparando}
                      className={`${styles.inputDescuento} ${
                        descuentoInvalido(fila) ? styles.inputDescuentoError : ""
                      }`}
                      title={descuentoInvalido(fila) || "% de descuento (vacío = sin promoción)"}
                      onBlur={(e) => cambiarDescuento(i, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.target.blur();
                      }}
                    />
                  </td>
                  {compararPrecios && (
                    <td className={styles.tdCompetencia}>
                      {fila.catEstado === "pendiente" && "—"}
                      {fila.catEstado === "comparando" && "⏳ Consultando..."}

                      {fila.catEstado === "ok" && (
                        <>
                          {fila.catMejor ? (
                            <div>
                              <span className={styles.cmpEtiqueta}>Más barato</span>
                              {renderOfertaML(fila.catMejor)}
                            </div>
                          ) : (
                            <span className={styles.cmpDetalle}>Sin otros vendedores</span>
                          )}

                          {fila.catComparable && (
                            <div className={styles.cmpSeparado}>
                              <span className={styles.cmpEtiqueta}>Con tus cuotas</span>
                              {renderOfertaML(fila.catComparable)}
                            </div>
                          )}

                          {fila.catParaGanar ? (
                            <div className={`${styles.cmpDetalle} ${styles.cmpSeparado}`}>
                              Precio para ganar en ML: {formatoARS(fila.catParaGanar)}
                              {fila.catStatus ? ` (${fila.catStatus})` : ""}
                            </div>
                          ) : null}

                          {fila.sugBase ? (
                            <div className={styles.cmpSeparado}>
                              <span className={styles.cmpEtiqueta}>Precio base sugerido</span>
                              <strong>{formatoARS(fila.sugBase)}</strong>{" "}
                              {fila.precioBase > 0 && fila.sugBase !== fila.precioBase && (
                                <span
                                  className={
                                    fila.sugBase < fila.precioBase
                                      ? styles.cmpBaja
                                      : styles.cmpSube
                                  }
                                >
                                  (
                                  {(
                                    ((fila.sugBase - fila.precioBase) / fila.precioBase) *
                                    100
                                  ).toFixed(1)}
                                  %)
                                </span>
                              )}
                              <div className={styles.cmpDetalle}>
                                {fila.sugBase === fila.precioBase
                                  ? "✅ Ya aplicado"
                                  : fila.sugBase < fila.precioBase
                                  ? promoDeFila(fila) !== null
                                    ? "Para que el precio promocional quede $1 abajo de la competencia"
                                    : "Para quedar $1 abajo de la competencia"
                                  : "Estás más barato: podrías subir y seguir ganando"}
                                {fila.sugTipo === "general"
                                  ? " (sin cuotas equivalentes)"
                                  : ""}
                              </div>
                              {tieneCosto &&
                                (() => {
                                  const m = calcularMargen(netoSugerido(fila), fila.costo);
                                  return m ? (
                                    <div className={styles.cmpMargen}>
                                      Margen con este precio: {renderMargen(m)}
                                      {m.monto < 0 && (
                                        <span className={styles.margenNegativo}>
                                          {" "}
                                          ⚠ por debajo del costo
                                        </span>
                                      )}
                                    </div>
                                  ) : null;
                                })()}
                              <button
                                type="button"
                                className={styles.btnUsarSugerido}
                                disabled={
                                  procesando ||
                                  comparando ||
                                  fila.sugBase === fila.precioBase
                                }
                                onClick={() => aplicarPrecioSugerido(fila.sku)}
                              >
                                Usar este precio
                              </button>
                            </div>
                          ) : fila.sugError ? (
                            <div className={styles.mensajeError}>{fila.sugError}</div>
                          ) : null}
                        </>
                      )}

                      {(fila.catEstado === "sin_catalogo" ||
                        fila.catEstado === "error") && (
                        <span className={styles.cmpDetalle}>{fila.catMensaje}</span>
                      )}
                    </td>
                  )}
                  <td
                    className={`${styles.tdMensaje} ${
                      fila.mlEstado === "ok"
                        ? styles.mensajeOk
                        : fila.mlEstado === "error"
                        ? styles.mensajeError
                        : ""
                    }`}
                  >
                    {estadoIcono(fila.mlEstado)} {fila.mlMensaje}
                  </td>

                  <td
                    className={`${styles.tdMensaje} ${
                      fila.tnEstado === "ok"
                        ? styles.mensajeOk
                        : fila.tnEstado === "error"
                        ? styles.mensajeError
                        : ""
                    }`}
                  >
                    {estadoIcono(fila.tnEstado)} {fila.tnMensaje}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default ApiIngresos;
