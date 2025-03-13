import { useState, useEffect } from "react";
import styles from './Apitareas.module.css';

const API_URL = "https://ctsistem1-e68664e8ae46.herokuapp.com/apitareas";

export default function Apitareas() {
    const [tareas, setTareas] = useState([]);
    const [descripcion, setDescripcion] = useState("");
    const [prioridad, setPrioridad] = useState("Normal");

    // Cargar tareas desde la API al montar el componente
    useEffect(() => {
        cargarTareasDesdeAPI();
    }, []);

    // Obtener todas las tareas de la API
    const cargarTareasDesdeAPI = async () => {
        try {
            const res = await fetch(`${API_URL}/cargar-tareas`);
            if (!res.ok) throw new Error(`Error HTTP: ${res.status}`);
            const data = await res.json();
            setTareas(data);
        } catch (error) {
            console.error("❌ Error al cargar tareas:", error);
        }
    };

    // Agregar una nueva tarea en la API y actualizar el estado
    const agregarTarea = async () => {
        if (!descripcion.trim()) {
            alert("Ingrese una descripción.");
            return;
        }

        const nuevaTarea = { descripcion, prioridad, completada: false };

        try {
            const res = await fetch(`${API_URL}/guardar-tareas`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(nuevaTarea),
            });

            if (!res.ok) throw new Error(`Error HTTP: ${res.status}`);

            const tareaGuardada = await res.json(); // Obtener tarea guardada
            setTareas([...tareas, tareaGuardada.tarea]); // Agregar al estado

            // Limpiar input
            setDescripcion("");
        } catch (error) {
            console.error("❌ Error al guardar tarea:", error);
        }
    };

    // Marcar tarea como completada en la API
    const marcarComoCompletada = async (tarea) => {
        try {
            const res = await fetch(`${API_URL}/update-tarea`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ _id: tarea._id, completada: !tarea.completada }),
            });

            if (!res.ok) throw new Error(`Error HTTP: ${res.status}`);

            // Actualizar estado con nueva información desde la API
            cargarTareasDesdeAPI();
        } catch (error) {
            console.error("❌ Error al actualizar tarea:", error);
        }
    };

    // Limpiar tareas completadas en la API
    const limpiarTareasCompletadas = async () => {
        try {
            const res = await fetch(`${API_URL}/limpiar-tareas`, {
                method: "DELETE",
            });

            if (!res.ok) throw new Error(`Error HTTP: ${res.status}`);

            // Actualizar estado tras limpiar
            cargarTareasDesdeAPI();
        } catch (error) {
            console.error("❌ Error al limpiar tareas:", error);
        }
    };

    return (
        <div className={styles.container}>
            <h2 className="text-xl font-bold mb-4">Gestión de Tareas</h2>

            <div className={styles.inputGroup}>
                <input
                    type="text"
                    placeholder="Nueva tarea"
                    value={descripcion}
                    onChange={(e) => setDescripcion(e.target.value)}
                    className={styles.input}
                />
                <select
                    value={prioridad}
                    onChange={(e) => setPrioridad(e.target.value)}
                    className={styles.select}
                >
                    <option value="Normal">Normal</option>
                    <option value="Prioritaria">Prioritaria</option>
                </select>
                <button onClick={agregarTarea} className={styles.addButton}>
                    Agregar
                </button>
            </div>

            <h3 className={styles.taskTitle}>Tareas Prioritarias</h3>
            <ul className={styles.taskList}>
                {tareas.filter((t) => t.prioridad === "Prioritaria").map((tarea) => (
                    <li key={tarea._id} className={styles.taskItem}>
                        <span className={tarea.completada ? styles.completed : ""}>{tarea.descripcion}</span>
                        <button
                            onClick={() => marcarComoCompletada(tarea)}
                            className={`${styles.checkButton} ${tarea.completada ? styles.checkButtonCompleted : styles.checkButtonNormal}`}
                        >
                            ✔
                        </button>
                    </li>
                ))}
            </ul>

            <h3 className={styles.taskTitle}>Tareas Normales</h3>
            <ul className={styles.taskList}>
                {tareas.filter((t) => t.prioridad === "Normal").map((tarea) => (
                    <li key={tarea._id} className={styles.taskItem}>
                        <span className={tarea.completada ? styles.completed : ""}>{tarea.descripcion}</span>
                        <button
                            onClick={() => marcarComoCompletada(tarea)}
                            className={`${styles.checkButton} ${tarea.completada ? styles.checkButtonCompleted : styles.checkButtonNormal}`}
                        >
                            ✔
                        </button>
                    </li>
                ))}
            </ul>

            <button
                onClick={limpiarTareasCompletadas}
                className={styles.clearButton}
            >
                Limpiar Tareas Completadas
            </button>
        </div>
    );
}
