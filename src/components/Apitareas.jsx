import { useState, useEffect } from "react";
import styles from './Apitareas.module.css';

const API_URL = "https://ctsistem1-e68664e8ae46.herokuapp.com/apitareas";;

export default function Apitareas() {
    const [tareas, setTareas] = useState([]);
    const [descripcion, setDescripcion] = useState("");
    const [prioridad, setPrioridad] = useState("Normal");

    useEffect(() => {
        cargarTareasDesdeAPI();
    }, []);

    const cargarTareasDesdeAPI = async () => {
        try {
            const res = await fetch(`${API_URL}/cargar-tareas`);
            if (!res.ok) throw new Error(`Error HTTP: ${res.status}`);
            const data = await res.json();
            setTareas(data);
        } catch (error) {
            console.error("Error al cargar tareas:", error);
        }
    };

    const agregarTarea = async () => {
        if (!descripcion.trim()) {
            alert("Ingrese una descripción.");
            return;
        }

        const nuevaTarea = { descripcion, prioridad, completada: false };
        const nuevasTareas = [...tareas, nuevaTarea];
        setTareas(nuevasTareas);
        setDescripcion("");

        await guardarTareasEnAPI(nuevasTareas);
    };

    const marcarComoCompletada = async (index) => {
        const nuevasTareas = tareas.map((tarea, i) =>
            i === index ? { ...tarea, completada: !tarea.completada } : tarea
        );
        setTareas(nuevasTareas);
        await guardarTareasEnAPI(nuevasTareas);
    };

    const limpiarTareasCompletadas = async () => {
        const nuevasTareas = tareas.filter((tarea) => !tarea.completada);
        setTareas(nuevasTareas);
        await guardarTareasEnAPI(nuevasTareas);
    };

    const guardarTareasEnAPI = async (tareasActualizadas) => {
        try {
            await fetch(`${API_URL}/guardar-tareas`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(tareasActualizadas),
            });
        } catch (error) {
            console.error("Error al guardar tareas:", error);
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
                {tareas.filter((t) => t.prioridad === "Prioritaria").map((tarea, index) => (
                    <li key={index} className={styles.taskItem}>
                        <span className={tarea.completada ? styles.completed : ""}>{tarea.descripcion}</span>
                        <button
                            onClick={() => marcarComoCompletada(index)}
                            className={`${styles.checkButton} ${tarea.completada ? styles.checkButtonCompleted : styles.checkButtonNormal}`}
                        >
                            ✔
                        </button>
                    </li>
                ))}
            </ul>

            <h3 className={styles.taskTitle}>Tareas Normales</h3>
            <ul className={styles.taskList}>
                {tareas.filter((t) => t.prioridad === "Normal").map((tarea, index) => (
                    <li key={index} className={styles.taskItem}>
                        <span className={tarea.completada ? styles.completed : ""}>{tarea.descripcion}</span>
                        <button
                            onClick={() => marcarComoCompletada(index)}
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