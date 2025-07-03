// src/components/Apiingresos.jsx

import React, { useState, useEffect, useRef } from "react";
import styles from './Apiingresos.module.css';

const ApiIngresos = () => {
    // URL base de tu backend, obtenida de las variables de entorno de Vite
    // ¡Esta línea es CRUCIAL y debe estar presente!
    const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

    const [items, setItems] = useState([]);
    const [formData, setFormData] = useState({
        codigoBarras: "",
        sku: "",
        articulo: "",
        cantidad: ""
    });

    // Referencias para los inputs
    const codigoBarrasRef = useRef(null);
    const skuRef = useRef(null);
    const cantidadRef = useRef(null);

    useEffect(() => {
        loadItems();
    }, []);

    const loadItems = async () => {
        try {
            // Usar la variable BACKEND_URL
            const response = await fetch(`${BACKEND_URL}/apiingresos/get-items`);
            if (!response.ok) throw new Error("No se pudieron cargar los artículos");
            const data = await response.json();
            setItems(data);
        } catch (error) {
            console.error("Error al cargar la lista de artículos:", error);
        }
    };

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const autocompletarProducto = async () => {
        const { codigoBarras } = formData;
        if (!codigoBarras) return;

        try {
            // Usar la variable BACKEND_URL
            const response = await fetch(`${BACKEND_URL}/apiingresos/buscar-producto/${codigoBarras}`);
            if (!response.ok) throw new Error("Producto no encontrado");

            const producto = await response.json();
            setFormData(prev => ({
                ...prev,
                sku: producto.sku,
                articulo: producto.descripcion
            }));

            // Si se encontró el producto, mover el foco a "Cantidad"
            setTimeout(() => {
                cantidadRef.current?.focus();
                cantidadRef.current?.click(); // Intenta abrir el teclado en la tablet
            }, 50);
        } catch (error) {
            console.error("Error al buscar el producto:", error);
            setFormData(prev => ({ ...prev, sku: "", articulo: "" }));

            // Si no se encuentra, mover a SKU
            setTimeout(() => skuRef.current?.focus(), 50);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === "Enter") {
            e.preventDefault(); // Evita que el formulario se envíe
            autocompletarProducto();
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const { codigoBarras, sku, articulo, cantidad } = formData;
        if (!codigoBarras || !sku || !articulo || !cantidad) {
            // NOTA: window.alert() no es compatible con el entorno de Canvas.
            // Deberías reemplazar esto con un modal de alerta personalizado en tu UI.
            alert("Por favor, completa todos los campos.");
            return;
        }

        const nuevoArticulo = { codigoBarras, sku, articulo, cantidad: parseInt(cantidad), checked: false };

        try {
            // Usar la variable BACKEND_URL
            await fetch(`${BACKEND_URL}/apiingresos/add-item`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(nuevoArticulo)
            });
            loadItems();
            setFormData({ codigoBarras: "", sku: "", articulo: "", cantidad: "" });

            // Regresar el foco al input de código de barras
            setTimeout(() => codigoBarrasRef.current?.focus(), 50);

        } catch (error) {
            console.error("Error al agregar el artículo:", error);
        }
    };

    const toggleChecked = async (id, checked) => {
        try {
            // Usar la variable BACKEND_URL
            await fetch(`${BACKEND_URL}/apiingresos/update-item/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ checked: !checked }) // Alternar estado
            });
            loadItems(); // Recargar lista después de actualizar
        } catch (error) {
            console.error("Error al actualizar estado de artículo:", error);
        }
    };

    const clearCheckedItems = async () => {
        // NOTA: window.confirm() no es compatible con el entorno de Canvas.
        // Deberías reemplazar esto con un modal de confirmación personalizado en tu UI.
        if (!window.confirm("¿Estás seguro de que quieres eliminar los artículos publicados?")) return;

        try {
            // Usar la variable BACKEND_URL
            const response = await fetch(`${BACKEND_URL}/apiingresos/clear-checked-items`, {
                method: "DELETE"
            });

            const data = await response.json();
            // NOTA: window.alert() no es compatible con el entorno de Canvas.
            // Deberías reemplazar esto con un modal de alerta personalizado en tu UI.
            alert(data.message); // Mostrar mensaje con el número de artículos eliminados
            loadItems(); // Recargar la lista después de eliminar
        } catch (error) {
            console.error("Error al eliminar artículos publicados:", error);
        }
    };

    return (
        <div className={styles.container}>
            <h2 className={styles.title}>Ingreso de Mercadería</h2>
            <form onSubmit={handleSubmit} className={styles.form}>
                <input
                    ref={codigoBarrasRef}
                    type="text"
                    name="codigoBarras"
                    value={formData.codigoBarras}
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                    placeholder="Código de Barras"
                />
                <input ref={skuRef} type="text" name="sku" value={formData.sku} onChange={handleChange} placeholder="SKU" />
                <input type="text" name="articulo" value={formData.articulo} onChange={handleChange} placeholder="Artículo" />
                <input ref={cantidadRef} type="tel" name="cantidad" value={formData.cantidad} onChange={handleChange} placeholder="Cantidad" inputMode="numeric"/>
                <button type="submit" className={styles.addButton}>Agregar</button>
            </form>

            <h3 className={styles.title}>Lista de Mercadería</h3>
            <div className={styles.itemsList}>
                {items.map(item => (
                    <div key={item._id} className={styles.item}>
                        <p>📦 {item.sku} - {item.articulo} ({item.cantidad} unidades)</p>
                        <p>🔢 Código de Barras: {item.codigoBarras}</p>
                        <button
                            onClick={() => toggleChecked(item._id, item.checked)}
                            className={item.checked ? styles.checkedButtonActive : styles.checkedButton}
                        >
                            {item.checked ? "✔" : "☐"}
                        </button>
                    </div>
                ))}
            </div>

            <div className={styles.clearContainer}>
                <button onClick={clearCheckedItems} className={styles.clearButton}>
                    Eliminar Publicados
                </button>
            </div>
        </div>
    );
};

export default ApiIngresos;
