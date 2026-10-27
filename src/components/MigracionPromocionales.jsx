// src/components/MigracionPromocionales.jsx
// Herramienta para pasar los precios promocionales actuales de Tiendanube al precio de
// lista (y dejar el promocional en blanco). Se usa una sola vez, al cambiar de modelo de
// precios, y deja todo respaldado para poder revertirlo.
//
// Flujo: Analizar (no cambia nada) → revisar la lista y bajar el respaldo → probar con 1
// producto → migrar el resto. El trabajo lo hace el worker en segundo plano.

import React, { useCallback, useEffect, useState } from "react";
import * as XLSX from "xlsx";
import styles from "./MigracionPromocionales.module.css";

const ESTADOS_EN_CURSO = ["por_analizar", "analizando", "pendiente", "procesando"];

const formatoARS = (n) =>
  n === null || n === undefined || n === ""
    ? "—"
    : Number(n).toLocaleString("es-AR", {
        style: "currency",
        currency: "ARS",
        maximumFractionDigits: 0,
      });

const formatoFecha = (f) =>
  f
    ? new Date(f).toLocaleString("es-AR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

const MAX_FILAS_VISTA = 200;

const plural = (n, singular, pluralTxt) => (Number(n) === 1 ? singular : pluralTxt);

const MigracionPromocionales = ({ backendUrl, apiToken }) => {
  const [jobId, setJobId] = useState(null);
  const [reinicio, setReinicio] = useState(0); // fuerza volver a consultar el mismo trabajo
  const [job, setJob] = useState(null);
  const [items, setItems] = useState(null);
  const [historial, setHistorial] = useState([]);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [confirmando, setConfirmando] = useState(null); // "uno" | "todos" | "revertir:<id>"
  const [verTodos, setVerTodos] = useState(false);
  const [respaldoBajado, setRespaldoBajado] = useState(false);

  const pedir = useCallback(
    async (ruta, opciones = {}) => {
      const res = await fetch(`${backendUrl}/tiendanube/migracion-precios${ruta}`, {
        ...opciones,
        headers: {
          Authorization: apiToken,
          "Content-Type": "application/json",
          ...(opciones.headers || {}),
        },
      });
      let data = {};
      try {
        data = await res.json();
      } catch (e) {
        data = {};
      }
      if (!res.ok) {
        throw new Error(data.error || "No se pudo completar la operación.");
      }
      return data;
    },
    [backendUrl, apiToken]
  );

  const cargarHistorial = useCallback(async () => {
    try {
      const d = await pedir("/ultimas");
      setHistorial(d.trabajos || []);
      return d.trabajos || [];
    } catch (e) {
      return [];
    }
  }, [pedir]);

  // Al abrir la pantalla: traer el historial y retomar un trabajo en curso o un análisis
  // que había quedado esperando confirmación.
  useEffect(() => {
    let cancelado = false;
    (async () => {
      const trabajos = await cargarHistorial();
      if (cancelado) return;
      const pendiente = trabajos.find(
        (t) => ESTADOS_EN_CURSO.includes(t.estado) || t.estado === "borrador"
      );
      if (pendiente) setJobId(pendiente.id);
    })();
    return () => {
      cancelado = true;
    };
  }, [cargarHistorial]);

  // Consulta el estado del trabajo actual hasta que termina (o queda esperando confirmación)
  useEffect(() => {
    if (!jobId) return undefined;
    let cancelado = false;
    let timer = null;

    const tick = async () => {
      try {
        const d = await pedir(`/estado/${jobId}`);
        if (cancelado) return;
        setJob(d);
        if (!ESTADOS_EN_CURSO.includes(d.estado)) return;
      } catch (e) {
        if (cancelado) return;
        setError(e.message);
      }
      timer = setTimeout(tick, 2500);
    };

    tick();
    return () => {
      cancelado = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, reinicio, pedir]);

  // Cuando hay análisis listo o el trabajo terminó, traer la lista completa
  useEffect(() => {
    if (!job || !jobId) return;
    const terminado = ["borrador", "finalizado", "error"].includes(job.estado);
    if (!terminado || items !== null) return;
    (async () => {
      try {
        const d = await pedir(`/estado/${jobId}?items=1`);
        setItems(d.items || []);
      } catch (e) {
        setError(e.message);
      }
    })();
    if (job.estado !== "borrador") cargarHistorial();
  }, [job, jobId, items, pedir, cargarHistorial]);

  const empezar = (id) => {
    setError("");
    setJob(null);
    setItems(null);
    setVerTodos(false);
    setConfirmando(null);
    setJobId(id);
    setReinicio((n) => n + 1);
  };

  const analizar = async () => {
    setOcupado(true);
    setError("");
    setRespaldoBajado(false);
    try {
      const d = await pedir("/analizar", { method: "POST", body: "{}" });
      empezar(d.jobId);
    } catch (e) {
      setError(e.message);
    }
    setOcupado(false);
  };

  const confirmar = async (limite) => {
    setOcupado(true);
    setError("");
    try {
      await pedir(`/confirmar/${jobId}`, {
        method: "POST",
        body: JSON.stringify(limite ? { limite } : {}),
      });
      const id = jobId;
      empezar(id);
    } catch (e) {
      setError(e.message);
      setConfirmando(null);
    }
    setOcupado(false);
  };

  const descartar = async () => {
    setOcupado(true);
    try {
      await pedir(`/descartar/${jobId}`, { method: "POST", body: "{}" });
      setJobId(null);
      setJob(null);
      setItems(null);
      cargarHistorial();
    } catch (e) {
      setError(e.message);
    }
    setOcupado(false);
  };

  const revertir = async (id) => {
    setOcupado(true);
    setError("");
    try {
      const d = await pedir(`/revertir/${id}`, { method: "POST", body: "{}" });
      empezar(d.jobId);
    } catch (e) {
      setError(e.message);
      setConfirmando(null);
    }
    setOcupado(false);
  };

  // Respaldo en Excel: cómo estaba cada producto antes y cómo queda
  const descargarExcel = (lista, omitidas, nombreBase) => {
    const filas = (lista || []).map((i) => ({
      SKU: i.sku || "",
      Producto: i.nombre || "",
      "Precio de lista ANTES": i.antes?.price ?? "",
      "Promocional ANTES": i.antes?.promo ?? "",
      "Precio de lista DESPUÉS": i.despues?.price ?? "",
      "Promocional DESPUÉS": i.despues?.promo ?? "",
      Estado:
        i.estado === "ok" ? "Hecho" : i.estado === "error" ? "Error" : "Pendiente",
      Detalle: i.error || "",
      "ID producto": i.productId,
      "ID variante": i.variantId,
    }));

    const libro = XLSX.utils.book_new();
    const hoja = XLSX.utils.json_to_sheet(filas);
    hoja["!cols"] = [
      { wch: 18 },
      { wch: 50 },
      { wch: 20 },
      { wch: 18 },
      { wch: 22 },
      { wch: 20 },
      { wch: 12 },
      { wch: 50 },
      { wch: 14 },
      { wch: 14 },
    ];
    XLSX.utils.book_append_sheet(libro, hoja, "Cambios");

    if (omitidas && omitidas.length > 0) {
      const hojaOmitidas = XLSX.utils.json_to_sheet(
        omitidas.map((o) => ({
          SKU: o.sku || "",
          Producto: o.nombre || "",
          "Precio de lista": o.price ?? "",
          "Promocional": o.promo ?? "",
          Motivo: o.motivo || "",
        }))
      );
      hojaOmitidas["!cols"] = [{ wch: 18 }, { wch: 50 }, { wch: 16 }, { wch: 14 }, { wch: 70 }];
      XLSX.utils.book_append_sheet(libro, hojaOmitidas, "No se tocan");
    }

    const fecha = new Date().toLocaleDateString("es-AR").replaceAll("/", "-");
    XLSX.writeFile(libro, `${nombreBase}-${fecha}.xlsx`);
  };

  const descargarDeHistorial = async (t) => {
    try {
      const d = await pedir(`/estado/${t.id}?items=1`);
      descargarExcel(
        d.items,
        d.omitidas,
        t.tipo === "reversion" ? "reversion-precios-tn" : "respaldo-precios-tn"
      );
    } catch (e) {
      setError(e.message);
    }
  };

  const estado = job?.estado;
  const analizando = estado === "por_analizar" || estado === "analizando";
  const enBorrador = estado === "borrador";
  const procesando = estado === "pendiente" || estado === "procesando";
  const terminado = estado === "finalizado" || estado === "error";
  const hayTrabajoEnCurso = analizando || procesando;
  const esReversion = job?.tipo === "reversion";

  const listaVista = items ? (verTodos ? items : items.slice(0, 12)) : [];
  const listaRecortada = listaVista.slice(0, MAX_FILAS_VISTA);

  return (
    <details className={styles.contenedor}>
      <summary className={styles.resumenTitulo}>
        🔁 Pasar precios promocionales a precio de lista (herramienta de una sola vez)
      </summary>

      <div className={styles.cuerpo}>
        <p className={styles.explicacion}>
          Copia el <strong>precio promocional</strong> actual de cada producto de Tiendanube al{" "}
          <strong>precio de lista</strong> y deja el promocional en blanco. Primero se{" "}
          <strong>analiza</strong> (no cambia nada), revisás la lista, bajás el respaldo y recién
          ahí confirmás. Se puede <strong>probar con 1 producto</strong> y se puede{" "}
          <strong>revertir</strong>.
        </p>

        {error && <div className={styles.error}>❌ {error}</div>}

        {/* Sin trabajo abierto */}
        {!jobId && (
          <button className={styles.btnPrimario} onClick={analizar} disabled={ocupado}>
            🔎 Analizar mi tienda
          </button>
        )}

        {analizando && (
          <div className={styles.progresoTexto}>
            ⏳ Leyendo todos los productos de Tiendanube... puede tardar un par de minutos.
          </div>
        )}

        {/* Análisis listo: revisar y confirmar */}
        {enBorrador && job && (
          <>
            <div className={styles.resumenCaja}>
              <div>
                <strong>{job.total}</strong> {plural(job.total, "variante con precio promocional se va", "variantes con precio promocional se van")} a migrar.
              </div>
              <div className={styles.detalle}>
                {job.resumen?.sinPromocional ?? 0} ya no tienen promocional (no se tocan) ·{" "}
                {job.omitidas?.length || 0} con datos raros (no se tocan, abajo el detalle) ·{" "}
                {job.resumen?.totalVariantes ?? 0} variantes en total.
              </div>
            </div>

            {job.omitidas?.length > 0 && (
              <details className={styles.omitidas}>
                <summary>
                  ⚠ {job.omitidas.length} {plural(job.omitidas.length, "producto que NO se va", "productos que NO se van")} a tocar (revisar a mano)
                </summary>
                <ul>
                  {job.omitidas.slice(0, 100).map((o, idx) => (
                    <li key={idx}>
                      <strong>{o.sku || "Sin SKU"}</strong> — {o.nombre}: lista {formatoARS(o.price)} /
                      promo {formatoARS(o.promo)}. {o.motivo}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {items && items.length > 0 && (
              <div className={styles.tablaCaja}>
                <table className={styles.tabla}>
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Producto</th>
                      <th>Hoy: lista</th>
                      <th>Hoy: promo</th>
                      <th>Quedará: lista</th>
                      <th>Quedará: promo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listaRecortada.map((i) => (
                      <tr key={i.variantId}>
                        <td className={styles.sku}>{i.sku}</td>
                        <td className={styles.nombre}>{i.nombre}</td>
                        <td>{formatoARS(i.antes?.price)}</td>
                        <td>{formatoARS(i.antes?.promo)}</td>
                        <td className={styles.nuevo}>{formatoARS(i.despues?.price)}</td>
                        <td>en blanco</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {items.length > 12 && (
                  <button className={styles.btnLink} onClick={() => setVerTodos((v) => !v)}>
                    {verTodos
                      ? "Ver menos"
                      : `Ver más (${Math.min(items.length, MAX_FILAS_VISTA)} de ${items.length})`}
                  </button>
                )}
              </div>
            )}

            <div className={styles.acciones}>
              <button
                className={styles.btnSecundario}
                onClick={() => {
                  descargarExcel(items, job.omitidas, "respaldo-precios-tn");
                  setRespaldoBajado(true);
                }}
                disabled={!items}
              >
                📥 Descargar respaldo (Excel)
              </button>
              {!respaldoBajado && (
                <span className={styles.detalle}>Recomendado: bajalo antes de confirmar.</span>
              )}
            </div>

            {job.total > 0 && confirmando === null && (
              <div className={styles.acciones}>
                <button
                  className={styles.btnPrimario}
                  onClick={() => setConfirmando("uno")}
                  disabled={ocupado}
                >
                  🧪 Probar con 1 producto
                </button>
                <button
                  className={styles.btnPeligro}
                  onClick={() => setConfirmando("todos")}
                  disabled={ocupado}
                >
                  Migrar los {job.total} productos
                </button>
                <button className={styles.btnLink} onClick={descartar} disabled={ocupado}>
                  Descartar este análisis
                </button>
              </div>
            )}

            {job.total === 0 && (
              <div className={styles.progresoTexto}>
                ✅ No hay productos con precio promocional para migrar.{" "}
                <button className={styles.btnLink} onClick={descartar} disabled={ocupado}>
                  Cerrar
                </button>
              </div>
            )}

            {confirmando && (
              <div className={styles.confirmacion}>
                {confirmando === "uno" ? (
                  <p>
                    Se va a cambiar <strong>1 producto</strong> en Tiendanube (el primero de la
                    lista). Después podés revisarlo en la tienda y, si está bien, analizar de nuevo
                    para migrar el resto.
                  </p>
                ) : (
                  <p>
                    Se van a cambiar <strong>{job.total} variantes</strong> en Tiendanube: el precio
                    promocional pasa a ser el precio de lista y el promocional queda en blanco.
                  </p>
                )}
                <div className={styles.acciones}>
                  <button
                    className={styles.btnPeligro}
                    onClick={() => confirmar(confirmando === "uno" ? 1 : null)}
                    disabled={ocupado}
                  >
                    Sí, hacerlo
                  </button>
                  <button
                    className={styles.btnSecundario}
                    onClick={() => setConfirmando(null)}
                    disabled={ocupado}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* En proceso */}
        {procesando && job && (
          <div>
            <div className={styles.progresoTexto}>
              ⏳ {esReversion ? "Revirtiendo" : "Migrando"}: {job.procesados} de {job.total} (
              {job.porcentaje}%) — {job.exitosos} bien, {job.errores} con error
            </div>
            <div className={styles.barra}>
              <div className={styles.barraRelleno} style={{ width: `${job.porcentaje}%` }} />
            </div>
            <p className={styles.detalle}>
              Podés cerrar esta pantalla: el trabajo sigue en segundo plano.
            </p>
          </div>
        )}

        {/* Terminado */}
        {terminado && job && (
          <div>
            <div className={job.errores > 0 || estado === "error" ? styles.error : styles.ok}>
              {estado === "error" ? "⚠ Se frenó: " : "✅ Terminó: "}
              {esReversion ? "reversión" : "migración"} — {job.exitosos} {plural(job.exitosos, "producto bien", "productos bien")}
              {job.errores > 0 ? `, ${job.errores} con error` : ""}.
              {job.mensajeError ? ` ${job.mensajeError}` : ""}
            </div>

            {job.itemsConError?.length > 0 && (
              <ul className={styles.listaErrores}>
                {job.itemsConError.slice(0, 20).map((i) => (
                  <li key={i.variantId}>
                    <strong>{i.sku || i.variantId}</strong> — {i.error}
                  </li>
                ))}
              </ul>
            )}

            <div className={styles.acciones}>
              <button
                className={styles.btnSecundario}
                onClick={() =>
                  descargarExcel(
                    items,
                    job.omitidas,
                    esReversion ? "reversion-precios-tn" : "respaldo-precios-tn"
                  )
                }
                disabled={!items}
              >
                📥 Descargar detalle (Excel)
              </button>
              {!esReversion && job.exitosos > 0 && confirmando === null && (
                <button
                  className={styles.btnSecundario}
                  onClick={() => setConfirmando(`revertir:${jobId}`)}
                  disabled={ocupado}
                >
                  ↩ Revertir esta migración
                </button>
              )}
              <button
                className={styles.btnPrimario}
                onClick={() => {
                  setJobId(null);
                  setJob(null);
                  setItems(null);
                  setConfirmando(null);
                }}
              >
                Listo
              </button>
            </div>

            {confirmando === `revertir:${jobId}` && (
              <div className={styles.confirmacion}>
                <p>
                  Cada producto vuelve a su precio de lista y promocional anteriores. Si cambiaste
                  precios después de migrar, esos cambios también se pisan.
                </p>
                <div className={styles.acciones}>
                  <button
                    className={styles.btnPeligro}
                    onClick={() => revertir(jobId)}
                    disabled={ocupado}
                  >
                    Sí, revertir
                  </button>
                  <button
                    className={styles.btnSecundario}
                    onClick={() => setConfirmando(null)}
                    disabled={ocupado}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Historial */}
        {!hayTrabajoEnCurso && historial.filter((t) => t.estado !== "borrador").length > 0 && (
          <div className={styles.historial}>
            <h4>Historial</h4>
            <ul>
              {historial
                .filter((t) => t.estado !== "borrador")
                .map((t) => (
                  <li key={t.id}>
                    <span>
                      {formatoFecha(t.createdAt)} ·{" "}
                      {t.tipo === "reversion" ? "Reversión" : "Migración"} ·{" "}
                      {t.estado === "finalizado"
                        ? `${t.exitosos} bien${t.errores ? `, ${t.errores} con error` : ""}`
                        : t.estado}
                      {t.revertida ? " · (revertida)" : ""}
                    </span>
                    <span className={styles.accionesHistorial}>
                      {t.total > 0 && (
                        <button className={styles.btnLink} onClick={() => descargarDeHistorial(t)}>
                          Descargar Excel
                        </button>
                      )}
                      {t.tipo === "migracion" &&
                        t.exitosos > 0 &&
                        !t.revertida &&
                        ["finalizado", "error"].includes(t.estado) &&
                        (confirmando === `revertir:${t.id}` ? (
                          <>
                            <button
                              className={styles.btnLinkPeligro}
                              onClick={() => revertir(t.id)}
                              disabled={ocupado}
                            >
                              Confirmar reversión
                            </button>
                            <button className={styles.btnLink} onClick={() => setConfirmando(null)}>
                              Cancelar
                            </button>
                          </>
                        ) : (
                          <button
                            className={styles.btnLink}
                            onClick={() => setConfirmando(`revertir:${t.id}`)}
                          >
                            Revertir
                          </button>
                        ))}
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
};

export default MigracionPromocionales;
