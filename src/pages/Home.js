// pages/Home.js
import React from "react";
import { Link } from "react-router-dom";

const Home = () => {
  return (
    <div>
      <h1>Bienvenido al Sistema CT</h1>
      <nav>
        <ul>
          <li>
            <Link to="/ventas">Ventas</Link>
          </li>
          <li>
            <Link to="/ingresos">Ingresos</Link>
          </li>
          <li>
            <Link to="/tareas">Tareas</Link>
          </li>
        </ul>
      </nav>
    </div>
  );
};

export default Home;