// src/components/VentasMercadoLibre.jsx

import React, { useState, useEffect } from 'react';

const VentasMercadoLibre = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [autenticado, setAutenticado] = useState(false);
  const [mensaje, setMensaje] = useState('');

  // URL base de tu backend, obtenida de las variables de entorno de Vite
  // Asegúrate de que VITE_BACKEND_URL esté definido en tu .env del frontend
  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

  /**
   * useEffect para manejar el callback de Mercado Libre después de la autenticación.
   * Se ejecuta cuando el componente se monta y cuando la URL cambia.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const success = params.get('success'); // Parámetro que enviamos desde el backend después del callback

    if (success === 'true') {
      setAutenticado(true);
      setMensaje('¡Autenticación con Mercado Libre exitosa!');
      // Limpiar los parámetros de la URL para que no se muestren en futuras cargas
      window.history.replaceState({}, document.title, window.location.pathname);
      obtenerVentas(); // Intentar obtener ventas inmediatamente después de la autenticación
    } else {
      // Verificar si ya hay un token en el backend (ej. si el usuario ya se autenticó antes)
      verificarAutenticacionBackend();
    }
  }, []); // Se ejecuta solo una vez al montar el componente

  /**
   * Verifica si el usuario ya está autenticado con Mercado Libre a través del backend.
   * Esto es útil para mantener la sesión si el token ya existe.
   */
  const verificarAutenticacionBackend = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/meli/auth`);
      const data = await res.json();

      if (data.autenticado) {
        setAutenticado(true);
        setMensaje('Ya estás autenticado con Mercado Libre.');
        obtenerVentas(); // Si ya está autenticado, intentar obtener ventas
      } else {
        setAutenticado(false);
        setMensaje('Necesitas conectar con Mercado Libre.');
      }
    } catch (err) {
      setError('Error al verificar autenticación: ' + err.message);
      console.error('Error al verificar autenticación:', err);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Inicia el proceso de conexión/autenticación con Mercado Libre.
   * Redirige al usuario a la URL de autorización de Mercado Libre.
   */
  const conectarConMercadoLibre = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/meli/auth`);
      const data = await res.json();

      if (data.redirect) {
        // Redirige al usuario al enlace de autorización de Mercado Libre
        window.location.href = data.redirect;
      } else if (data.autenticado) {
        // Si el backend dice que ya está autenticado (ej. token válido), actualiza el estado
        setAutenticado(true);
        setMensaje('Ya estás autenticado con Mercado Libre.');
        obtenerVentas();
      } else {
        throw new Error('No se pudo obtener la URL de autenticación de Mercado Libre.');
      }
    } catch (err) {
      setError('Error al conectar con Mercado Libre: ' + err.message);
      console.error('Error al conectar con Mercado Libre:', err);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Obtiene los datos de ventas de Mercado Libre a través de la API de tu backend.
   * Los datos brutos se imprimen en la consola.
   */
  const obtenerVentas = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/meli/ventas`);
      const data = await res.json();

      if (data.error) {
        throw new Error(data.error);
      }

      if (data.ventas && Array.isArray(data.ventas)) {
        setMensaje(`Ventas obtenidas: ${data.ventas.length} registros.`);
        console.log('--- Datos de Ventas de Mercado Libre (RAW) ---');
        console.log(data.ventas); // <-- Aquí se imprime el console.log solicitado
        console.log('-------------------------------------------');
        // Si quisieras mostrarlas en la UI, aquí actualizarías un estado como setVentas(data.ventas);
      } else {
        setMensaje('No se encontraron ventas o el formato es inesperado.');
        console.log('Respuesta de ventas inesperada:', data);
      }
    } catch (err) {
      setError('Error al obtener ventas: ' + err.message);
      console.error('Error al obtener ventas:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 bg-gray-50 rounded-lg shadow-md max-w-2xl mx-auto my-8">
      <h2 className="text-3xl font-extrabold text-gray-800 mb-6 text-center">
        Integración con Mercado Libre
      </h2>

      <div className="mb-4 text-center">
        {loading && <p className="text-blue-600">Cargando...</p>}
        {error && <p className="text-red-600 font-medium">{error}</p>}
        {mensaje && <p className="text-gray-700">{mensaje}</p>}
      </div>

      {!autenticado ? (
        <div className="text-center">
          <button
            onClick={conectarConMercadoLibre}
            className="bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-3 px-6 rounded-lg shadow-lg transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:ring-opacity-75"
            disabled={loading}
          >
            {loading ? 'Conectando...' : 'Conectar con Mercado Libre'}
          </button>
          <p className="mt-4 text-sm text-gray-600">
            Necesitas autorizar tu aplicación para acceder a los datos de tus ventas.
          </p>
        </div>
      ) : (
        <div className="text-center">
          <p className="text-lg font-semibold text-green-700 mb-4">
            ¡Autenticado con Mercado Libre!
          </p>
          <button
            onClick={obtenerVentas}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg shadow-lg transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-75"
            disabled={loading}
          >
            {loading ? 'Obteniendo Ventas...' : 'Obtener Ventas'}
          </button>
          <p className="mt-4 text-sm text-gray-600">
            Haz clic para obtener los datos más recientes de tus ventas de Mercado Libre.
            Los verás en la consola del navegador.
          </p>
        </div>
      )}
    </div>
  );
};

export default VentasMercadoLibre;
