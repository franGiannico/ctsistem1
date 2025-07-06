import React, { useState, useEffect } from 'react';

const VentasMercadoLibre = () => {
  const [ventas, setVentas] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [autenticado, setAutenticado] = useState(false);

  const conectarConMercadoLibre = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/meli/auth`);
      const data = await res.json();

      if (data.autenticado) {
        setAutenticado(true);
        obtenerVentas();
      } else if (data.redirect) {
        // Redirige al usuario al enlace de autorización de Mercado Libre
        window.location.href = data.redirect;
      } else {
        throw new Error('No se pudo conectar con Mercado Libre.');
      }
    } catch (err) {
      setError(err.message);
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const obtenerVentas = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/meli/ventas`);
      const data = await res.json();

      if (data.ventas) {
        setVentas(data.ventas);
      } else {
        throw new Error('No se pudieron obtener las ventas.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');

    if (code) {
      console.log('🔁 Código detectado en la URL:', code);

      fetch(`${import.meta.env.VITE_BACKEND_URL}/meli/callback?code=${code}`)
        .then(res => {
          if (!res.ok) {
            console.error(`❌ Error al enviar el código (status ${res.status})`);
            return res.text().then(text => {
              console.error('🔍 Detalles del error del servidor:', text);
              throw new Error(text);
            });
          }
          return res.text();
        })
        .then(data => {
          console.log('✅ Código procesado y token guardado:', data);
          window.history.replaceState({}, document.title, window.location.pathname);
        })
        .catch(err => {
          console.error('❌ Error al autenticar en callback:', err.message || err);
        });
    } else {
      console.log('ℹ️ No hay código en la URL');
    }
  }, []);

  return (
    <div className="p-4">
      <h2 className="text-2xl font-bold mb-4">Ventas de Mercado Libre</h2>

      {!autenticado ? (
        <button
          onClick={conectarConMercadoLibre}
          className="bg-yellow-400 hover:bg-yellow-500 text-black font-semibold py-2 px-4 rounded"
        >
          Conectar con Mercado Libre
        </button>
      ) : (
        <div>
          <button
            onClick={obtenerVentas}
            className="bg-blue-500 hover:bg-blue-600 text-white py-2 px-4 rounded mb-4"
          >
            Actualizar Ventas
          </button>

          {loading && <p>Cargando ventas...</p>}
          {error && <p className="text-red-500">{error}</p>}

          <table className="w-full border border-gray-300">
            <thead>
              <tr className="bg-gray-200">
                <th className="p-2 border">ID</th>
                <th className="p-2 border">Título</th>
                <th className="p-2 border">Cantidad</th>
                <th className="p-2 border">Precio</th>
              </tr>
            </thead>
            <tbody>
              {ventas.map((venta) => (
                <tr key={venta.id}>
                  <td className="p-2 border">{venta.id}</td>
                  <td className="p-2 border">{venta.title}</td>
                  <td className="p-2 border">{venta.quantity}</td>
                  <td className="p-2 border">${venta.unit_price}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default VentasMercadoLibre;
