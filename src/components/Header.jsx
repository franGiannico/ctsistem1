// file: src/components/Header.jsx

import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Navbar, Nav, Container } from "react-bootstrap";

const Header = () => {
    const [expanded, setExpanded] = useState(false);

    return (
        <Navbar bg="primary" variant="dark" expand="lg" expanded={expanded} onToggle={setExpanded}>
            <Container>
                <Navbar.Brand as={Link} to="/" onClick={() => setExpanded(false)}>Sistema CT</Navbar.Brand>
                <Navbar.Toggle aria-controls="basic-navbar-nav" />
                <Navbar.Collapse id="basic-navbar-nav">
                    <Nav className="ms-auto">
                        <Nav.Link as={Link} to="/ventas" onClick={() => setExpanded(false)}>Ventas</Nav.Link>
                        <Nav.Link as={Link} to="/ingresos" onClick={() => setExpanded(false)}>Ingresos</Nav.Link>
                        <Nav.Link as={Link} to="/tareas" onClick={() => setExpanded(false)}>Tareas</Nav.Link>
                    </Nav>
                </Navbar.Collapse>
            </Container>
        </Navbar>
    );
};

export default Header;
