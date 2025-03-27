// pages/Home.jsx
import React from "react";
import { Link } from "react-router-dom";


const Home = () => {
  return (
    <div className="home-container"> {/* Usando clases estáticas */}
      <h1 className="title">Bienvenido al Sistema CT</h1>
      <nav className="nav">
        <ul className="nav-list">
          <li className="nav-item">
            <Link to="/ventas" className="nav-link">Ventas 👜</Link>
          </li>
          <li className="nav-item">
            <Link to="/ingresos" className="nav-link">Ingresos 📦</Link>
          </li>
          <li className="nav-item">
            <Link to="/tareas" className="nav-link">Tareas 📝</Link>
          </li>
        </ul>
      </nav>
    </div>
  );
};

export default Home;
