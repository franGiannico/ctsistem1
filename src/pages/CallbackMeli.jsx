File: src/pages/CallbackMeli.jsx

import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const CallbackMeli = () => {
  const location = useLocation();

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const code = searchParams.get("code");

    if (code) {
      fetch("https://ctsistem1-e68664e8ae46.herokuapp.com/meli/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ code }),
      })
        .then((res) => res.json())
        .then((data) => {
          console.log("Token recibido:", data);
          // Podés guardar el token en el estado o redirigir a otra página
        })
        .catch((err) => {
          console.error("Error al obtener token:", err);
        });
    }
  }, [location.search]);

  return <h2>Procesando autenticación con Mercado Libre...</h2>;
};

export default CallbackMeli;
