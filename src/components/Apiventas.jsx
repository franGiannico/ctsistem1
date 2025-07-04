// src/components/Apiventas.jsx

import React, { useState, useEffect } from "react";
import styles from './Apiventas.module.css';
import VentasMercadoLibre from './VentasMercadoLibre';

function Apiventas() {
    // URL base de tu backend, obtenida de las variables de entorno de Vite
    // ¡Esta línea es CRUCIAL y debe estar presente!
    const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

    const [ventas, setVentas] = useState([]);
    const [formData, setFormData] = useState({
        sku: "",
        nombre: "",
        cantidad: 1,
        numeroVenta: "",
        cliente: "",
        puntoDespacho: "Punto de Despacho"
    });
    const [horaLimite, setHoraLimite] = useState(''); // Inicializar sin valor
    // Cambiamos el nombre de pestaniaActiva a activeTab para consistencia
    const [activeTab, setActiveTab] = useState("cargar"); // Usaremos 'cargar', 'listado', 'mercadolibre'
    const [horaLimiteTemporal, setHoraLimiteTemporal] = useState(''); // Inicializar sin valor

    useEffect(() => {
        // Solo cargar ventas si la pestaña activa es 'listado'
        if (activeTab === 'listado') {
            cargarVentasDesdeServidor();
        }
        // Obtener la hora límite siempre, ya que es una configuración global
        obtenerHoraLimiteDesdeBackend();
    }, [activeTab]); // Ejecutar cuando activeTab cambie

    const obtenerHoraLimiteDesdeBackend = async () => {
        try {
            // Usar la variable BACKEND_URL
            const response = await fetch(`${BACKEND_URL}/apiventas/obtener-hora-limite`);
            const data = await response.json();
            const horaLimiteDelBackend = data.horaLimiteGeneral;

            if (horaLimiteDelBackend) {
                setHoraLimite(horaLimiteDelBackend);
                setHoraLimiteTemporal(horaLimiteDelBackend);
            }
        } catch (error) {
            console.error("Error al obtener la hora límite del backend:", error);
        }
    };

    const cargarVentasDesdeServidor = async () => {
        try {
            // Usar la variable BACKEND_URL
            const response = await fetch(`${BACKEND_URL}/apiventas/cargar-ventas`);
            const data = await response.json();
            setVentas(data);
        } catch (error) {
            console.error("Error al cargar ventas:", error);
        }
    };

    const actualizarHoraLimiteEnBackend = async (hora) => {
        try {
            // Usar la variable BACKEND_URL
            await fetch(`${BACKEND_URL}/apiventas/actualizar-hora-limite`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ horaLimite: hora })
            });
        } catch (error) {
            console.error("Error al actualizar la hora límite en el backend:", error);
        }
    };

    const handleHoraLimiteInputChange = (event) => {
        setHoraLimiteTemporal(event.target.value); // Actualizar el estado temporal del input
    };

    const enviarHoraLimite = () => {
        setHoraLimite(horaLimiteTemporal); // Actualizar el estado principal que se muestra
        actualizarHoraLimiteEnBackend(horaLimiteTemporal);
    };

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData({ ...formData, [name]: value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const nuevaVenta = { ...formData, completada: false };

        try {
            // Usar la variable BACKEND_URL
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

    const marcarCompletada = async (id, estadoActual) => {
        try {
            const nuevoEstado = !estadoActual;

            // Usar la variable BACKEND_URL
            const response = await fetch(`${BACKEND_URL}/apiventas/actualizar-venta/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ completada: nuevoEstado })
            });

            if (!response.ok) {
                throw new Error(`Error HTTP: ${response.status}`);
            }

            const data = await response.json();

            setVentas((prevVentas) =>
                prevVentas.map((venta) =>
                    venta._id === id ? { ...venta, completada: data.venta.completada } : venta
                )
            );
        } catch (error) {
            console.error("Error al actualizar la venta:", error);
        }
    };

    const borrarVenta = async (id) => {
        try {
            // Usar la variable BACKEND_URL
            await fetch(`${BACKEND_URL}/apiventas/borrar-venta/${id}`, {
                method: "DELETE"
            });
            cargarVentasDesdeServidor();
        } catch (error) {
            console.error("Error al borrar la venta:", error);
        }
    };

    const marcarEntregada = async (id, estadoActual) => {
        try {
            const nuevoEstado = !estadoActual;

            // Usar la variable BACKEND_URL
            const response = await fetch(`${BACKEND_URL}/apiventas/actualizar-venta/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ entregada: nuevoEstado })
            });

            if (!response.ok) {
                throw new Error(`Error HTTP: ${response.status}`);
            }

            const data = await response.json();

            setVentas((prevVentas) =>
                prevVentas.map((venta) =>
                    venta._id === id ? { ...venta, entregada: data.venta.entregada } : venta
                )
            );
        } catch (error) {
            console.error("Error al actualizar la venta (entregada):", error);
        }
    };

    // Función para agrupar ventas por Punto de Despacho
    const agruparVentasPorPunto = () => {
        const grupos = {};
        ventas.forEach((venta) => {
            if (!grupos[venta.puntoDespacho]) {
                grupos[venta.punpDespacho] = [];
            }
            grupos[venta.puntoDespacho].push(venta);
        });
        return grupos;
    };

    const borrarVentasCompletadas = async () => {
        // NOTA: window.confirm() no es compatible con el entorno de Canvas.
        // Deberías reemplazar esto con un modal de confirmación personalizado en tu UI.
        if (!window.confirm("¿Estás seguro de que quieres eliminar todas las ventas completadas y entregadas?")) return;

        try {
            // Usar la variable BACKEND_URL
            await fetch(`${BACKEND_URL}/apiventas/borrar-ventas-completadas`, {
                method: "DELETE"
            });
            cargarVentasDesdeServidor(); // Recargar la lista después de eliminar
        } catch (error) {
            console.error("Error al borrar ventas completadas y entregadas:", error);
        }
    };

    return (
        <div className={styles.container}>
            <h2>Gestión de Ventas</h2>
            {/* 🔹 Menú de pestañas */}
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
                    Ver Ventas internas
                </button>
                {/* Nueva pestaña para Mercado Libre */}
                <button
                    className={activeTab === "mercadolibre" ? styles.activeTab : ""}
                    onClick={() => setActiveTab("mercadolibre")}
                >
                    Ventas Mercado Libre
                </button>
            </div>

            {/* 🔹 Pestaña de "Cargar Ventas" */}
            {activeTab === "cargar" && (
                <form onSubmit={handleSubmit} className={styles.form}>
                    <input type="text" name="sku" value={formData.sku} onChange={handleInputChange} placeholder="SKU" required />
                    <input type="text" name="nombre" value={formData.nombre} onChange={handleInputChange} placeholder="Producto" required />
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

                    {/* ✅ Agregamos el input de Hora Límite */}
                    <div className={styles.horaLimiteContainer}>
                        <label className={styles.horaLimiteLabel}>Hora Límite de Entrega:</label>
                        <input
                            type="time"
                            value={horaLimiteTemporal} // Usamos el estado temporal para el input
                            onChange={handleHoraLimiteInputChange}
                            className={styles.horaLimiteInput}
                        />
                        <button type="button" onClick={enviarHoraLimite} className={styles.enviarHoraLimiteBtn}>
                            Set
                        </button>
                    </div>
                </form>
            )}

            {/* 🔹 Pestaña de "Ver Ventas" (Listado) */}
            {activeTab === "listado" && (
                <>
                    <div className={styles.contadorContainer}>
                        <p className={styles.ventasTotales}>Ventas Totales: {ventas.length}</p>
                        <p className={styles.ventasPreparadas}>
                            Ventas Preparadas: {ventas.filter((venta) => venta.completada).length}
                        </p>
                    </div>

                    <h3>Hora Límite: {horaLimite}</h3>
                    <button onClick={borrarVentasCompletadas} className={styles.borrarCompletadas}>
                        Borrar Ventas Completadas
                    </button>

                    {/* 🔹 Recorremos cada grupo de ventas por Punto de Despacho */}
                    {Object.entries(agruparVentasPorPunto()).map(([puntoDespacho, ventasGrupo]) => (
                        <div key={puntoDespacho}>
                            <h3 className={styles.puntoTitulo}>
                                {puntoDespacho} <span className={styles.contadorPunto}>({ventasGrupo.length})</span>
                            </h3>

                            <ul className={styles.lista}>
                                {ventasGrupo.map((venta) => (
                                    <li key={venta._id} className={styles.ventaItem}>
                                        <div className={styles.ventaDetalle}>
                                            <p><strong>SKU:</strong> {venta.sku}</p>
                                            <p><strong>Nombre:</strong> {venta.nombre}</p>
                                            <p><strong>Cantidad:</strong> {venta.cantidad} unidades</p>
                                            {venta.cantidad > 1 && <span className={styles.alerta}>Ojo!</span>}
                                            <p><strong>Cliente:</strong> {venta.cliente}</p>
                                            <p><strong>N° Venta:</strong> {venta.numeroVenta}</p>
                                        </div>
                                        <button onClick={() => marcarCompletada(venta._id, venta.completada)} className={`${styles.checkBtn} ${venta.completada ? styles.checkBtnChecked : ''}`}>
                                            {venta.completada ? "✔" : "X"}
                                        </button>

                                        <button onClick={() => marcarEntregada(venta._id, venta.entregada)}
                                            className={`${styles.checkBtn} ${venta.entregada ? styles.entregadoBtnChecked : ''}`}>
                                            {venta.entregada ? "📦" : "🚚"}
                                        </button>
                                        <button onClick={() => borrarVenta(venta._id)} className={styles.checkBtn}>Borrar</button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </>
            )}

            {/* 🔹 Pestaña de "Ventas Mercado Libre" */}
            {activeTab === "mercadolibre" && (
                <div className="p-4 bg-gray-100 rounded-lg">
                    {/* Renderiza el componente de Mercado Libre que por ahora solo muestra un mensaje */}
                    <VentasMercadoLibre />
                </div>
            )}
        </div>
    );
}

export default Apiventas;
