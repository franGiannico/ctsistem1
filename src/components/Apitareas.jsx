import { useState, useEffect } from "react";
import { Container, Row, Col, Button, Form, ListGroup } from "react-bootstrap";

const API_URL = "https://ctsistem1-e68664e8ae46.herokuapp.com/apitareas";

export default function Apitareas() {
    const [tareas, setTareas] = useState([]);
    const [descripcion, setDescripcion] = useState("");
    const [prioridad, setPrioridad] = useState("Normal");

    useEffect(() => {
        cargarTareasDesdeAPI();
        const interval = setInterval(() => {
            cargarTareasDesdeAPI();
        }, 5000);
        return () => clearInterval(interval);
    }, []);

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

            cargarTareasDesdeAPI();
            setDescripcion("");
        } catch (error) {
            console.error("❌ Error al guardar tarea:", error);
        }
    };

    const marcarComoCompletada = async (tarea) => {
        try {
            const res = await fetch(`${API_URL}/update-tarea`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ _id: tarea._id, completada: !tarea.completada }),
            });

            if (!res.ok) throw new Error(`Error HTTP: ${res.status}`);
            cargarTareasDesdeAPI();
        } catch (error) {
            console.error("❌ Error al actualizar tarea:", error);
        }
    };

    const limpiarTareasCompletadas = async () => {
        try {
            const res = await fetch(`${API_URL}/limpiar-tareas`, {
                method: "DELETE",
            });

            if (!res.ok) throw new Error(`Error HTTP: ${res.status}`);
            cargarTareasDesdeAPI();
        } catch (error) {
            console.error("❌ Error al limpiar tareas:", error);
        }
    };

    return (
        <Container fluid className="mt-4 px-4">
        <h2 className="text-center">Gestión de Tareas</h2>

        <Row className="mb-3">
            <Col xs={12} md={10} lg={8} xl={6} className="mx-auto">
                <Form>
                    <Form.Group controlId="formDescripcion">
                        <Form.Control type="text" placeholder="Nueva tarea" />
                    </Form.Group>
                    <Form.Group controlId="formPrioridad" className="mt-2">
                        <Form.Select>
                            <option value="Normal">Normal</option>
                            <option value="Prioritaria">Prioritaria</option>
                        </Form.Select>
                    </Form.Group>
                    <Button variant="primary" className="w-100 mt-3">Agregar Tarea</Button>
                </Form>
            </Col>
        </Row>

        <Row>
            <Col xs={12} md={10} lg={8} xl={6} className="mx-auto">
                <h4>Tareas Prioritarias</h4>
                <ListGroup>
                    <ListGroup.Item className="d-flex justify-content-between align-items-center">
                        <span>Ejemplo de Tarea</span>
                        <Button variant="secondary" size="sm">✔</Button>
                    </ListGroup.Item>
                </ListGroup>
            </Col>
        </Row>

        <Row className="mt-4">
            <Col xs={12} md={10} lg={8} xl={6} className="mx-auto">
                <h4>Tareas Normales</h4>
                <ListGroup>
                    <ListGroup.Item className="d-flex justify-content-between align-items-center">
                        <span>Ejemplo de Tarea Normal</span>
                        <Button variant="secondary" size="sm">✔</Button>
                    </ListGroup.Item>
                </ListGroup>
            </Col>
        </Row>

        <Row className="mt-4">
            <Col xs={12} md={10} lg={8} xl={6} className="mx-auto text-center">
                <Button variant="danger">Limpiar Tareas Completadas</Button>
            </Col>
        </Row>
    </Container>
    );
}
