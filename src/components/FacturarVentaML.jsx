import { useState } from 'react';

export default function FacturarVentaML() {
  const [numeroVenta, setNumeroVenta] = useState('');
  const [datosVenta, setDatosVenta] = useState(null);
  const [mensajeEnviado, setMensajeEnviado] = useState('');

  const buscarVenta = async () => {
    const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/meli/factura/${numeroVenta}`);
    const data = await res.json();
    if (data.error) {
      setDatosVenta(null);
      setMensajeEnviado('No se encontró la venta');
    } else {
      setDatosVenta(data);
      setMensajeEnviado('');
    }
  };

  const enviarPorWhatsApp = () => {
    if (!datosVenta) return;

    const texto = `
💳 *FACTURAR VENTA ML*  
🗓️ Fecha: ${new Date().toLocaleDateString()}
🧾 Producto: ${datosVenta.producto}
📦 Unidades: ${datosVenta.cantidad}
💲 Precio final: $${datosVenta.precio}
📈 Total: $${datosVenta.total}
📑 Tipo de factura: A
🧍 DNI/CUIT: ${datosVenta.dni || '---'}
🏢 Razón social: ${datosVenta.cliente}
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
          <p><strong>CUIT/DNI:</strong> {datosVenta.dni || '---'}</p>
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
