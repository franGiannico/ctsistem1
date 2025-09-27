import { useState } from 'react';

export default function FacturarVentaML() {
  const [numeroVenta, setNumeroVenta] = useState('');
  const [datosVenta, setDatosVenta] = useState(null);
  const [mensajeEnviado, setMensajeEnviado] = useState('');
  const [dniManual, setDniManual] = useState('');

  // Configuración de autenticación
  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;
  const API_TOKEN = import.meta.env.VITE_API_TOKEN || 'ctsistem-token-2024-seguro-123';

  // Función helper para requests autenticados
  const authenticatedFetch = async (url, options = {}) => {
    const defaultOptions = {
      headers: {
        'Authorization': API_TOKEN,
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    };
    
    try {
      const response = await fetch(url, defaultOptions);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response;
    } catch (error) {
      console.error('Error en request autenticado:', error);
      throw error;
    }
  };

  const buscarVenta = async () => {
    try {
      const res = await authenticatedFetch(`${BACKEND_URL}/meli/factura/${numeroVenta}`);
      const data = await res.json();
      if (data.error) {
        setDatosVenta(null);
        setMensajeEnviado('No se encontró la venta');
      } else {
        setDatosVenta(data);
        setMensajeEnviado('');
      }
    } catch (error) {
      console.error('Error buscando venta:', error);
      setDatosVenta(null);
      setMensajeEnviado('Error al buscar la venta');
    }
  };

  const enviarPorWhatsApp = () => {
    if (!datosVenta) return;

    const dniFinal = dniManual || datosVenta.dni || '---';

    const texto = `
💳 *FACTURAR VENTA ML*  
🗓️ Fecha: ${new Date().toLocaleDateString()}
🧾 Producto: ${datosVenta.producto}
📦 Unidades: ${datosVenta.cantidad}
💲 Precio final: $${datosVenta.precio}
📈 Total: $${datosVenta.total}
📑 Tipo de factura: A
🧍 DNI/CUIT: ${dniFinal}
🏢 Razón social: ${datosVenta.cliente}
👤 Tipo consumidor: ${datosVenta.tipoConsumidor || 'Consumidor Final'}
📍 Dirección: ${datosVenta.direccion || '---'}
`.trim();

    const numeroFacturacion = "5493515193175";
    const url = `https://wa.me/${numeroFacturacion}?text=${encodeURIComponent(texto)}`;
    window.open(url, '_blank');
    setMensajeEnviado('Mensaje enviado a WhatsApp');
  };

  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">Facturar Venta Mercado Libre</h2>

      <input
        type="text"
        placeholder="Número de venta ML"
        value={numeroVenta}
        onChange={(e) => setNumeroVenta(e.target.value)}
        className="border px-2 py-1 mr-2"
      />
      <button onClick={buscarVenta} className="bg-blue-500 text-white px-3 py-1 rounded">Buscar</button>

      {datosVenta && (
        <div className="mt-4 border p-4 bg-gray-50 rounded">
          <p><strong>Producto:</strong> {datosVenta.producto}</p>
          <p><strong>Cantidad:</strong> {datosVenta.cantidad}</p>
          <p><strong>Precio final:</strong> ${datosVenta.precio}</p>
          <p><strong>Total:</strong> ${datosVenta.total}</p>
          <p><strong>Cliente:</strong> {datosVenta.cliente}</p>
          
          <div className="mt-3">
            <label className="block text-sm font-medium mb-1">
              <strong>DNI/CUIT:</strong> (ML no expone el DNI real por privacidad)
            </label>
            <input
              type="text"
              placeholder="Ingrese el DNI/CUIT del cliente"
              value={dniManual}
              onChange={(e) => setDniManual(e.target.value)}
              className="border px-2 py-1 w-full"
            />
            <p className="text-xs text-gray-600 mt-1">
              Valor actual: {datosVenta.dni || '---'} (ID interno de ML)
            </p>
          </div>
          
          <p><strong>Tipo consumidor:</strong> {datosVenta.tipoConsumidor || 'Consumidor Final'}</p>
          <p><strong>Dirección:</strong> {datosVenta.direccion || '---'}</p>

          <button onClick={enviarPorWhatsApp} className="mt-4 bg-green-600 text-white px-3 py-1 rounded">
            Enviar por WhatsApp
          </button>
        </div>
      )}

      {mensajeEnviado && <p className="mt-4 text-blue-600">{mensajeEnviado}</p>}
    </div>
  );
}
