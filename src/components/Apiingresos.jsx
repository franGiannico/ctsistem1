// src/components/Apiingresos.jsx
// Nueva funcionalidad: Sincronización de stock desde Excel a Mercado Libre

import React, { useState, useRef } from "react";
import * as XLSX from "xlsx";
import styles from "./Apiingresos.module.css";

const ApiIngresos = () => {
  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;
  const API_TOKEN =
    import.meta.env.VITE_API_TOKEN || "ctsistem-token-2024-seguro-123";

  const [filas, setFilas] = useState([]); // { sku, stock, nombre, estado }
  const [procesando, setProcesando] = useState(false);
  const [resumen, setResumen] = useState(null); // { ok, errores, total }
  const [archivoNombre, setArchivoNombre] = useState("");
  const inputRef = useRef(null);
  const [sincronizarML, setSincronizarML] = useState(true);
  const [sincronizarTN, setSincronizarTN] = useState(true);
  const [progresoTN, setProgresoTN] = useState(null);

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
          };
        });

      setFilas(filasParsed);
    };
    reader.readAsBinaryString(file);
  };

  const esperar = (milisegundos) =>
  new Promise((resolve) => setTimeout(resolve, milisegundos));

 // Sincroniza ML individualmente y Tiendanube en una sola operación masiva
const handleSincronizar = async () => {
  if (filas.length === 0) return;

  if (!sincronizarML && !sincronizarTN) {
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
    tnEstado: sincronizarTN ? "procesando" : "omitido",
    tnMensaje: sincronizarTN ? "Esperando sincronización..." : "Omitido",
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
  if (sincronizarTN) {
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
      !sincronizarTN || fila.tnEstado === "ok";

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
       
  const handleLimpiar = () => {
    setFilas([]);
    setResumen(null);
    setArchivoNombre("");
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
            checked={sincronizarTN}
            onChange={(e) => setSincronizarTN(e.target.checked)}
          />
          Sincronizar stock TN
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
            disabled={procesando}
          >
            {procesando ? "⏳ Sincronizando..." : "🚀 Sincronizar Stock"}
          </button>
          <button
            onClick={handleLimpiar}
            className={styles.btnLimpiar}
            disabled={procesando}
          >
            🗑 Limpiar
          </button>
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
      {progresoTN && sincronizarTN && (
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
          <table className={styles.tabla}>
            <thead>
              <tr>
                <th>Estado</th>
                <th>SKU</th>
                <th>Nombre</th>
                <th>Stock</th>
                <th>Stock a publicar</th>
                <th>Precio base</th>
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
                    {Number(fila.precioBase || 0).toLocaleString("es-AR", {
                      style: "currency",
                      currency: "ARS",
                      maximumFractionDigits: 2,
                    })}
                  </td>
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
