import React, { useState, useEffect } from "react";
import styles from './Apiventas.module.css';

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
        setFormData({ ...formData, [e.target.name]: e.target.value });
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
            // Recargar las ventas desde el servidor después de agregar una nueva venta
            cargarVentasDesdeServidor();
            setFormData({ sku: "", nombre: "", cantidad: "", numeroVenta: "", cliente: "", puntoDespacho: "" });
        } catch (error) {
            console.error("Error al guardar la venta:", error);
        }
    };

    const marcarCompletada = async (index) => {
        const nuevasVentas = [...ventas];
        nuevasVentas[index].completada = !nuevasVentas[index].completada;
        setVentas(nuevasVentas);
        await fetch("https://ctsistem1-e68664e8ae46.herokuapp.com/apiventas/guardar-ventas", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(nuevasVentas)
        });
        cargarVentasDesdeServidor();
    };

    const borrarVenta = async (index) => {
        const nuevasVentas = ventas.filter((_, i) => i !== index);
        setVentas(nuevasVentas);
        await fetch("https://ctsistem1-e68664e8ae46.herokuapp.com/apiventas/guardar-ventas", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(nuevasVentas)
        });
        cargarVentasDesdeServidor();
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
                <input type="number" name="cantidad" value={formData.cantidad} onChange={handleInputChange} placeholder="Cantidad" required />
                <input type="number" name="numeroVenta" value={formData.numeroVenta} onChange={handleInputChange} placeholder="N° Venta" required />
                <input type="text" name="cliente" value={formData.cliente} onChange={handleInputChange} placeholder="Cliente" required />
                <input type="text" name="puntoDespacho" value={formData.puntoDespacho} onChange={handleInputChange} placeholder="Punto de Despacho" required />
                <button type="submit">Agregar Venta</button>
            </form>

            <div>
                <h2>Ingresar Hora Límite de Entrega</h2>
                <input
                    type="time"
                    value={horaLimite}
                    onChange={handleHoraLimiteChange}
                />
            </div>

            <h2>Ventas Cargadas</h2>
            <p>Hora Límite: {horaLimite}</p>
            <ul className={styles.lista}>
                {ventas.map((venta, index) => (
                    <li key={index} className={styles.ventaItem}>
                        <div className={styles.ventaDetalle}>
                            <p>{venta.sku}</p>
                            <p>{venta.nombre}</p>
                            <p>{venta.cantidad} unidades</p>
                        </div>
                        <button onClick={() => marcarCompletada(index)} className={`${styles.checkBtn} ${venta.completada ? styles.checkBtnChecked : ''}`}>
                            {venta.completada ? "✔" : "X"}
                        </button>
                        <button onClick={() => borrarVenta(index)} className={styles.checkBtn}>Borrar</button>
                    </li>
                ))}
            </ul>
        </div>
    );
}

export default Apiventas;