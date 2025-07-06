// src/components/MeliAuthButton.jsx

import React, { useState } from 'react';

function MeliAuthButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const iniciarAutenticacion = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/meli/auth`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data.redirect) {
        // Redirigir a Mercado Libre para autenticarse
        window.location.href = data.redirect;
      } else if (data.autenticado) {
        alert('Ya estás autenticado con Mercado Libre');
      } else {
        alert('No se pudo obtener la URL de autenticación');
      }
    } catch (err) {
      setError('Error al iniciar autenticación');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button onClick={iniciarAutenticacion} disabled={loading}>
      {loading ? 'Redirigiendo...' : 'Iniciar autenticación Mercado Libre'}
      {error && <p style={{ color: 'red' }}>{error}</p>}
    </button>
  );
}

export default MeliAuthButton;
