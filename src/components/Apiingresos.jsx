// src/components/Apiingresos.jsx
// Nueva funcionalidad: Sincronización de stock desde Excel a Mercado Libre

import React, { useState, useRef } from "react";
import * as XLSX from "xlsx";
import styles from "./Apiingresos.module.css";

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
            nombre: colNombre ? row[colNombre] : "",
            estado: "pendiente",
            mensaje: "",
            mlEstado: "pendiente",
            mlMensaje: "",
            tnEstado: "pendiente",
            tnMensaje: "",
            precioListaTN: null,
            precioPromocionalTN: null,
            cuotasTN: null,
            precioTNError: "",
            precioTNCalculando: true,
            sugBase: null,
            sugPromo: null,
            sugLista: null,
            sugCuotas: null,
            sugTipo: "",
            sugError: "",
            catEstado: "pendiente",
            catMensaje: "",
            catMejor: null,
            catComparable: null,
            catParaGanar: null,
            catStatus: "",
          };
        });

      setFilas(filasParsed);
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
            precioPromocionalTN: resultado.precioPromocional,
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
            precioPromocionalTN: r.precioPromocional,
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
              precioPromocionalTN: f.sugPromo,
              precioListaTN: f.sugLista,
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

      if (referencia && referencia.precio > 1 && f.precioPromocionalTN) {
        objetivos.push({
          sku: f.sku,
          precioPromocionalObjetivo: referencia.precio - 1,
          tipo: referencia.tipo,
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
      try {
        const res = await fetch(
          `${BACKEND_URL}/tiendanube/calcular-precio-base-objetivo`,
          {
            method: "POST",
            headers: encabezadosJSON(),
            body: JSON.stringify({
              productos: objetivos.map((o) => ({
                sku: o.sku,
                precioPromocionalObjetivo: o.precioPromocionalObjetivo,
              })),
            }),
          }
        );
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
            sugPromo: r.precioPromocional,
            sugLista: r.precioLista,
            sugCuotas: r.cuotas,
            sugTipo: o.tipo,
            sugError: "",
          });
        });
      } catch (error) {
        console.error("Error calculando precios sugeridos:", error);
      }
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
        const mensajePrecio =
          resultadoTN.precioPromocional && resultadoTN.precioLista
            ? `Promo: $${Number(
                resultadoTN.precioPromocional
              ).toLocaleString("es-AR")} | Lista: $${Number(
                resultadoTN.precioLista
              ).toLocaleString("es-AR")}`
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
    { wch: 22 }, // Competencia ML (más barato)
    { wch: 18 }, // Competencia ML: envío gratis
    { wch: 22 }, // Competencia ML: cuotas sin interés
    { wch: 22 }, // Competencia ML (con tus cuotas)
    { wch: 18 }, // Precio base sugerido
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

  return (
    <div className={styles.container}>
      <h2 className={styles.title}>Sincronización de Stock → Mercado Libre</h2>
      <p className={styles.subtitle}>
        Cargá el reporte de stock en Excel y actualizá todas las publicaciones
        de ML automáticamente.
      </p>
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

     

      {/* Botones */}
      {filas.length > 0 && (
        <div className={styles.acciones}>
          <button
            onClick={handleSincronizar}
            className={styles.btnSincronizar}
            disabled={procesando || comparando}
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
          <table className={`${styles.tabla} ${compararPrecios ? styles.tablaComp : ""}`}>
            <thead>
              <tr>
                <th>Estado</th>
                <th>SKU</th>
                <th>Nombre</th>
                <th>Stock</th>
                <th>Stock a publicar</th>
                <th>Precio base</th>
                <th>Precio TN</th>
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
                  <td className={styles.tdPrecioTN}>
                    {fila.precioTNCalculando ? (
                      "Calculando..."
                    ) : fila.precioTNError ? (
                      <span className={styles.mensajeError}>
                        {fila.precioTNError}
                      </span>
                    ) : (
                      <>
                        Promo:{" "}
                        {Number(fila.precioPromocionalTN || 0).toLocaleString(
                          "es-AR",
                          { style: "currency", currency: "ARS", maximumFractionDigits: 0 }
                        )}
                        <br />
                        Lista:{" "}
                        {Number(fila.precioListaTN || 0).toLocaleString(
                          "es-AR",
                          { style: "currency", currency: "ARS", maximumFractionDigits: 0 }
                        )}
                      </>
                    )}
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
                                  ? "Para quedar $1 abajo de la competencia"
                                  : "Estás más barato: podrías subir y seguir ganando"}
                                {fila.sugTipo === "general"
                                  ? " (sin cuotas equivalentes)"
                                  : ""}
                              </div>
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
