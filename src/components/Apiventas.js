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

    useEffect(() => {
        cargarVentasDesdeServidor();
    }, []);

    const cargarVentasDesdeServidor = async () => {
        try {
            const response = await fetch("https://sistema-ct-09ee8bc4c3b9.herokuapp.com/apiventas/cargar-ventas");
            const data = await response.json();
            setVentas(data);
        } catch (error) {
            console.error("Error al cargar ventas:", error);
        }
    };


    const handleInputChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const nuevaVenta = { ...formData, completada: false };
        try {
            await fetch("https://sistema-ct-09ee8bc4c3b9.herokuapp.com/apiventas/guardar-ventas", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(nuevaVenta)
            });
            setVentas([...ventas, nuevaVenta]);
            setFormData({ sku: "", nombre: "", cantidad: "", numeroVenta: "", cliente: "", puntoDespacho: "" });
        } catch (error) {
            console.error("Error al guardar la venta:", error);
        }
    };

    const marcarCompletada = async (index) => {
        const nuevasVentas = [...ventas];
        nuevasVentas[index].completada = !nuevasVentas[index].completada;
        setVentas(nuevasVentas);
        await fetch("https://sistema-ct-09ee8bc4c3b9.herokuapp.com/apiventas/guardar-ventas", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(nuevasVentas)
        });
    };

    const borrarVenta = async (index) => {
        const nuevasVentas = ventas.filter((_, i) => i !== index);
        setVentas(nuevasVentas);
        await fetch("https://sistema-ct-09ee8bc4c3b9.herokuapp.com/apiventas/guardar-ventas", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(nuevasVentas)
        });
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
            <h2>Ventas Cargadas</h2>
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