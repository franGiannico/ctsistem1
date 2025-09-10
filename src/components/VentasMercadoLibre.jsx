// File: src/components/VentasMercadoLibre.jsx

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

      if (data.redirect) {
        window.location.href = data.redirect;
      } else {
        throw new Error('No se pudo obtener la URL de autorización');
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
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/meli/sincronizar-ventas`);
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

  // Verificar si ya está autenticado cuando carga el componente
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/meli/auth`);
        const data = await res.json();
        if (data.autenticado) {
          setAutenticado(true);
          obtenerVentas();
        }
      } catch (err) {
        console.error('Error verificando autenticación:', err);
      }
    };

    checkAuth();

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
          setAutenticado(true);  // <-- importante para actualizar la UI
          obtenerVentas();
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

          <table className="min-w-full border-collapse border border-gray-300">
            <thead>
              <tr>
                <th className="border px-2 py-1">Imagen</th>
                <th className="border px-2 py-1">SKU</th>
                <th className="border px-2 py-1">Producto</th>
                <th className="border px-2 py-1">Cantidad</th>
                <th className="border px-2 py-1">Cliente</th>
                <th className="border px-2 py-1">Punto de despacho</th>
                <th className="border px-2 py-1">N° Venta</th>
              </tr>
            </thead>
            <tbody>
              {ventas.map((venta) => (
                <tr key={venta.numeroVenta}>
                  <td className="border px-2 py-1">
                    {venta.imagen && (
                      <img src={venta.imagen} alt="producto" className="w-16 h-16" />
                    )}
                  </td>
                  <td className="border px-2 py-1">{venta.sku}</td>
                  <td className="border px-2 py-1">
                    {venta.nombre}
                    {venta.atributos && venta.atributos.length > 0 && (
                      <div style={{ fontSize: "0.85em", color: "#555" }}>
                        {venta.atributos.map((attr, idx) => (
                          <div key={idx}>{attr.nombre}: {attr.valor}</div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="border px-2 py-1">{venta.cantidad}</td>
                  <td className="border px-2 py-1">{venta.cliente}</td>
                  <td className="border px-2 py-1">{venta.puntoDespacho}</td>
                  <td className="border px-2 py-1">{venta.numeroVenta}</td>
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
