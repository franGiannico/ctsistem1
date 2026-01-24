// src/App.js
import React from "react";
import { BrowserRouter as Router, Route, Routes, Outlet } from "react-router-dom";
import Header from "./components/Header";
import Home from "./pages/Home";
import ApiventasPage from "./pages/Apiventas";
import ApiingresosPage from "./pages/Apiingresos";
import ApitareasPage from "./pages/Apitareas";
import FacturarVentaML from "./components/FacturarVentaML";
import Login from "./pages/Login";
import PrivateRoute from "./components/PrivateRoute";
import "./App.css";

// Layout para las páginas internas que llevan Header
const MainLayout = () => (
  <>
    <Header />
    <Outlet />
  </>
);

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />

        {/* Rutas Protegidas */}
        <Route element={<PrivateRoute />}>
          <Route element={<MainLayout />}>
            <Route path="/" element={<Home />} />
            <Route path="/ventas" element={<ApiventasPage />} />
            <Route path="/ingresos" element={<ApiingresosPage />} />
            <Route path="/tareas" element={<ApitareasPage />} />
            <Route path="/facturar-ml" element={<FacturarVentaML />} />
          </Route>
        </Route>
      </Routes>
    </Router>
  );
}

export default App;