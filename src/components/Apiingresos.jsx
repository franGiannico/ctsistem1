import React, { useState, useEffect, useRef } from "react";
import styles from './Apiingresos.module.css';

const ApiIngresos = () => {
    const [items, setItems] = useState([]);
    const [formData, setFormData] = useState({
        codigoBarras: "",
        sku: "",
        articulo: "",
        cantidad: ""
    });
    const codigoBarrasRef = useRef(null);

    useEffect(() => {
        loadItems();
    }, []);

    const loadItems = async () => {
        try {
            const response = await fetch("https://ctsistem1-e68664e8ae46.herokuapp.com/apiingresos/get-items");
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
            const response = await fetch("/base_datos.json");
            if (!response.ok) throw new Error("No se pudo cargar la base de datos");
            const data = await response.json();
            const producto = data.find(item => String(item.CODIGO_BARRAS).trim() === String(codigoBarras).trim());

            if (producto) {
                setFormData(prev => ({
                    ...prev,
                    sku: producto.SKU,
                    articulo: producto.DESCRIPCION
                }));
            } else {
                setFormData(prev => ({ ...prev, sku: "", articulo: "" }));
            }
        } catch (error) {
            console.error("Error al cargar la base de datos:", error);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const { codigoBarras, sku, articulo, cantidad } = formData;
        if (!codigoBarras || !sku || !articulo || !cantidad) {
            alert("Por favor, completa todos los campos.");
            return;
        }

        const nuevoArticulo = { codigoBarras, sku, articulo, cantidad: parseInt(cantidad), checked: false };
        
        try {
            await fetch("https://ctsistem1-e68664e8ae46.herokuapp.com/apiingresos/add-item", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(nuevoArticulo)
            });
            loadItems();
            setFormData({ codigoBarras: "", sku: "", articulo: "", cantidad: "" });
        } catch (error) {
            console.error("Error al agregar el artículo:", error);
        }
    };

    const clearCheckedItems = async () => {
        if (!window.confirm("¿Estás seguro de que quieres eliminar los artículos publicados?")) return;

        try {
            await fetch("https://ctsistem1-e68664e8ae46.herokuapp.com/apiingresos/clear-checked-items", {
                method: "POST"
            });
            loadItems();
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
                    onBlur={autocompletarProducto}
                    placeholder="Código de Barras"
                />
                <input type="text" name="sku" value={formData.sku} onChange={handleChange} placeholder="SKU" />
                <input type="text" name="articulo" value={formData.articulo} onChange={handleChange} placeholder="Artículo" />
                <input type="number" name="cantidad" value={formData.cantidad} onChange={handleChange} placeholder="Cantidad" />
                <button type="submit" className={styles.addButton}>Agregar</button>
            </form>

            <h3 className={styles.title}>Lista de Mercadería</h3>
            <div className={styles.itemsList}>
                {items.map(item => (
                    <div key={item.sku} className={styles.item}>
                        <p>📦 {item.sku} - {item.articulo} ({item.cantidad} unidades)</p>
                        <p>🔢 Código de Barras: {item.codigoBarras}</p>
                        <button onClick={() => clearCheckedItems()} className={styles.clearButton}>Eliminar Publicados</button>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default ApiIngresos;