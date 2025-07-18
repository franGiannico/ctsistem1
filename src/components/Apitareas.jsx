// file: src/components/Apitareas.jsx

import { useState, useEffect } from "react";
import { Container, Row, Col, Button, Form, ListGroup } from "react-bootstrap";

export default function Apitareas() {
    // URL base de tu backend, obtenida de las variables de entorno de Vite
    const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;
    // Construimos la URL específica para las tareas
    const API_TAREAS_URL = `${BACKEND_URL}/apitareas`;

    const [tareas, setTareas] = useState([]);
    const [descripcion, setDescripcion] = useState("");
    const [prioridad, setPrioridad] = useState("Normal");

    useEffect(() => {
        let tareasAnteriores = [];

        const cargarTareasSiCambian = async () => {
            try {
                const res = await fetch(`${API_TAREAS_URL}/cargar-tareas`);
                if (!res.ok) throw new Error(`Error HTTP: ${res.status}`);
                const data = await res.json();

                if (JSON.stringify(data) !== JSON.stringify(tareasAnteriores)) {
                    setTareas(data);
                    tareasAnteriores = data;
                }
            } catch (error) {
                console.error("❌ Error al cargar tareas:", error);
            }
        };

        cargarTareasSiCambian(); // Primera carga inmediata

        const interval = setInterval(() => {
            cargarTareasSiCambian();
        }, 1000); // Cada 1 segundo

        return () => clearInterval(interval);
    }, []);


    const agregarTarea = async () => {
        if (!descripcion.trim()) {
            // NOTA: window.alert() no es compatible con el entorno de Canvas.
            // Deberías reemplazar esto con un modal de alerta personalizado en tu UI.
            alert("Ingrese una descripción.");
            return;
        }

        const nuevaTarea = { descripcion, prioridad, completada: false };

        try {
            // Usar la variable API_TAREAS_URL
            const res = await fetch(`${API_TAREAS_URL}/guardar-tareas`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(nuevaTarea),
            });

            if (!res.ok) throw new Error(`Error HTTP: ${res.status}`);

            cargarTareasSiCambian();
            setDescripcion(""); // Limpiar el input después de agregar
        } catch (error) {
            console.error("❌ Error al guardar tarea:", error);
        }
    };

    const marcarComoCompletada = async (tarea) => {
        try {
            // Usar la variable API_TAREAS_URL
            const res = await fetch(`${API_TAREAS_URL}/update-tarea`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ _id: tarea._id, completada: !tarea.completada }),
            });

            if (!res.ok) throw new Error(`Error HTTP: ${res.status}`);
           cargarTareasSiCambian();
        } catch (error) {
            console.error("❌ Error al actualizar tarea:", error);
        }
    };

    const limpiarTareasCompletadas = async () => {
        // NOTA: window.confirm() no es compatible con el entorno de Canvas.
        // Deberías reemplazar esto con un modal de confirmación personalizado en tu UI.
        if (!window.confirm("¿Estás seguro de que quieres eliminar las tareas completadas?")) return;

        try {
            // Usar la variable API_TAREAS_URL
            const res = await fetch(`${API_TAREAS_URL}/limpiar-tareas`, {
                method: "DELETE",
            });

            if (!res.ok) throw new Error(`Error HTTP: ${res.status}`);
            cargarTareasSiCambian();
        } catch (error) {
            console.error("❌ Error al limpiar tareas:", error);
        }
    };

    return (
        <Container fluid className="mt-4 px-4">
            <h2 className="text-center">Gestión de Tareas</h2>

            {/* Formulario de nueva tarea */}
            <Row className="mb-3">
                <Col xs={12} md={10} lg={8} xl={6} className="mx-auto">
                    <Form>
                        <Form.Group controlId="formDescripcion">
                            <Form.Control
                                type="text"
                                placeholder="Nueva tarea"
                                value={descripcion}
                                onChange={(e) => setDescripcion(e.target.value)}
                            />
                        </Form.Group>
                        <Form.Group controlId="formPrioridad" className="mt-2">
                            <Form.Select
                                value={prioridad}
                                onChange={(e) => setPrioridad(e.target.value)}
                            >
                                <option value="Normal">Normal</option>
                                <option value="Prioritaria">Prioritaria</option>
                            </Form.Select>
                        </Form.Group>
                        <Button variant="primary" className="w-100 mt-3" onClick={agregarTarea}>
                            Agregar Tarea
                        </Button>
                    </Form>
                </Col>
            </Row>

            {/* Sección de tareas prioritarias */}
            <Row>
                <Col xs={12} md={10} lg={8} xl={6} className="mx-auto">
                    <h4>Tareas Prioritarias</h4>
                    <ListGroup>
                        {tareas.filter(t => t.prioridad === "Prioritaria").map((tarea) => (
                            <ListGroup.Item key={tarea._id} className="d-flex justify-content-between align-items-center">
                                <span className={tarea.completada ? "text-decoration-line-through text-muted" : ""}>
                                    {tarea.descripcion}
                                </span>
                                <Button
                                    variant={tarea.completada ? "success" : "secondary"}
                                    size="sm"
                                    onClick={() => marcarComoCompletada(tarea)}
                                >
                                    ✔
                                </Button>
                            </ListGroup.Item>
                        ))}
                    </ListGroup>
                </Col>
            </Row>

            {/* Sección de tareas normales */}
            <Row className="mt-4">
                <Col xs={12} md={10} lg={8} xl={6} className="mx-auto">
                    <h4>Tareas Normales</h4>
                    <ListGroup>
                        {tareas.filter(t => t.prioridad === "Normal").map((tarea) => (
                            <ListGroup.Item key={tarea._id} className="d-flex justify-content-between align-items-center">
                                <span className={tarea.completada ? "text-decoration-line-through text-muted" : ""}>
                                    {tarea.descripcion}
                                </span>
                                <Button
                                    variant={tarea.completada ? "success" : "secondary"}
                                    size="sm"
                                    onClick={() => marcarComoCompletada(tarea)}
                                >
                                    ✔
                                </Button>
                            </ListGroup.Item>
                        ))}
                    </ListGroup>
                </Col>
            </Row>

            {/* Botón de limpiar tareas completadas */}
            <Row className="mt-4">
                <Col xs={12} md={10} lg={8} xl={6} className="mx-auto text-center">
                    <Button variant="danger" onClick={limpiarTareasCompletadas}>
                        Limpiar Tareas Completadas
                    </Button>
                </Col>
            </Row>
        </Container>
    );
}
