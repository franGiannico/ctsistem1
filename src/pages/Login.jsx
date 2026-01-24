import React, { useState } from 'react';
import { Container, Form, Button, Alert, Card, Spinner } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import 'bootstrap/dist/css/bootstrap.min.css';

const Login = () => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            // Determine API URL: Relative path in production, localhost in development
            // import.meta.env.PROD is true when built for production
            const API_URL = import.meta.env.PROD
                ? ''
                : (import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000');

            console.log("Intentando login en:", `${API_URL}/auth/login`);

            const response = await fetch(`${API_URL}/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password }),
            });

            // Handle non-JSON responses (e.g., 404, 500 HTML pages)
            const contentType = response.headers.get("content-type");
            let data;

            if (contentType && contentType.includes("application/json")) {
                data = await response.json();
            } else {
                // If the response is not JSON (likely HTML error page), we read it as text to debug
                const text = await response.text();
                console.error("Respuesta inesperada del servidor (no es JSON):", text);
                throw new Error(`Error del servidor: Recibimos HTML en lugar de JSON. (Status: ${response.status})`);
            }

            if (!response.ok) {
                throw new Error(data.error || 'Error al iniciar sesión');
            }

            // Guardar token
            localStorage.setItem('token', data.token);

            // Redirigir al inicio
            navigate('/');
        } catch (err) {
            console.error("Login Error:", err);
            setError(err.message || "Error de conexión con el servidor");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-background">
            <Container className="d-flex justify-content-center align-items-center vh-100">
                <Card className="login-card p-4 shadow-lg">
                    <Card.Body>
                        <div className="text-center mb-4">
                            <h2 className="fw-bold text-primary">Bienvenido</h2>
                            <p className="text-muted">Inicia sesión para continuar</p>
                        </div>

                        {error && <Alert variant="danger">{error}</Alert>}

                        <Form onSubmit={handleSubmit}>
                            <Form.Group className="mb-3" controlId="formUsername">
                                <Form.Label>Usuario</Form.Label>
                                <Form.Control
                                    type="text"
                                    placeholder="Ingresa tu usuario"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    required
                                    className="modern-input"
                                />
                            </Form.Group>

                            <Form.Group className="mb-4" controlId="formPassword">
                                <Form.Label>Contraseña</Form.Label>
                                <Form.Control
                                    type="password"
                                    placeholder="Ingresa tu contraseña"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    className="modern-input"
                                />
                            </Form.Group>

                            <Button
                                variant="primary"
                                type="submit"
                                className="w-100 py-2 fw-bold modern-btn"
                                disabled={loading}
                            >
                                {loading ? (
                                    <>
                                        <Spinner as="span" animation="border" size="sm" role="status" aria-hidden="true" />
                                        {' '}Entrando...
                                    </>
                                ) : 'Ingresar'}
                            </Button>
                        </Form>
                    </Card.Body>
                </Card>
            </Container>

            <style>{`
                .login-background {
                    background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
                    min-height: 100vh;
                    position: fixed;
                    width: 100%;
                    top: 0;
                    left: 0;
                    z-index: 0;
                }
                .login-card {
                    width: 100%;
                    max-width: 400px;
                    border: none;
                    border-radius: 15px;
                    background: rgba(255, 255, 255, 0.95);
                    backdrop-filter: blur(10px);
                }
                .modern-input {
                    border-radius: 8px;
                    padding: 12px;
                    border: 1px solid #e0e0e0;
                    transition: all 0.3s ease;
                }
                .modern-input:focus {
                    box-shadow: 0 0 0 3px rgba(13, 110, 253, 0.15);
                    border-color: #0d6efd;
                }
                .modern-btn {
                    border-radius: 8px;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    transition: all 0.3s ease;
                }
                .modern-btn:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 4px 12px rgba(13, 110, 253, 0.2);
                }
            `}</style>
        </div>
    );
};

export default Login;
