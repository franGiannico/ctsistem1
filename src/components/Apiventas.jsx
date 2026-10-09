// src/components/Apiventas.jsx
import React, { useState, useEffect, useRef, useMemo } from "react";
import { Link } from "react-router-dom";
import styles from './Apiventas.module.css';
import MeliAuthButton from './MeliAuthButton';
import TiendanubeAuthButton from './TiendanubeAuthButton';
import jsPDF from 'jspdf';
import logoImage from '../assets/logo.png';
import { Html5QrcodeScanner } from "html5-qrcode";
import { esComprobanteDeVenta, parsearComprobanteVenta } from "../utils/comprobanteVenta";
import { extraerTextoPdf } from "../utils/leerPdf";

// Opciones de punto de despacho, compartidas entre el alta manual y la
// vista previa del pedido interno pegado (ver parsearPedidoInterno).
const PUNTOS_DESPACHO = [
  "Llevar al Expreso",
  "Retira el Expreso",
  "Punto de Despacho",
  "Flex",
  "A coordinar",
  "Guardia",
  "Domicilio",
  "Showroom",
  "Enviar a Savio",
];

function Apiventas() {
  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;
  const API_TOKEN = import.meta.env.VITE_API_TOKEN || 'ctsistem-token-2024-seguro-123';

  const [ventaEscaneada, setVentaEscaneada] = useState(null);
  const [mostrarConfirmacionEscaneo, setMostrarConfirmacionEscaneo] = useState(false);

  const [mostrarScanner, setMostrarScanner] = useState(false);
  const [scannerActivo, setScannerActivo] = useState(false);

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
  const [activeTab, setActiveTab] = useState("listado"); // 'cargar' o 'listado' (arranca en "Ver Ventas")
  const [sincronizandoML, setSincronizandoML] = useState(false);
  const [sincronizandoTN, setSincronizandoTN] = useState(false);
  const sincronizando = sincronizandoML || sincronizandoTN;
  const [mostrarConfig, setMostrarConfig] = useState(false);
  const [ventasConNotaAbierta, setVentasConNotaAbierta] = useState(new Set()); // IDs de ventas con input de nota abierto
  const [notasTemporales, setNotasTemporales] = useState({}); // Notas temporales mientras se editan

  // 🆕 Pedido interno pegado (texto que copia la otra app de ventas de Coniferal)
  const [textoPedidoInterno, setTextoPedidoInterno] = useState("");
  const [productosPedidoInterno, setProductosPedidoInterno] = useState([]);
  const [pedidoParseError, setPedidoParseError] = useState("");
  const [guardandoPedidoInterno, setGuardandoPedidoInterno] = useState(false);
  const [leyendoPdf, setLeyendoPdf] = useState(false);
  const [arrastrandoPdf, setArrastrandoPdf] = useState(false);

  // 🆕 Estado para controlar qué categorías están expandidas (muestran completadas)
  const [categoriasExpandidas, setCategoriasExpandidas] = useState(new Set());
  const [mostrarTodas, setMostrarTodas] = useState(false);

  // Toggle para una categoría individual
  const toggleCategoria = (puntoDespacho) => {
    const nuevoSet = new Set(categoriasExpandidas);
    if (nuevoSet.has(puntoDespacho)) {
      nuevoSet.delete(puntoDespacho);
    } else {
      nuevoSet.add(puntoDespacho);
    }
    setCategoriasExpandidas(nuevoSet);
  };

  // Toggle global para mostrar/ocultar todas
  const toggleMostrarTodas = () => {
    if (mostrarTodas) {
      // Si estaba mostrando todas, colapsar todo (limpiar set)
      setCategoriasExpandidas(new Set());
      setMostrarTodas(false);
    } else {
      // Si estaba oculto, expandir todas las categorías que existen
      // Usamos las categorías ya agrupadas (no el puntoDespacho crudo) para que
      // esto incluya también subgrupos como "Tiendanube - Envío Flex".
      const todasLasCategorias = new Set(Object.keys(agruparVentasPorPunto()));
      setCategoriasExpandidas(todasLasCategorias);
      setMostrarTodas(true);
    }
  };

  useEffect(() => {
    if (activeTab === 'listado') {
      cargarVentasDesdeServidor();
    }
  }, [activeTab]);

  // 🔄 Auto-sincronización: se ejecuta una sola vez al montar el componente
  // (primera entrada a la página, F5 o "Actualizar" del navegador), sin importar
  // en qué pestaña se esté. Sincroniza Mercado Libre y Tiendanube en paralelo.
  useEffect(() => {
    sincronizarVentasML();
    sincronizarTiendanube();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // 🆕 Pedido interno pegado: parsea el texto que copia la otra app de ventas
  // de Coniferal (resumen de "Nuevo pedido interno") y devuelve los datos
  // necesarios para precargar una venta por cada producto detectado.
  //
  // Formato esperado (puede variar de a poco, por eso todo es tolerante a
  // que falte algún dato):
  //   Empleado: Apellido, Nombre (Legajo 1234)
  //   * 1 x Nombre del producto (SKU: ABC123) - $1.234,56 c/u = $1.234,56
  //   Envío: Retiro en punta de línea - Nombre del punto (Gratis)
  const parsearPedidoInterno = (texto) => {
    if (!texto || !texto.trim()) {
      return { error: "Pegá primero el texto del pedido." };
    }

    // "Empleado: Giannico, Francisco Javier (Legajo 2520)"
    const matchEmpleado = texto.match(/Empleado:\s*(.+?)\s*\(Legajo\s*(\d+)\)/i);
    const cliente = matchEmpleado ? matchEmpleado[1].trim() : "";
    const legajo = matchEmpleado ? matchEmpleado[2].trim() : "";

    // "Envío: Retiro en punta de línea - Savio (Gratis)"
    const matchEnvio = texto.match(/Env[ií]o:\s*(.+?)(?:\s*\(|$)/im);
    const envioTexto = matchEnvio ? matchEnvio[1].trim() : "";
    const matchRetiro = envioTexto.match(/Retiro en punta de l[ií]nea\s*-\s*(.+)/i);
    const puntoRetiro = matchRetiro ? matchRetiro[1].trim() : "";

    // Líneas de producto: "* 1 x Producto (SKU: ABC123) - $1.234,56 c/u = ..."
    // El "(SKU: ...)" es opcional por si la otra app todavía no lo incluye.
    const lineasProducto = texto.match(/^\*\s*\d+\s*x\s*.+$/gim) || [];
    const productos = lineasProducto
      .map((linea) => {
        const matchLinea = linea.match(/^\*\s*(\d+)\s*x\s*(.+?)(?:\s*\(SKU:\s*([^)]+)\))?\s*-\s*\$/i);
        if (!matchLinea) return null;
        return {
          cantidad: parseInt(matchLinea[1], 10) || 1,
          nombre: (matchLinea[2] || "").trim(),
          sku: (matchLinea[3] || "").trim(),
        };
      })
      .filter(Boolean);

    if (productos.length === 0) {
      return { error: 'No se detectó ningún producto en el texto pegado. Revisá que tenga el formato de siempre (líneas que empiezan con "*").' };
    }

    return { cliente, legajo, envioTexto, puntoRetiro, productos };
  };

  // Analiza el texto pegado y arma la vista previa editable
  const analizarPedidoInternoTexto = (texto) => {
    const resultado = parsearPedidoInterno(texto);
    if (resultado.error) {
      setPedidoParseError(resultado.error);
      setProductosPedidoInterno([]);
      return;
    }

    setPedidoParseError("");

    const ahora = new Date();
    const timestamp = ahora.toISOString().replace(/[-:T]/g, "").slice(0, 14); // YYYYMMDDHHmmss
    const baseNumeroVenta = `INT-${resultado.legajo || "SN"}-${timestamp}`;
    const notaSugerida = resultado.puntoRetiro ? `Retira en ${resultado.puntoRetiro}` : "";

    const filas = resultado.productos.map((p, idx) => ({
      numeroVenta: `${baseNumeroVenta}-${idx + 1}`,
      sku: p.sku,
      nombre: p.nombre,
      cantidad: p.cantidad,
      cliente: resultado.cliente,
      puntoDespacho: "Punto de Despacho",
      nota: notaSugerida,
    }));

    setProductosPedidoInterno(filas);
  };

  // Comprobante de venta del sistema de stock ("Detalle de venta"): arma una fila
  // por producto. Se ignora el membrete (dirección, teléfono, CUIT, etc.).
  const analizarComprobanteVenta = (texto) => {
    const r = parsearComprobanteVenta(texto);
    if (r.error) {
      setPedidoParseError(r.error);
      setProductosPedidoInterno([]);
      return;
    }

    setPedidoParseError("");

    const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const baseNumeroVenta = `CV-${r.nro || timestamp}`;
    const partesNota = [];
    if (r.sucursal) partesNota.push(`Retira en ${r.sucursal}`);
    if (r.nro) partesNota.push(`comp. ${r.nro}`);
    const notaSugerida = partesNota.join(" - ");
    // Venta de mostrador: se retira en persona (Guardia). Otros tipos: se elige a mano.
    const puntoDespacho = /mostrador/i.test(r.tipoVenta) ? "Guardia" : "Punto de Despacho";

    setProductosPedidoInterno(
      r.productos.map((p, idx) => ({
        numeroVenta: `${baseNumeroVenta}-${idx + 1}`,
        sku: p.sku,
        nombre: p.nombre,
        cantidad: p.cantidad,
        cliente: r.cliente,
        puntoDespacho,
        nota: notaSugerida,
      }))
    );
  };

  // Analiza un texto (pegado o extraído de un PDF): comprobante de venta o pedido interno
  const analizarTexto = (texto) => {
    if (esComprobanteDeVenta(texto)) {
      analizarComprobanteVenta(texto);
    } else {
      analizarPedidoInternoTexto(texto);
    }
  };

  const handleAnalizarPedido = () => analizarTexto(textoPedidoInterno);

  // Lee un PDF soltado o elegido (comprobante de venta) y lo analiza
  const procesarArchivoPdf = async (archivo) => {
    if (!archivo) return;
    if (archivo.type !== "application/pdf" && !/\.pdf$/i.test(archivo.name)) {
      setPedidoParseError("El archivo tiene que ser un PDF.");
      return;
    }
    setLeyendoPdf(true);
    setPedidoParseError("");
    try {
      const texto = await extraerTextoPdf(archivo);
      setTextoPedidoInterno(texto);
      analizarTexto(texto);
    } catch (error) {
      console.error("Error leyendo el PDF:", error);
      setPedidoParseError("No se pudo leer el PDF. Probá copiar y pegar su texto en el cuadro.");
    } finally {
      setLeyendoPdf(false);
    }
  };

  // Edita un campo de una fila detectada antes de confirmar la carga
  const handleEditarProductoPedido = (index, campo, valor) => {
    setProductosPedidoInterno((prev) =>
      prev.map((p, i) => (i === index ? { ...p, [campo]: valor } : p))
    );
  };

  // Quita una fila detectada por error antes de confirmar la carga
  const handleQuitarProductoPedido = (index) => {
    setProductosPedidoInterno((prev) => prev.filter((_, i) => i !== index));
  };

  // Cancela el pedido pegado y limpia todo
  const handleCancelarPedidoInterno = () => {
    setTextoPedidoInterno("");
    setProductosPedidoInterno([]);
    setPedidoParseError("");
  };

  // Confirma la carga: guarda una venta por cada producto de la vista previa
  const handleConfirmarPedidoInterno = async () => {
    const faltaAlgo = productosPedidoInterno.some(
      (p) => !p.sku.trim() || !p.nombre.trim() || !p.cliente.trim() || !p.cantidad || !p.puntoDespacho
    );
    if (faltaAlgo) {
      setPedidoParseError("Completá SKU, producto, cliente y punto de despacho en todos los productos antes de cargar.");
      return;
    }

    setGuardandoPedidoInterno(true);
    setPedidoParseError("");
    try {
      for (const p of productosPedidoInterno) {
        await authenticatedFetch(`${BACKEND_URL}/apiventas/guardar-ventas`, {
          method: "POST",
          body: JSON.stringify({
            sku: p.sku.trim(),
            nombre: p.nombre.trim(),
            cantidad: Number(p.cantidad),
            numeroVenta: p.numeroVenta,
            cliente: p.cliente.trim(),
            puntoDespacho: p.puntoDespacho,
            nota: p.nota?.trim() || "",
          }),
        });
      }
      const cantidadCargada = productosPedidoInterno.length;
      handleCancelarPedidoInterno();
      cargarVentasDesdeServidor();
      alert(`Se ${cantidadCargada === 1 ? "cargó" : "cargaron"} ${cantidadCargada} venta${cantidadCargada === 1 ? "" : "s"} correctamente.`);
    } catch (error) {
      console.error("Error al cargar el pedido interno:", error);
      setPedidoParseError('Hubo un error al cargar alguno de los productos. Revisá "Ver Ventas" antes de reintentar, puede que algunos ya se hayan cargado.');
    } finally {
      setGuardandoPedidoInterno(false);
    }
  };

  // Si una acción sobre una venta falla (ej. la venta ya no existe porque cambió
  // el listado), recargamos para no seguir trabajando sobre datos viejos y avisamos
  // en vez de fallar en silencio.
  const avisarErrorGuardado = (mensaje) => {
    cargarVentasDesdeServidor();
    alert(`${mensaje} Se recargó el listado: probá de nuevo.`);
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
      avisarErrorGuardado("No se pudo marcar la venta como preparada.");
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
      avisarErrorGuardado("No se pudo marcar la venta como despachada.");
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
      avisarErrorGuardado("No se pudo guardar la nota.");
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

    // Tipo de Envío (ML o Tiendanube)
    if ((venta.esML || venta.esTiendanube) && venta.tipoEnvio) {
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

  // Identifica si una venta es de Tiendanube (cualquier forma en que venga marcada)
  const esVentaTiendanube = (venta) =>
    venta.esTiendanube === true ||
    venta.origen === "tiendanube" ||
    venta.origen === "Tiendanube" ||
    venta.plataforma === "tiendanube" ||
    venta.fuente === "tiendanube";

  // Identifica las ventas de Tiendanube con envío "Flex" casero (el que armamos
  // nosotros mismos como opción de envío en TN, sin logística propia de TN).
  // Se usa tanto para agruparlas aparte como para mostrarles teléfono/domicilio.
  const esVentaFlexTN = (venta) =>
    esVentaTiendanube(venta) &&
    String(venta.tipoEnvio || "").toLowerCase().includes("flex");

  // Formatea la hora límite de despacho que informa Mercado Libre.
  // Si es hoy, muestra solo "HH:mm"; si es otro día, agrega "DD/MM".
  const formatearHoraLimite = (fecha) => {
    if (!fecha || isNaN(fecha.getTime())) return "";
    return fecha.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
  };

  // Hora límite más urgente entre las ventas de ML cargadas, calculada
  // automáticamente a partir del dato que informa Mercado Libre por cada
  // venta (ya no se carga a mano). Se muestra sin importar si la venta ya
  // fue tildada como "Preparada" o "Entregada": el cartel tiene que seguir
  // arriba hasta que la venta realmente desaparezca del listado.
  const horaLimiteMasUrgente = useMemo(() => {
    const fechas = ventas
      .filter((v) => v.esML && v.horaLimiteDespacho)
      .map((v) => new Date(v.horaLimiteDespacho))
      .filter((f) => !isNaN(f.getTime()));
    if (fechas.length === 0) return null;
    return fechas.reduce((masUrgente, f) => (f < masUrgente ? f : masUrgente), fechas[0]);
  }, [ventas]);

  // Función para agrupar ventas por punto de despacho
  const agruparVentasPorPunto = () => {
    const grupos = {};

    ventas.forEach((venta) => {
      const categoria = esVentaFlexTN(venta)
        ? "Tiendanube - Envío Flex"
        : esVentaTiendanube(venta)
        ? "Ventas Tiendanube"
        : venta.puntoDespacho || "Punto de Despacho";

      if (!grupos[categoria]) grupos[categoria] = [];

      grupos[categoria].push({
        ...venta,
        puntoDespacho: categoria
      });
    });

    return grupos;
  };
  // Sincronizar ventas Mercado Libre y reemplazar el listado completo
  const sincronizarVentasML = async () => {
    setSincronizandoML(true);
    try {
      const response = await authenticatedFetch(`${BACKEND_URL}/meli/sincronizar-ventas`, {
        cache: 'no-store'
      });
      const data = await response.json();

      if (data.sincronizando) {
        // Si está sincronizando, esperar (de verdad) a que termine antes de bajar el indicador
        await verificarEstadoSincronizacion();
      } else if (data.ventas) {
        // Si devuelve ventas directamente (caso legacy)
        setVentas(data.ventas);
      }
    } catch (error) {
      console.error("Error al sincronizar ventas ML:", error);
    } finally {
      setSincronizandoML(false);
    }
  };

  // Sincronizar ventas Tiendanube
  const sincronizarTiendanube = async () => {
    setSincronizandoTN(true);
    try {
      const response = await authenticatedFetch(`${BACKEND_URL}/tiendanube/sincronizar-ventas`);
      const data = await response.json();
      console.log('Resultado Sync TN:', data);

      // Esperar brevemente y recargar (esperamos de verdad para que el indicador
      // de carga refleje el tiempo real de la sincronización)
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await cargarVentasDesdeServidor();
    } catch (error) {
      console.error("Error al sincronizar ventas Tiendanube:", error);
    } finally {
      setSincronizandoTN(false);
    }
  };

  // Verificar estado de sincronización (devuelve una Promise que se resuelve
  // recién cuando la sincronización de ML terminó de verdad)
  const verificarEstadoSincronizacion = async () => {
    console.log("🔄 Iniciando verificación de estado de sincronización...");
    const maxIntentos = 30; // 30 intentos = ~1 minuto
    const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    for (let intentos = 0; intentos < maxIntentos; intentos++) {
      try {
        const response = await authenticatedFetch(`${BACKEND_URL}/meli/estado-sincronizacion`);
        const data = await response.json();

        if (!data.sincronizando && data.ultimaSincronizacion) {
          // Sincronización completada, recargar ventas
          console.log("✅ Sincronización completada:", data.ultimaSincronizacion.mensaje);
          await cargarVentasDesdeServidor();
          return;
        }
      } catch (error) {
        console.error("Error verificando estado:", error);
        await cargarVentasDesdeServidor();
        return;
      }

      await dormir(2000); // Verificar cada 2 segundos
    }

    console.log("⏰ Timeout esperando sincronización");
    await cargarVentasDesdeServidor(); // Recargar de todas formas
  };


  //Función para chequear ventas con el código QR

    const buscarVentaPorCodigo = (codigoEscaneado) => {
    const codigo = String(codigoEscaneado).trim();

    return ventas.find((venta) => {
      const numeroVenta = String(venta.numeroVenta || "");
      const packId = String(venta.packId || "");
      const tracking = String(venta.codigoSeguimiento || "");

      const partesNumeroVenta = numeroVenta.split("-");
      const partesTracking = tracking.match(/\d+/g) || [];

      return (
        numeroVenta === codigo ||
        packId === codigo ||
        partesNumeroVenta.includes(codigo) ||
        tracking === codigo ||
        partesTracking.includes(codigo)
      );
    });
  };

    const onScanSuccess = (decodedText) => {
      let codigo = decodedText;

      try {
        // Si el QR viene en formato JSON
        const parsed = JSON.parse(decodedText);

        if (parsed.id) {
          codigo = parsed.id;
        }
      } catch (e) {
        // Si no es JSON, usar texto normal
        codigo = decodedText;
      }

      console.log("Código leído:", codigo);

      const ventaEncontrada = buscarVentaPorCodigo(codigo);

      if (!ventaEncontrada) {
        alert(`No se encontró ninguna venta con el código: ${codigo}`);
        return;
      }

      setVentaEscaneada(ventaEncontrada);
      setMostrarConfirmacionEscaneo(true);
    };

    const confirmarDespachoEscaneado = async (venta) => {
      await marcarEntregada(venta._id, venta.entregada);

      setMostrarConfirmacionEscaneo(false);
      setVentaEscaneada(null);

      alert(`Venta ${venta.numeroVenta} despachada correctamente.`);

      setTimeout(() => {
      setMostrarScanner(true);
      }, 300);
    };

    useEffect(() => {
      if (!mostrarScanner) return;

      const scanner = new Html5QrcodeScanner(
        "reader",
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          rememberLastUsedCamera: true,
        },
        false
      );

      scanner.render(
        (decodedText) => {
          if (scannerActivo) return;

          setScannerActivo(true);
          
          onScanSuccess(decodedText);

          setTimeout(() => {
            scanner.clear().catch((error) => {
              console.error("Error cerrando scanner:", error);
            });

            setMostrarScanner(false);
          }, 300);

          setTimeout(() => {
            setScannerActivo(false);
          }, 1000);
        },
        (error) => {
          // No hacemos nada: esto se dispara muchas veces mientras busca QR
        }
      );

      return () => {
        scanner.clear().catch(() => {});
      };
    }, [mostrarScanner, scannerActivo]);

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
          {/* 🆕 Pegar pedido interno: carga automática desde el texto que copia
              la otra app de ventas de Coniferal */}
          <div
            className={`${styles.pedidoInternoWrapper} ${arrastrandoPdf ? styles.pdfArrastrando : ""}`}
            onDragOver={(e) => {
              if (e.dataTransfer?.types?.includes("Files")) {
                e.preventDefault();
                setArrastrandoPdf(true);
              }
            }}
            onDragLeave={() => setArrastrandoPdf(false)}
            onDrop={(e) => {
              setArrastrandoPdf(false);
              const archivo = e.dataTransfer?.files?.[0];
              if (archivo) {
                e.preventDefault();
                procesarArchivoPdf(archivo);
              }
            }}
          >
            <h3>Cargar desde pedido interno o comprobante de venta</h3>
            <p className={styles.pedidoInternoAyuda}>
              Pegá acá el texto del pedido interno o del comprobante de venta (se analiza solo al pegar),
              o soltá el PDF del comprobante sobre este cuadro.
            </p>
            <textarea
              value={textoPedidoInterno}
              onChange={(e) => setTextoPedidoInterno(e.target.value)}
              onPaste={(e) => {
                const campo = e.target;
                setTimeout(() => {
                  if (campo.value && campo.value.trim().length > 30) analizarTexto(campo.value);
                }, 0);
              }}
              placeholder="Pegá acá el texto del pedido o del comprobante..."
              className={styles.textareaPedido}
              rows={8}
            />
            <button type="button" onClick={handleAnalizarPedido} className={styles.analizarPedidoBtn}>
              Analizar pedido
            </button>
            <label className={styles.subirPdfLabel}>
              {leyendoPdf ? "Leyendo PDF..." : "📄 Subir PDF"}
              <input
                type="file"
                accept="application/pdf,.pdf"
                style={{ display: "none" }}
                disabled={leyendoPdf}
                onChange={(e) => {
                  procesarArchivoPdf(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>

            {pedidoParseError && <p className={styles.pedidoError}>{pedidoParseError}</p>}

            {productosPedidoInterno.length > 0 && (
              <div className={styles.previewPedido}>
                <p className={styles.previewPedidoTitulo}>
                  Se detectaron {productosPedidoInterno.length} producto(s). Revisá y completá antes de confirmar:
                </p>

                {productosPedidoInterno.map((p, idx) => (
                  <div key={idx} className={styles.filaPedidoProducto}>
                    <input
                      type="text"
                      value={p.sku}
                      onChange={(e) => handleEditarProductoPedido(idx, "sku", e.target.value)}
                      placeholder="SKU"
                    />
                    <input
                      type="text"
                      value={p.nombre}
                      onChange={(e) => handleEditarProductoPedido(idx, "nombre", e.target.value)}
                      placeholder="Producto"
                    />
                    <input
                      type="number"
                      min="1"
                      value={p.cantidad}
                      onChange={(e) => handleEditarProductoPedido(idx, "cantidad", e.target.value)}
                    />
                    <input
                      type="text"
                      value={p.cliente}
                      onChange={(e) => handleEditarProductoPedido(idx, "cliente", e.target.value)}
                      placeholder="Cliente"
                    />
                    <select
                      value={p.puntoDespacho}
                      onChange={(e) => handleEditarProductoPedido(idx, "puntoDespacho", e.target.value)}
                    >
                      {PUNTOS_DESPACHO.map((opcion) => (
                        <option key={opcion} value={opcion}>{opcion}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={p.nota}
                      onChange={(e) => handleEditarProductoPedido(idx, "nota", e.target.value)}
                      placeholder="Nota (opcional)"
                    />
                    <button
                      type="button"
                      onClick={() => handleQuitarProductoPedido(idx)}
                      className={styles.quitarProductoPedidoBtn}
                      title="Quitar este producto"
                    >
                      ✕
                    </button>
                  </div>
                ))}

                <div className={styles.previewPedidoAcciones}>
                  <button
                    type="button"
                    onClick={handleConfirmarPedidoInterno}
                    disabled={guardandoPedidoInterno}
                    className={styles.confirmarPedidoBtn}
                  >
                    {guardandoPedidoInterno
                      ? "Cargando..."
                      : `Cargar ${productosPedidoInterno.length} venta${productosPedidoInterno.length === 1 ? "" : "s"}`}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelarPedidoInterno}
                    disabled={guardandoPedidoInterno}
                    className={styles.cancelarPedidoBtn}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>

          <hr className={styles.separadorCargar} />

          <form onSubmit={handleSubmit} className={styles.form}>
            <input type="text" name="sku" value={formData.sku} onChange={handleInputChange} placeholder="SKU" required />
            <input type="text" name="nombre" value={formData.nombre} onChange={handleInputChange} placeholder="Producto (color/talle opcional)" required />
            <input type="number" name="cantidad" value={formData.cantidad} onChange={handleInputChange} min="1" required />
            <input type="number" name="numeroVenta" value={formData.numeroVenta} onChange={handleInputChange} placeholder="N° Venta" required />
            <input type="text" name="cliente" value={formData.cliente} onChange={handleInputChange} placeholder="Cliente" required />

            <select name="puntoDespacho" value={formData.puntoDespacho} onChange={handleInputChange} required>
              {PUNTOS_DESPACHO.map((opcion) => (
                <option key={opcion} value={opcion}>{opcion}</option>
              ))}
            </select>

            <button type="submit">Agregar Venta</button>
          </form>

        </div>
      )}

      {/* Listado unificado de ventas manuales + ML */}
      {activeTab === "listado" && (
        <>
          {sincronizando && (
            <div className={styles.syncBanner}>
              <div className={styles.syncBannerTrack}>
                <div className={styles.syncBannerFill} />
              </div>
              <p className={styles.syncBannerText}>
                {sincronizandoML && sincronizandoTN
                  ? "Sincronizando ventas de Mercado Libre y Tiendanube…"
                  : sincronizandoML
                  ? "Sincronizando ventas de Mercado Libre…"
                  : "Sincronizando ventas de Tiendanube…"}
              </p>
            </div>
          )}

          <div className={styles.statsRow}>
            <div className={`${styles.statCard} ${styles.statCardTotal}`}>
              <span className={styles.statNumber}>{ventas.length}</span>
              <span className={styles.statLabel}>Totales</span>
            </div>
            <div className={`${styles.statCard} ${styles.statCardPreparadas}`}>
              <span className={styles.statNumber}>
                {ventas.filter((v) => v.completada).length}
              </span>
              <span className={styles.statLabel}>Preparadas</span>
            </div>
            <div className={`${styles.statCard} ${styles.statCardEntregadas}`}>
              <span className={styles.statNumber}>
                {ventas.filter((v) => v.entregada).length}
              </span>
              <span className={styles.statLabel}>Entregadas</span>
            </div>
            {horaLimiteMasUrgente && (
              <div className={`${styles.statCard} ${styles.statCardHora}`}>
                <span className={styles.statNumber}>{formatearHoraLimite(horaLimiteMasUrgente)}</span>
                <span className={styles.statLabel}>Hora límite</span>
              </div>
            )}
          </div>

          <div className={styles.actionsRow}>
            <button onClick={borrarVentasCompletadas} className={`${styles.borrarCompletadas} ${styles.actionButton}`}>
              Borrar Ventas Completadas
            </button>
            <button
              onClick={() => setMostrarScanner(true)}
              className={`${styles.meliSyncBtn} ${styles.actionButton}`}
            >
              Escanear paquetes
            </button>
            <button
              type="button"
              onClick={() => setMostrarConfig((valor) => !valor)}
              className={styles.configToggleBtn}
            >
              {mostrarConfig ? "✕ Cerrar configuración" : "⚙️ Configuración"}
            </button>
          </div>

          {mostrarConfig && (
            <div className={styles.configPanel}>
              <p className={styles.configPanelTitle}>Conexiones y sincronización manual</p>

              <div className={styles.configPanelRow}>
                <MeliAuthButton
                  className={`${styles.meliConnectBtn} ${styles.actionButton}`}
                  wrapperClassName={styles.actionItem}
                />
                <button
                  onClick={sincronizarVentasML}
                  disabled={sincronizandoML}
                  className={`${styles.meliSyncBtn} ${styles.actionButton}`}
                >
                  {sincronizandoML ? 'Sincronizando...' : 'Sincronizar ventas Mercado Libre'}
                </button>
              </div>

              <div className={styles.configPanelRow}>
                <TiendanubeAuthButton
                  className={`${styles.meliConnectBtn} ${styles.actionButton}`}
                  wrapperClassName={styles.actionItem}
                />
                <button
                  onClick={sincronizarTiendanube}
                  disabled={sincronizandoTN}
                  className={`${styles.meliSyncBtn} ${styles.actionButton}`}
                  style={{ background: 'linear-gradient(135deg, #2D325E, #4A5294)', color: 'white' }}
                >
                  {sincronizandoTN ? 'Sincronizando...' : 'Sincronizar Tiendanube'}
                </button>
              </div>

              <p className={styles.configPanelHint}>
                Las ventas se sincronizan solas al entrar a esta pestaña o actualizar la página.
                Usá estos botones solo para forzar una sincronización manual o para conectar
                (o reconectar) las cuentas.
              </p>
            </div>
          )}

          {/* Botón flotante para mostrar/ocultar todas */}
          <div className={styles.stickyHeader}>
            <button
              onClick={toggleMostrarTodas}
              className={styles.globalToggleBtn}
            >
              {mostrarTodas ? "Restaurar vista" : "Mostrar todas"}
            </button>
          </div>

          <div className={styles.listadoContainer}>
            {Object.entries(agruparVentasPorPunto()).map(([puntoDespacho, ventasGrupo]) => {
              // Filtrar ventas por estado
              const pendientes = ventasGrupo.filter(v => !v.completada);
              const completadas = ventasGrupo.filter(v => v.completada);

              // Determinar si la categoría está expandida
              const esExpandida = categoriasExpandidas.has(puntoDespacho);
              // Si hay ventas completadas ocultas, mostrar flecha izquierda (◀). Si está expandido, abajo (▼).
              const hayOcultas = completadas.length > 0 && !esExpandida;

              // Ventas a mostrar: siempre las pendientes, y las completadas solo si está expandido
              const ventasAMostrar = esExpandida ? ventasGrupo : pendientes;

              return (
                <div key={puntoDespacho}>
                  <h3 className={styles.puntoTitulo}>
                    <span>
                      {puntoDespacho} <span className={styles.contadorPunto}>({completadas.length} / {ventasGrupo.length})</span>
                    </span>
                    <div
                      className={styles.toggleIconWrapper}
                      onClick={() => toggleCategoria(puntoDespacho)}
                      title={esExpandida ? "Ocultar completadas" : "Mostrar completadas"}
                    >
                      {/* Solo mostrar toggle si hay completadas para ocultar/mostrar */}
                      {completadas.length > 0 && (
                        <span className={styles.toggleIcon}>
                          {esExpandida ? "▼" : "◀"}
                        </span>
                      )}
                    </div>
                  </h3>

                  <ul className={styles.lista}>
                    {ventasAMostrar.map((venta) => (
                      <li key={venta.numeroVenta || venta._id}>
                        <div className={`${styles.ventaItem} ${venta.completada ? styles.ventaItemCompletada : ''}`}>
                          {venta.imagen && (
                            <img src={venta.imagen} alt={venta.nombre} className={styles.imagenProducto} />
                          )}
                          <div className={styles.ventaDetalle}>
                            <p><strong>Nombre:</strong> {venta.nombre}</p>
                            <p><strong>SKU:</strong> {venta.sku || "Sin SKU"}</p>
                            {venta.esML && <span className={styles.etiquetaML}>ML</span>}
                            {venta.esTiendanube && <span className={styles.etiquetaTN}>TN</span>}
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
                            {(venta.esML || venta.esTiendanube) && venta.tipoEnvio && (
                              <p><strong>Tipo de Envío:</strong> {venta.tipoEnvio}</p>
                            )}
                            {esVentaFlexTN(venta) && (
                              <div className={styles.datosFlex}>
                                {venta.telefono && <p><strong>Teléfono:</strong> {venta.telefono}</p>}
                                {venta.direccion && <p><strong>Domicilio:</strong> {venta.direccion}</p>}
                                {venta.piso && <p><strong>Piso:</strong> {venta.piso}</p>}
                                {venta.barrio && <p><strong>Barrio:</strong> {venta.barrio}</p>}
                              </div>
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
                          {!venta.esTiendanube && venta.puntoDespacho !== "Punto de Despacho" && venta.puntoDespacho !== "Flex" && (
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
              );
            })}
          </div>
        </>
      )}
      {mostrarScanner && (
        <div className={styles.modalEscaneo}>
          <div className={styles.modalContenidoEscaneo}>
            <h3>Escanear paquete</h3>

            <div id="reader" className={styles.readerQr}></div>

            <button
              onClick={() => setMostrarScanner(false)}
            >
              Finalizar escaneo
            </button>
          </div>
        </div>
      )}
      {mostrarConfirmacionEscaneo && ventaEscaneada && (
      <div className={styles.modalEscaneo}>
        <div className={styles.modalContenidoEscaneo}>
            {ventaEscaneada.imagen && (
              <img
                src={ventaEscaneada.imagen}
                alt={ventaEscaneada.nombre}
                className={styles.imagenEscaneo}
              />
            )}

            <p><strong>Producto:</strong> {ventaEscaneada.nombre}</p>
            <p><strong>Cantidad:</strong> {ventaEscaneada.cantidad}</p>
            <p><strong>Cliente:</strong> {ventaEscaneada.cliente}</p>
            <p><strong>Venta:</strong> {ventaEscaneada.numeroVenta}</p>

            <button
              onClick={() => confirmarDespachoEscaneado(ventaEscaneada)}
              disabled={ventaEscaneada.entregada}
            >
              {ventaEscaneada.entregada ? "Ya fue despachado" : "Confirmar despacho"}
          </button>
            {ventaEscaneada.entregada && (
              <div className={styles.yaDespachado}>
                YA DESPACHADO
              </div>
            )}

            <button onClick={() => setMostrarConfirmacionEscaneo(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default Apiventas;
