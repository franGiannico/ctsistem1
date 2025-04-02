import React, { useState, useEffect } from "react";
import styles from './Apiventas.module.css';

function Apiventas() {
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
    const [pestaniaActiva, setPestaniaActiva] = useState("cargar");
    const [horaLimiteTemporal, setHoraLimiteTemporal] = useState(''); // Inicializar sin valor
    useEffect(() => {
        cargarVentasDesdeServidor();
        obtenerHoraLimiteDesdeBackend();
    }, []);

    const obtenerHoraLimiteDesdeBackend = async () => {
        try {
            const response = await fetch("https://tu-backend.herokuapp.com/apiventas/obtener-hora-limite");
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
            const response = await fetch("https://ctsistem1-e68664e8ae46.herokuapp.com/apiventas/cargar-ventas");
            const data = await response.json();
            setVentas(data);
        } catch (error) {
            console.error("Error al cargar ventas:", error);
        }
    };

    const actualizarHoraLimiteEnBackend = async (hora) => {
        try {
            await fetch("https://ctsistem1-e68664e8ae46.herokuapp.com/apiventas/actualizar-hora-limite", {
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
            await fetch("https://ctsistem1-e68664e8ae46.herokuapp.com/apiventas/guardar-ventas", {
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

            const response = await fetch(`https://ctsistem1-e68664e8ae46.herokuapp.com/apiventas/actualizar-venta/${id}`, {
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
            await fetch(`https://ctsistem1-e68664e8ae46.herokuapp.com/apiventas/borrar-venta/${id}`, {
                method: "DELETE"
            });
            cargarVentasDesdeServidor();
        } catch (error) {
            console.error("Error al borrar la venta:", error);
        }
    };

    // Función para agrupar ventas por Punto de Despacho
    const agruparVentasPorPunto = () => {
        const grupos = {};
        ventas.forEach((venta) => {
            if (!grupos[venta.puntoDespacho]) {
                grupos[venta.puntoDespacho] = [];
            }
            grupos[venta.puntoDespacho].push(venta);
        });
        return grupos;
    };

    const borrarVentasCompletadas = async () => {
        if (!window.confirm("¿Estás seguro de que quieres eliminar todas las ventas completadas?")) return;
    
        try {
            await fetch("https://ctsistem1-e68664e8ae46.herokuapp.com/apiventas/borrar-ventas-completadas", {
                method: "DELETE"
            });
            cargarVentasDesdeServidor(); // Recargar la lista después de eliminar
        } catch (error) {
            console.error("Error al borrar ventas completadas:", error);
        }
    };
    

    return (
        <div className={styles.container}>
            <h2>Gestión de Ventas</h2>

            {/* 🔹 Menú de pestañas */}
            <div className={styles.tabs}>
                <button
                    className={pestaniaActiva === "cargar" ? styles.activeTab : ""}
                    onClick={() => setPestaniaActiva("cargar")}
                >
                    Cargar Ventas
                </button>
                <button
                    className={pestaniaActiva === "listado" ? styles.activeTab : ""}
                    onClick={() => setPestaniaActiva("listado")}
                >
                    Ver Ventas
                </button>
            </div>

            {/* 🔹 Pestaña de "Cargar Ventas" */}
            {pestaniaActiva === "cargar" && (

                <form onSubmit={handleSubmit} className={styles.form}>
                    <input type="text" name="sku" value={formData.sku} onChange={handleInputChange} placeholder="SKU" required />
                    <input type="text" name="nombre" value={formData.nombre} onChange={handleInputChange} placeholder="Nombre" required />
                    <input type="number" name="cantidad" value={formData.cantidad} onChange={handleInputChange} min="1" required />
                    <input type="number" name="numeroVenta" value={formData.numeroVenta} onChange={handleInputChange} placeholder="N° Venta" required />
                    <input type="text" name="cliente" value={formData.cliente} onChange={handleInputChange} placeholder="Cliente" required />
                    
                    <select name="puntoDespacho" value={formData.puntoDespacho} onChange={handleInputChange} required>
                        <option value="Andreani">Andreani</option>
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

            {/* 🔹 Pestaña de "Ver Ventas" */}
            {pestaniaActiva === "listado" && (
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
                        {/* ✅ **Agregamos la cantidad de ventas en el título** */}
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
                                    <button onClick={() => borrarVenta(venta._id)} className={styles.checkBtn}>Borrar</button>
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

