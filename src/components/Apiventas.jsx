import React, { useState, useEffect } from "react";
import styles from './Apiventas.module.css';

const API_URL = "https://ctsistem1-e68664e8ae46.herokuapp.com/apiventas";

function Apiventas() {
    const [ventas, setVentas] = useState([]);
    const [formData, setFormData] = useState({
        sku: "",
        nombre: "",
        cantidad: "",
        numeroVenta: "",
        cliente: "",
        puntoDespacho: ""
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
            const response = await fetch(`${API_URL}/cargar-ventas`);
            if (!response.ok) throw new Error("Error al obtener ventas");
            const data = await response.json();
            setVentas(data);
        } catch (error) {
            console.error("Error al cargar ventas:", error);
        }
    };

    const actualizarHoraLimiteEnBackend = async (hora) => {
        try {
            await fetch(`${API_URL}/actualizar-hora-limite`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ horaLimite: hora })
            });
        } catch (error) {
            console.error("Error al actualizar la hora límite en el backend:", error);
        }
    };

    const handleInputChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            const response = await fetch(`${API_URL}/guardar-ventas`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...formData, completada: false })
            });
            if (!response.ok) throw new Error("Error al guardar venta");
            cargarVentasDesdeServidor();
            setFormData({ sku: "", nombre: "", cantidad: "", numeroVenta: "", cliente: "", puntoDespacho: "" });
        } catch (error) {
            console.error("Error al guardar la venta:", error);
        }
    };

    const marcarCompletada = async (id, completada) => {
        try {
            await fetch(`${API_URL}/actualizar-venta/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ completada: !completada })
            });
            cargarVentasDesdeServidor();
        } catch (error) {
            console.error("Error al actualizar el estado de la venta:", error);
        }
    };

    const borrarVenta = async (id) => {
        try {
            await fetch(`${API_URL}/borrar-venta/${id}`, {
                method: "DELETE"
            });
            cargarVentasDesdeServidor();
        } catch (error) {
            console.error("Error al eliminar la venta:", error);
        }
    };

    return (
        <div className={styles.container}>
            <h1>Gestión de Ventas</h1>
            <form onSubmit={handleSubmit} className={styles.form}>
                <input type="text" name="sku" value={formData.sku} onChange={handleInputChange} placeholder="SKU" required />
                <input type="text" name="nombre" value={formData.nombre} onChange={handleInputChange} placeholder="Nombre" required />
                <button type="submit">Agregar Venta</button>
            </form>

            <h2>Ventas Cargadas</h2>
            <ul>
                {ventas.map((venta) => (
                    <li key={venta._id}>
                        {venta.nombre}
                        <button onClick={() => marcarCompletada(venta._id, venta.completada)}>✔</button>
                        <button onClick={() => borrarVenta(venta._id)}>❌</button>
                    </li>
                ))}
            </ul>
        </div>
    );
}

export default Apiventas;
