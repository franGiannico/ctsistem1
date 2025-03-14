import React, { useState, useEffect } from "react";
import styles from './Apiventas.module.css';

function Apiventas() {
    const [ventas, setVentas] = useState([]);
    const [formData, setFormData] = useState({
        sku: "",
        nombre: "",
        cantidad: 1,  // Inicializamos cantidad en 1
        numeroVenta: "",
        cliente: "",
        puntoDespacho: "Punto de Despacho"
    });
    const [horaLimite, setHoraLimite] = useState(localStorage.getItem('horaLimite') || '');

    useEffect(() => {
        cargarVentasDesdeServidor();
    }, []);

    useEffect(() => {
        localStorage.setItem('horaLimite', horaLimite);
        actualizarHoraLimiteEnBackend(horaLimite);
    }, [horaLimite]);

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

    const marcarCompletada = async (id) => {
        try {
            const venta = ventas.find(v => v._id === id);
            await fetch(`https://ctsistem1-e68664e8ae46.herokuapp.com/apiventas/marcar-completada/${id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ completada: !venta.completada })
            });
            cargarVentasDesdeServidor();
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

    const handleHoraLimiteChange = (event) => {
        setHoraLimite(event.target.value);
    };

    return (
        <div className={styles.container}>
            <h1>Gestión de Ventas</h1>
            
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
            </form>

            <div>
                <h2>Ingresar Hora Límite de Entrega</h2>
                <input type="time" value={horaLimite} onChange={handleHoraLimiteChange} />
            </div>

            <h2>Ventas Cargadas</h2>
            <p>Hora Límite: {horaLimite}</p>
            <ul className={styles.lista}>
                {ventas.map((venta) => (
                    <li key={venta._id} className={styles.ventaItem}>
                        <div className={styles.ventaDetalle}>
                            <p>{venta.sku}</p>
                            <p>{venta.nombre}</p>
                            <p>{venta.cantidad} unidades</p>
                            <p>Cliente: {venta.cliente}</p>
                            <p>Punto de Despacho: {venta.puntoDespacho}</p>
                        </div>
                        <button onClick={() => marcarCompletada(venta._id)} className={`${styles.checkBtn} ${venta.completada ? styles.checkBtnChecked : ''}`}>
                            {venta.completada ? "✔" : "X"}
                        </button>
                        <button onClick={() => borrarVenta(venta._id)} className={styles.deleteBtn}>Borrar</button>
                    </li>
                ))}
            </ul>
        </div>
    );
}

export default Apiventas;