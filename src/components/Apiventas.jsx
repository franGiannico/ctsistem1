// src/components/Apiventas.jsx
import React, { useState, useEffect } from "react";
import styles from './Apiventas.module.css';
import MeliAuthButton from './MeliAuthButton';


function Apiventas() {
  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

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

  useEffect(() => {
    if (activeTab === 'listado') {
      cargarVentasDesdeServidor();
      obtenerHoraLimiteDesdeBackend();
    }
  }, [activeTab]);

  // Cargar ventas internas
  const cargarVentasDesdeServidor = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/apiventas/cargar-ventas`);
      const data = await response.json();
      setVentas(data);
    } catch (error) {
      console.error("Error al cargar ventas:", error);
    }
  };

  // Obtener hora límite
  const obtenerHoraLimiteDesdeBackend = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/apiventas/obtener-hora-limite`);
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
      await fetch(`${BACKEND_URL}/apiventas/actualizar-hora-limite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
    const nuevaVenta = { ...formData, completada: false, entregada: false, imagen: null };

    try {
      await fetch(`${BACKEND_URL}/apiventas/guardar-ventas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      const response = await fetch(`${BACKEND_URL}/apiventas/actualizar-venta/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
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
      const response = await fetch(`${BACKEND_URL}/apiventas/actualizar-venta/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
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

  // Borrar venta
  const borrarVenta = async (id) => {
    try {
      await fetch(`${BACKEND_URL}/apiventas/borrar-venta/${id}`, { method: "DELETE" });
      cargarVentasDesdeServidor();
    } catch (error) {
      console.error("Error al borrar venta:", error);
    }
  };

  // Borrar ventas completadas y entregadas
  const borrarVentasCompletadas = async () => {
    if (!window.confirm("¿Seguro que quieres eliminar todas las ventas completadas y entregadas?")) return;
    try {
      await fetch(`${BACKEND_URL}/apiventas/borrar-ventas-completadas`, { method: "DELETE" });
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

  // Sincronizar ventas Mercado Libre y agregar sin duplicados
  const sincronizarVentasML = async () => {
    setCargando(true);
    try {
      const response = await fetch(`${BACKEND_URL}/meli/sincronizar-ventas`, {
      cache: 'no-store'
    });
      const data = await response.json();
      const nuevasML = data.ventas || [];

      setVentas((prevVentas) => {
        const existentesNums = new Set(prevVentas.map(v => v.numeroVenta));
        const ventasUnificadas = [
          ...prevVentas,
          ...nuevasML.filter(v => !existentesNums.has(v.numeroVenta))
        ];
        return ventasUnificadas;
      });
    } catch (error) {
      console.error("Error al sincronizar ventas ML:", error);
    } finally {
      setCargando(false);
    }
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
      </div>

      {/* Cargar ventas manuales */}
      {activeTab === "cargar" && (
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
            <option value="Guardia">Guardia</option>
            <option value="Domicilio">Domicilio</option>
            <option value="Showroom">Showroom</option>
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
      )}

      {/* Listado unificado de ventas manuales + ML */}
      {activeTab === "listado" && (
        <>
          <div className={styles.contadorContainer}>
            <p className={styles.ventasTotales}>Ventas Totales: {ventas.length}</p>
            <p className={styles.ventasPreparadas}>
              Ventas Preparadas: {ventas.filter((v) => v.completada).length}
            </p>
          </div>

          <h3>Hora Límite: {horaLimite}</h3>

          <button onClick={borrarVentasCompletadas} className={styles.borrarCompletadas}>
            Borrar Ventas Completadas
          </button>
            
          <MeliAuthButton /> {/*Botón para autenticación Mercado Libre */}

          <button onClick={sincronizarVentasML} disabled={cargando} style={{ marginLeft: '10px' }}>
            {cargando ? 'Sincronizando ML...' : 'Sincronizar Ventas Mercado Libre'}
          </button>

          {Object.entries(agruparVentasPorPunto()).map(([puntoDespacho, ventasGrupo]) => (
            <div key={puntoDespacho}>
              <h3 className={styles.puntoTitulo}>
                {puntoDespacho} <span className={styles.contadorPunto}>({ventasGrupo.length})</span>
              </h3>

              <ul className={styles.lista}>
                {ventasGrupo.map((venta) => (
                  <li key={venta.numeroVenta || venta._id} className={styles.ventaItem}>
                    {venta.imagen && (
                      <img src={venta.imagen} alt={venta.nombre} className={styles.imagenProducto} />
                    )}
                    <div className={styles.ventaDetalle}>
                      <p><strong>SKU:</strong> {venta.sku || 'N/A'}</p>
                      <p><strong>Nombre:</strong> {venta.nombre}</p>
                      <p><strong>Cantidad:</strong> {venta.cantidad}</p>
                      {venta.cantidad > 1 && (
                        <span className={styles.alerta}>⚠ Ojo!</span>
                      )}
                      <p><strong>Cliente:</strong> {venta.cliente}</p>
                      <p><strong>N° Venta:</strong> {venta.numeroVenta}</p>
                    </div>
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
