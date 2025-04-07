// src/App.js
import React from "react";
import { BrowserRouter as Router, Route, Routes } from "react-router-dom";
import Header from "./components/Header"; // ✅ Debe ser una importación default
import Home from "./pages/Home"; // Asegúrate de crear este componente
import ApiventasPage from "./pages/Apiventas";
import ApiingresosPage from "./pages/Apiingresos";
import ApitareasPage from "./pages/Apitareas";
import "./App.css"; // Importación de estilos CSS
import CallbackMeli from "./pages/CallbackMeli";



function App() {
  return (
    <Router>
      <Header />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/ventas" element={<ApiventasPage />} />
        <Route path="/ingresos" element={<ApiingresosPage />} />
        <Route path="/tareas" element={<ApitareasPage />} />
      </Routes>
    </Router>
  );
}

export default App;