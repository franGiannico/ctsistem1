// src/components/Apiventas.jsx
import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import styles from './Apiventas.module.css';
import MeliAuthButton from './MeliAuthButton';
import jsPDF from 'jspdf';
// Importar el logo desde assets
import logoImage from '../assets/logo.png';


function Apiventas() {
  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;
  const API_TOKEN = import.meta.env.VITE_API_TOKEN || 'ctsistem-token-2024-seguro-123';

  // Función helper para requests autenticados
  const authenticatedFetch = async (url, options = {}) => {
    const defaultOptions = {
      headers: {
        'Authorization': API_TOKEN,
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    };
    
    try {
      const response = await fetch(url, defaultOptions);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response;
    } catch (error) {
      console.error('Error en request autenticado:', error);
      throw error;
    }
  };

  // Estado general de ventas (internas + Mercado Libre)
  const [ventas, setVentas] = useState([]);
  const [formData, setFormData] = useState({
    sku: "",
    nombre: "",
    cantidad: 1,
    numeroVenta: "",
    cliente: "",
    puntoDespacho: "Punto de Despacho"
  });
  const [horaLimite, setHoraLimite] = useState('');
  const [horaLimiteTemporal, setHoraLimiteTemporal] = useState('');
  const [activeTab, setActiveTab] = useState("cargar"); // 'cargar' o 'listado'
  const [cargando, setCargando] = useState(false);
  const [ventasConNotaAbierta, setVentasConNotaAbierta] = useState(new Set()); // IDs de ventas con input de nota abierto
  const [notasTemporales, setNotasTemporales] = useState({}); // Notas temporales mientras se editan

  useEffect(() => {
    if (activeTab === 'listado') {
      cargarVentasDesdeServidor();
      obtenerHoraLimiteDesdeBackend();
    }
  }, [activeTab]);

  // Cargar ventas internas
  const cargarVentasDesdeServidor = async () => {
    try {
      const response = await authenticatedFetch(`${BACKEND_URL}/apiventas/cargar-ventas`);
      const data = await response.json();
      setVentas(data);
      
      // Log para verificar imágenes
      const ventasConImagen = data.filter(v => v.imagen && v.imagen.trim() !== '');
      console.log(`📊 Total ventas: ${data.length}, Con imagen: ${ventasConImagen.length}`);
      if (ventasConImagen.length > 0) {
        console.log('🖼️ Ventas con imagen:', ventasConImagen.map(v => ({ id: v.numeroVenta, imagen: v.imagen.substring(0, 50) + '...' })));
      }
    } catch (error) {
      console.error("Error al cargar ventas:", error);
    }
  };

  // Obtener hora límite
  const obtenerHoraLimiteDesdeBackend = async () => {
    try {
      const response = await authenticatedFetch(`${BACKEND_URL}/apiventas/obtener-hora-limite`);
      const data = await response.json();
      if (data.horaLimiteGeneral) {
        setHoraLimite(data.horaLimiteGeneral);
        setHoraLimiteTemporal(data.horaLimiteGeneral);
      }
    } catch (error) {
      console.error("Error al obtener hora límite:", error);
    }
  };

  // Actualizar hora límite
  const actualizarHoraLimiteEnBackend = async (hora) => {
    try {
      await authenticatedFetch(`${BACKEND_URL}/apiventas/actualizar-hora-limite`, {
        method: "POST",
        body: JSON.stringify({ horaLimite: hora })
      });
    } catch (error) {
      console.error("Error al actualizar hora límite:", error);
    }
  };

  const handleHoraLimiteInputChange = (e) => setHoraLimiteTemporal(e.target.value);
  const enviarHoraLimite = () => {
    setHoraLimite(horaLimiteTemporal);
    actualizarHoraLimiteEnBackend(horaLimiteTemporal);
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  // Guardar venta manual
  const handleSubmit = async (e) => {
    e.preventDefault();
    const nuevaVenta = { 
      ...formData, 
      completada: false, 
      entregada: false, 
      imagen: null, 
      esML: false   // 👈 fuerza a que quede como manual
    };

    try {
      await authenticatedFetch(`${BACKEND_URL}/apiventas/guardar-ventas`, {
        method: "POST",
        body: JSON.stringify(nuevaVenta)
      });
      cargarVentasDesdeServidor();
      setFormData({ sku: "", nombre: "", cantidad: 1, numeroVenta: "", cliente: "", puntoDespacho: "Punto de Despacho" });
    } catch (error) {
      console.error("Error al guardar la venta:", error);
    }
  };

  // Marcar completada o entregada
  const marcarCompletada = async (id, estadoActual) => {
    try {
      const nuevoEstado = !estadoActual;
      const response = await authenticatedFetch(`${BACKEND_URL}/apiventas/actualizar-venta/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ completada: nuevoEstado })
      });
      if (!response.ok) throw new Error(`Error HTTP: ${response.status}`);
      const data = await response.json();
      setVentas((prev) =>
        prev.map((v) => (v._id === id ? { ...v, completada: data.venta.completada } : v))
      );
    } catch (error) {
      console.error("Error al actualizar venta:", error);
    }
  };

  const marcarEntregada = async (id, estadoActual) => {
    try {
      const nuevoEstado = !estadoActual;
      const response = await authenticatedFetch(`${BACKEND_URL}/apiventas/actualizar-venta/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ entregada: nuevoEstado })
      });
      if (!response.ok) throw new Error(`Error HTTP: ${response.status}`);
      const data = await response.json();
      setVentas((prev) =>
        prev.map((v) => (v._id === id ? { ...v, entregada: data.venta.entregada } : v))
      );
    } catch (error) {
      console.error("Error al actualizar entrega:", error);
    }
  };

  // Toggle para abrir/cerrar el input de nota
  const toggleNotaInput = (ventaId, notaActual) => {
    const nuevoSet = new Set(ventasConNotaAbierta);
    if (nuevoSet.has(ventaId)) {
      nuevoSet.delete(ventaId);
    } else {
      nuevoSet.add(ventaId);
      // Inicializar la nota temporal con la nota actual si existe
      setNotasTemporales(prev => ({
        ...prev,
        [ventaId]: notaActual || ""
      }));
    }
    setVentasConNotaAbierta(nuevoSet);
  };

  // Guardar o actualizar nota
  const guardarNota = async (ventaId) => {
    const notaTexto = notasTemporales[ventaId] || "";
    
    try {
      const response = await authenticatedFetch(`${BACKEND_URL}/apiventas/actualizar-venta/${ventaId}`, {
        method: "PATCH",
        body: JSON.stringify({ nota: notaTexto.trim() })
      });
      if (!response.ok) throw new Error(`Error HTTP: ${response.status}`);
      const data = await response.json();
      
      // Actualizar la venta en el estado
      setVentas((prev) =>
        prev.map((v) => (v._id === ventaId ? { ...v, nota: data.venta.nota || "" } : v))
      );
      
      // Si la nota está vacía, cerrar el input
      if (!notaTexto.trim()) {
        const nuevoSet = new Set(ventasConNotaAbierta);
        nuevoSet.delete(ventaId);
        setVentasConNotaAbierta(nuevoSet);
      } else {
        // Cerrar el input después de guardar
        const nuevoSet = new Set(ventasConNotaAbierta);
        nuevoSet.delete(ventaId);
        setVentasConNotaAbierta(nuevoSet);
      }
      
      // Limpiar la nota temporal
      setNotasTemporales(prev => {
        const nuevo = { ...prev };
        delete nuevo[ventaId];
        return nuevo;
      });
    } catch (error) {
      console.error("Error al guardar la nota:", error);
    }
  };

  // Manejar cambio en el input de nota
  const handleNotaChange = (ventaId, valor) => {
    setNotasTemporales(prev => ({
      ...prev,
      [ventaId]: valor
    }));
  };

  // Manejar Enter en el input de nota
  const handleNotaKeyDown = (e, ventaId) => {
    if (e.key === "Enter") {
      e.preventDefault();
      guardarNota(ventaId);
    }
  };

  // Generar PDF de etiqueta para una venta
  const generarEtiquetaPDF = async (venta) => {
    // Tamaño de la etiqueta: 10x15 cm (ancho x alto)
    // En jsPDF: 1 cm = 28.346 puntos
    const ancho = 10 * 28.346; // 283.46 puntos
    const alto = 15 * 28.346;  // 425.19 puntos

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'pt',
      format: [ancho, alto]
    });

    // Configuración de fuente y márgenes
    const margin = 20;
    let yPos = margin + 15;
    const lineHeight = 18;
    const fontSize = 10;
    const fontSizeTitulo = 12;
    const fontSizeGrande = 14;

    // Agregar logo en la parte superior (si existe)
    if (logoImage) {
      try {
        // Cargar el logo y convertirlo a base64
        const response = await fetch(logoImage);
        const blob = await response.blob();
        const base64data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });

        // Obtener dimensiones de la imagen
        const img = new Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = base64data;
        });

        // Tamaño del logo: máximo 40 puntos de alto, manteniendo proporción
        const logoHeight = 40;
        const logoWidth = (img.width / img.height) * logoHeight;
        
        // Centrar el logo horizontalmente
        const logoX = (ancho - logoWidth) / 2;
        const logoY = margin;
        
        doc.addImage(base64data, 'PNG', logoX, logoY, logoWidth, logoHeight);
        yPos = margin + logoHeight + 10; // Espacio después del logo
      } catch (error) {
        console.warn('No se pudo cargar el logo. El PDF se generará sin logo:', error);
        // Continuar sin logo
      }
    }

    // Título
    doc.setFontSize(fontSizeGrande);
    doc.setFont(undefined, 'bold');
    doc.text('ETIQUETA DE VENTA', ancho / 2, yPos, { align: 'center' });
    yPos += lineHeight + 10;

    // Línea separadora
    doc.setLineWidth(0.5);
    doc.line(margin, yPos, ancho - margin, yPos);
    yPos += lineHeight;

    // Información de la venta
    doc.setFontSize(fontSize);
    doc.setFont(undefined, 'normal');

    // Número de Venta
    doc.setFont(undefined, 'bold');
    doc.text('N° Venta:', margin, yPos);
    doc.setFont(undefined, 'normal');
    doc.text(venta.numeroVenta || 'N/A', margin + 80, yPos);
    yPos += lineHeight;

    // Cliente
    doc.setFont(undefined, 'bold');
    doc.text('Cliente:', margin, yPos);
    doc.setFont(undefined, 'normal');
    const clienteTexto = venta.cliente || 'N/A';
    const clienteLines = doc.splitTextToSize(clienteTexto, ancho - margin * 2 - 80);
    doc.text(clienteLines, margin + 80, yPos);
    yPos += lineHeight * clienteLines.length;

    // SKU
    doc.setFont(undefined, 'bold');
    doc.text('SKU:', margin, yPos);
    doc.setFont(undefined, 'normal');
    doc.text(venta.sku || 'N/A', margin + 80, yPos);
    yPos += lineHeight;

    // Nombre del producto
    doc.setFont(undefined, 'bold');
    doc.text('Producto:', margin, yPos);
    doc.setFont(undefined, 'normal');
    const nombreTexto = venta.nombre || 'N/A';
    const nombreLines = doc.splitTextToSize(nombreTexto, ancho - margin * 2 - 80);
    doc.text(nombreLines, margin + 80, yPos);
    yPos += lineHeight * nombreLines.length;

    // Cantidad
    doc.setFont(undefined, 'bold');
    doc.text('Cantidad:', margin, yPos);
    doc.setFont(undefined, 'normal');
    doc.text(String(venta.cantidad || 1), margin + 80, yPos);
    yPos += lineHeight;

    // Atributos (si existen)
    if (venta.atributos && venta.atributos.length > 0) {
      doc.setFont(undefined, 'bold');
      doc.text('Atributos:', margin, yPos);
      yPos += lineHeight;
      doc.setFont(undefined, 'normal');
      venta.atributos.forEach((attr) => {
        const attrTexto = `${attr.nombre}: ${attr.valor}`;
        const attrLines = doc.splitTextToSize(attrTexto, ancho - margin * 2 - 20);
        doc.text(attrLines, margin + 10, yPos);
        yPos += lineHeight * attrLines.length;
      });
    }

    // Punto de Despacho
    doc.setFont(undefined, 'bold');
    doc.text('Punto Despacho:', margin, yPos);
    doc.setFont(undefined, 'normal');
    const puntoTexto = venta.puntoDespacho || 'N/A';
    const puntoLines = doc.splitTextToSize(puntoTexto, ancho - margin * 2 - 80);
    doc.text(puntoLines, margin + 80, yPos);
    yPos += lineHeight * puntoLines.length;

    // Tipo de Envío (si es ML)
    if (venta.esML && venta.tipoEnvio) {
      doc.setFont(undefined, 'bold');
      doc.text('Tipo Envío:', margin, yPos);
      doc.setFont(undefined, 'normal');
      doc.text(venta.tipoEnvio, margin + 80, yPos);
      yPos += lineHeight;
    }

    // Nota (si existe)
    if (venta.nota && venta.nota.trim()) {
      yPos += lineHeight;
      doc.setFont(undefined, 'bold');
      doc.text('Nota:', margin, yPos);
      yPos += lineHeight;
      doc.setFont(undefined, 'normal');
      const notaTexto = venta.nota;
      const notaLines = doc.splitTextToSize(notaTexto, ancho - margin * 2 - 20);
      doc.text(notaLines, margin + 10, yPos);
      yPos += lineHeight * notaLines.length;
    }

    // Fecha
    yPos += lineHeight;
    doc.setFontSize(fontSize - 2);
    doc.setFont(undefined, 'italic');
    const fecha = new Date().toLocaleDateString('es-AR');
    doc.text(`Fecha: ${fecha}`, margin, alto - margin);

    // Guardar el PDF
    const nombreArchivo = `Etiqueta_${venta.numeroVenta || venta._id}.pdf`;
    doc.save(nombreArchivo);
  };

  // Borrar venta
  const borrarVenta = async (id) => {
    try {
      await authenticatedFetch(`${BACKEND_URL}/apiventas/borrar-venta/${id}`, { method: "DELETE" });
      cargarVentasDesdeServidor();
    } catch (error) {
      console.error("Error al borrar venta:", error);
    }
  };

  // Borrar ventas completadas y entregadas
  const borrarVentasCompletadas = async () => {
    if (!window.confirm("¿Seguro que quieres eliminar todas las ventas que estén COMPLETADAS Y ENTREGADAS?")) return;
    try {
      await authenticatedFetch(`${BACKEND_URL}/apiventas/borrar-ventas-completadas`, { method: "DELETE" });
      cargarVentasDesdeServidor();
    } catch (error) {
      console.error("Error al borrar ventas completadas:", error);
    }
  };

  // Función para agrupar ventas por punto de despacho
  const agruparVentasPorPunto = () => {
    const grupos = {};
    ventas.forEach((venta) => {
      if (!grupos[venta.puntoDespacho]) grupos[venta.puntoDespacho] = [];
      grupos[venta.puntoDespacho].push(venta);
    });
    return grupos;
  };

  // Sincronizar ventas Mercado Libre y reemplazar el listado completo
  const sincronizarVentasML = async () => {
    setCargando(true);
    try {
      const response = await authenticatedFetch(`${BACKEND_URL}/meli/sincronizar-ventas`, {
        cache: 'no-store'
      });
      const data = await response.json();

      if (data.sincronizando) {
        // Si está sincronizando, esperar y verificar estado
        verificarEstadoSincronizacion();
      } else if (data.ventas) {
        // Si devuelve ventas directamente (caso legacy)
        setVentas(data.ventas);
      }
    } catch (error) {
      console.error("Error al sincronizar ventas ML:", error);
    } finally {
      setCargando(false);
    }
  };

  // Verificar estado de sincronización
  const verificarEstadoSincronizacion = async () => {
    console.log("🔄 Iniciando verificación de estado de sincronización...");
    const maxIntentos = 30; // 30 intentos = ~1 minuto
    let intentos = 0;

    const verificar = async () => {
      try {
        const response = await authenticatedFetch(`${BACKEND_URL}/meli/estado-sincronizacion`);
        const data = await response.json();

        if (!data.sincronizando && data.ultimaSincronizacion) {
          // Sincronización completada, recargar ventas
          console.log("✅ Sincronización completada:", data.ultimaSincronizacion.mensaje);
          cargarVentasDesdeServidor();
          return;
        }

        if (intentos < maxIntentos) {
          intentos++;
          setTimeout(verificar, 2000); // Verificar cada 2 segundos
        } else {
          console.log("⏰ Timeout esperando sincronización");
          cargarVentasDesdeServidor(); // Recargar de todas formas
        }
      } catch (error) {
        console.error("Error verificando estado:", error);
        cargarVentasDesdeServidor();
      }
    };

    verificar();
  };


  return (
    <div className={styles.container}>
      <h2>Gestión de Ventas</h2>

      {/* Pestañas: solo dos */}
      <div className={styles.tabs}>
        <button
          className={activeTab === "cargar" ? styles.activeTab : ""}
          onClick={() => setActiveTab("cargar")}
        >
          Cargar Ventas
        </button>
        <button
          className={activeTab === "listado" ? styles.activeTab : ""}
          onClick={() => setActiveTab("listado")}
        >
          Ver Ventas
        </button>
        <Link to="/facturar-ml" className={styles.facturarTabLink}>
          Facturar una venta
        </Link>
      </div>

      {/* Cargar ventas manuales */}
      {activeTab === "cargar" && (
        <div className={styles.cargarWrapper}>
          <form onSubmit={handleSubmit} className={styles.form}>
            <input type="text" name="sku" value={formData.sku} onChange={handleInputChange} placeholder="SKU" required />
            <input type="text" name="nombre" value={formData.nombre} onChange={handleInputChange} placeholder="Producto (color/talle opcional)" required />
            <input type="number" name="cantidad" value={formData.cantidad} onChange={handleInputChange} min="1" required />
            <input type="number" name="numeroVenta" value={formData.numeroVenta} onChange={handleInputChange} placeholder="N° Venta" required />
            <input type="text" name="cliente" value={formData.cliente} onChange={handleInputChange} placeholder="Cliente" required />

            <select name="puntoDespacho" value={formData.puntoDespacho} onChange={handleInputChange} required>
              <option value="Llevar al Expreso">Llevar al Expreso</option>
              <option value="Retira el Expreso">Retira el Expreso</option>
              <option value="Punto de Despacho">Punto de Despacho</option>
              <option value="Flex">Flex</option>
              <option value="A coordinar">A coordinar</option>
              <option value="Guardia">Guardia</option>
              <option value="Domicilio">Domicilio</option>
              <option value="Showroom">Showroom</option>
              <option value="Enviar a Savio">Enviar a Savio</option>
            </select>

            <button type="submit">Agregar Venta</button>

            <div className={styles.horaLimiteContainer}>
              <label className={styles.horaLimiteLabel}>Hora Límite de Entrega:</label>
              <input
                type="time"
                value={horaLimiteTemporal}
                onChange={handleHoraLimiteInputChange}
                className={styles.horaLimiteInput}
              />
              <button type="button" onClick={enviarHoraLimite} className={styles.enviarHoraLimiteBtn}>
                Set
              </button>
            </div>
          </form>

        </div>
      )}

      {/* Listado unificado de ventas manuales + ML */}
      {activeTab === "listado" && (
        <>
          <div className={styles.contadorContainer}>
            <p className={styles.ventasTotales}>Ventas Totales: {ventas.length}</p>
            <p className={styles.ventasPreparadas}>
              Ventas Preparadas: {ventas.filter((v) => v.completada).length}
            </p>
            <p className={styles.ventasEntregadas}>
              Ventas Entregadas: {ventas.filter((v) => v.entregada).length}
            </p>
          </div>

          <h3>Hora Límite: {horaLimite}</h3>

          <div className={styles.actionsRow}>
            <button onClick={borrarVentasCompletadas} className={`${styles.borrarCompletadas} ${styles.actionButton}`}>
              Borrar Ventas Completadas
            </button>

            <MeliAuthButton
              className={`${styles.meliConnectBtn} ${styles.actionButton}`}
              wrapperClassName={styles.actionItem}
            />

            <button
              onClick={sincronizarVentasML}
              disabled={cargando}
              className={`${styles.meliSyncBtn} ${styles.actionButton}`}
            >
              {cargando ? 'Sincronizando...' : 'Sincronizar ventas Mercado Libre'}
            </button>
          </div>

          {Object.entries(agruparVentasPorPunto()).map(([puntoDespacho, ventasGrupo]) => (
            <div key={puntoDespacho}>
              <h3 className={styles.puntoTitulo}>
                {puntoDespacho} <span className={styles.contadorPunto}>({ventasGrupo.length})</span>
              </h3>

              <ul className={styles.lista}>
                {ventasGrupo.map((venta) => (
                  <li key={venta.numeroVenta || venta._id}>
                    <div className={styles.ventaItem}>
                      {venta.imagen && (
                        <img src={venta.imagen} alt={venta.nombre} className={styles.imagenProducto} />
                      )}
                      <div className={styles.ventaDetalle}>
                        <p><strong>SKU:</strong> {venta.sku || 'N/A'}</p>
                        <p><strong>Nombre:</strong> {venta.nombre}</p>
                        {venta.esML && <span className={styles.etiquetaML}>ML</span>}
                        <p><strong>Cantidad:</strong> {venta.cantidad}</p>
                        {/* Mostrar atributos si existen (solo en ML) */}
                        {venta.atributos && venta.atributos.length > 0 && (
                          <div className={styles.atributos}>
                            {venta.atributos.map((attr, idx) => (
                              <p key={idx} className={styles.atributo}>
                                {attr.nombre}: {attr.valor}
                              </p>
                            ))}
                          </div>
                        )}
                        {venta.cantidad > 1 && (
                          <span className={styles.alerta}>⚠ Ojo!</span>
                        )}
                        <p><strong>Cliente:</strong> {venta.cliente}</p>
                        <p><strong>N° Venta:</strong> {venta.numeroVenta}</p>
                        {venta.esML && venta.tipoEnvio && (
                          <p><strong>Tipo de Envío:</strong> {venta.tipoEnvio}</p>
                        )}
                      </div>
                      <button
                        onClick={() => toggleNotaInput(venta._id, venta.nota)}
                        className={styles.notaBtn}
                        title="Agregar/Editar nota"
                      >
                        ✏️
                      </button>
                      {/* Botón de etiqueta solo para ventas que NO sean "Punto de Despacho" ni "Flex" */}
                      {venta.puntoDespacho !== "Punto de Despacho" && venta.puntoDespacho !== "Flex" && (
                        <button
                          onClick={async () => await generarEtiquetaPDF(venta)}
                          className={styles.etiquetaBtn}
                          title="Generar etiqueta PDF"
                        >
                          🏷️
                        </button>
                      )}
                      <button
                        onClick={() => marcarCompletada(venta._id, venta.completada)}
                        className={`${styles.checkBtn} ${venta.completada ? styles.checkBtnChecked : ''}`}
                      >
                        {venta.completada ? "✔" : "X"}
                      </button>
                      <button
                        onClick={() => marcarEntregada(venta._id, venta.entregada)}
                        className={`${styles.checkBtn} ${venta.entregada ? styles.entregadoBtnChecked : ''}`}
                      >
                        {venta.entregada ? "📦" : "🚚"}
                      </button>
                      <button onClick={() => borrarVenta(venta._id)} className={styles.checkBtn}>
                        Borrar
                      </button>
                    </div>
                    {/* Mostrar nota guardada si existe y el input no está abierto */}
                    {venta.nota && !ventasConNotaAbierta.has(venta._id) && (
                      <div className={styles.notaGuardada}>
                        <strong>Nota:</strong> {venta.nota}
                      </div>
                    )}
                    {/* Input de nota que aparece cuando se presiona el botón de lápiz */}
                    {ventasConNotaAbierta.has(venta._id) && (
                      <div className={styles.notaInputContainer}>
                        <input
                          type="text"
                          value={notasTemporales[venta._id] || ""}
                          onChange={(e) => handleNotaChange(venta._id, e.target.value)}
                          onKeyDown={(e) => handleNotaKeyDown(e, venta._id)}
                          placeholder="Escribe una nota y presiona Enter..."
                          className={styles.notaInput}
                          autoFocus
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export default Apiventas;
