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

      if (!colSKU || !colStock) {
        alert(
          "No se encontraron las columnas SKU y/o Stock en el archivo. Verificá el formato."
        );
        return;
      }

      const filasParsed = data
        .filter((row) => row[colSKU] && row[colSKU].toString().trim() !== "")
        .map((row) => {
          const stock = parseInt(row[colStock]) || 0;

          return {
            sku: row[colSKU].toString().trim(),
            stock,
            stockAPublicar: Math.max(stock - 1, 0),
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

  // Envía cada SKU al endpoint uno por uno
  const handleSincronizar = async () => {
  if (filas.length === 0) return;

  if (!sincronizarML && !sincronizarTN) {
    alert("Seleccioná al menos una plataforma para sincronizar.");
    return;
  }

  setProcesando(true);
  setResumen(null);

  let ok = 0;
  let errores = 0;

  const filasActualizadas = [...filas];

  for (let i = 0; i < filasActualizadas.length; i++) {
    const fila = filasActualizadas[i];

    let mlOk = !sincronizarML;
    let tnOk = !sincronizarTN;

    let nuevaFila = {
      ...fila,
      estado: "procesando",
      mensaje: "Sincronizando...",
      mlEstado: sincronizarML ? "procesando" : "omitido",
      mlMensaje: sincronizarML ? "Sincronizando ML..." : "Omitido",
      tnEstado: sincronizarTN ? "procesando" : "omitido",
      tnMensaje: sincronizarTN ? "Sincronizando TN..." : "Omitido",
    };

    filasActualizadas[i] = nuevaFila;
    setFilas([...filasActualizadas]);

    if (sincronizarML) {
      try {
        const responseML = await fetch(`${BACKEND_URL}/meli/actualizar-stock`, {
          method: "POST",
          headers: {
            Authorization: API_TOKEN,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sku: fila.sku,
            cantidad: fila.stockAPublicar,
          }),
        });

        const dataML = await responseML.json();

        if (responseML.ok && dataML.success) {
          mlOk = true;
          nuevaFila = {
            ...nuevaFila,
            mlEstado: "ok",
            mlMensaje: dataML.mensaje || "ML actualizado correctamente",
          };
        } else {
          mlOk = false;
          nuevaFila = {
            ...nuevaFila,
            mlEstado: "error",
            mlMensaje: dataML.error || "Error ML desconocido",
          };
        }
      } catch (err) {
        mlOk = false;
        nuevaFila = {
          ...nuevaFila,
          mlEstado: "error",
          mlMensaje: "Error de conexión ML",
        };
      }

      filasActualizadas[i] = nuevaFila;
      setFilas([...filasActualizadas]);
    }

    if (sincronizarTN) {
      try {
        const responseTN = await fetch(
          `${BACKEND_URL}/tiendanube/actualizar-stock`,
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

        const dataTN = await responseTN.json();

        if (responseTN.ok && dataTN.success) {
          tnOk = true;
          nuevaFila = {
            ...nuevaFila,
            tnEstado: "ok",
            tnMensaje: dataTN.mensaje || "TN actualizado correctamente",
          };
        } else {
          tnOk = false;
          nuevaFila = {
            ...nuevaFila,
            tnEstado: "error",
            tnMensaje: dataTN.error || "Error TN desconocido",
          };
        }
      } catch (err) {
        tnOk = false;
        nuevaFila = {
          ...nuevaFila,
          tnEstado: "error",
          tnMensaje: "Error de conexión TN",
        };
      }

      filasActualizadas[i] = nuevaFila;
      setFilas([...filasActualizadas]);
    }

    const filaOk = mlOk && tnOk;

    filasActualizadas[i] = {
      ...nuevaFila,
      estado: filaOk ? "ok" : "error",
      mensaje: filaOk
        ? "Sincronización completada"
        : "Revisar resultado ML/TN",
    };

    if (filaOk) ok++;
    else errores++;

    setFilas([...filasActualizadas]);

    await new Promise((r) => setTimeout(r, 300));
  }

  setResumen({ ok, errores, total: filasActualizadas.length });
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
                <th>ML</th>
                <th>TN</th>
                <th>Detalle</th>
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

                  <td
                    className={`${styles.tdMensaje} ${
                      fila.estado === "ok"
                        ? styles.mensajeOk
                        : fila.estado === "error"
                        ? styles.mensajeError
                        : ""
                    }`}
                  >
                    {fila.mensaje}
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
