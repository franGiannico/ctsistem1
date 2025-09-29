import { useState } from 'react';

export default function FacturarVentaML() {
  const [numeroVenta, setNumeroVenta] = useState('');
  const [datosVenta, setDatosVenta] = useState(null);
  const [mensajeEnviado, setMensajeEnviado] = useState('');
  const [dniManual, setDniManual] = useState('');
  const [modoManual, setModoManual] = useState(false);
  
  // Estados para formulario manual
  const [datosManuales, setDatosManuales] = useState({
    producto: '',
    cantidad: 1,
    precio: '',
    total: '',
    cliente: '',
    dni: '',
    tipoConsumidor: 'Consumidor Final',
    direccion: '',
    ciudad: ''
  });

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

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setDatosManuales(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const calcularTotal = () => {
    const cantidad = parseFloat(datosManuales.cantidad) || 0;
    const precio = parseFloat(datosManuales.precio) || 0;
    const total = cantidad * precio;
    setDatosManuales(prev => ({
      ...prev,
      total: total.toString()
    }));
  };

  const enviarPorWhatsApp = () => {
    let datosParaEnviar;
    
    if (modoManual) {
      // Validar campos requeridos
      if (!datosManuales.producto || !datosManuales.cantidad || !datosManuales.precio || !datosManuales.cliente) {
        setMensajeEnviado('Por favor complete todos los campos requeridos');
        return;
      }
      datosParaEnviar = datosManuales;
    } else {
      if (!datosVenta) return;
      datosParaEnviar = {
        producto: datosVenta.producto,
        cantidad: datosVenta.cantidad,
        precio: datosVenta.precio,
        total: datosVenta.total,
        cliente: datosVenta.cliente,
        dni: dniManual || datosVenta.dni || '---',
        tipoConsumidor: datosVenta.tipoConsumidor || 'Consumidor Final',
        direccion: datosVenta.direccion || '---',
        ciudad: datosVenta.ciudad || '---'
      };
    }

    const texto = `
💳 *FACTURAR VENTA${modoManual ? ' MANUAL' : ' ML'}*  
🗓️ Fecha: ${new Date().toLocaleDateString()}
🧾 Producto: ${datosParaEnviar.producto}
📦 Unidades: ${datosParaEnviar.cantidad}
💲 Precio final: $${datosParaEnviar.precio}
📈 Total: $${datosParaEnviar.total}
📑 Tipo de factura: A
🧍 DNI/CUIT: ${datosParaEnviar.dni}
🏢 Razón social: ${datosParaEnviar.cliente}
👤 Tipo consumidor: ${datosParaEnviar.tipoConsumidor}
📍 Dirección: ${datosParaEnviar.direccion}
🏙️ Ciudad: ${datosParaEnviar.ciudad}
`.trim();

    const numeroFacturacion = "5493515193175";
    const url = `https://wa.me/${numeroFacturacion}?text=${encodeURIComponent(texto)}`;
    window.open(url, '_blank');
    setMensajeEnviado('Mensaje enviado a WhatsApp');
  };

  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">Facturar Venta</h2>

      {/* Toggle entre modo ML y manual */}
      <div className="mb-4">
        <button
          onClick={() => setModoManual(false)}
          className={`px-4 py-2 rounded-l ${!modoManual ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
        >
          Buscar en ML
        </button>
        <button
          onClick={() => setModoManual(true)}
          className={`px-4 py-2 rounded-r ${modoManual ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
        >
          Cargar Manual
        </button>
      </div>

      {/* Modo búsqueda ML */}
      {!modoManual && (
        <div className="mb-4">
          <input
            type="text"
            placeholder="Número de venta ML"
            value={numeroVenta}
            onChange={(e) => setNumeroVenta(e.target.value)}
            className="border px-2 py-1 mr-2"
          />
          <button onClick={buscarVenta} className="bg-blue-500 text-white px-3 py-1 rounded">Buscar</button>
        </div>
      )}

      {/* Modo manual */}
      {modoManual && (
        <div className="border p-4 bg-gray-50 rounded mb-4">
          <h3 className="text-lg font-semibold mb-3">Datos de la Venta</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Producto *</label>
              <input
                type="text"
                name="producto"
                value={datosManuales.producto}
                onChange={handleInputChange}
                className="border px-2 py-1 w-full"
                placeholder="Nombre del producto"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-1">Cliente *</label>
              <input
                type="text"
                name="cliente"
                value={datosManuales.cliente}
                onChange={handleInputChange}
                className="border px-2 py-1 w-full"
                placeholder="Nombre del cliente"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-1">Cantidad *</label>
              <input
                type="number"
                name="cantidad"
                value={datosManuales.cantidad}
                onChange={(e) => {
                  handleInputChange(e);
                  setTimeout(calcularTotal, 100); // Calcular total después del cambio
                }}
                className="border px-2 py-1 w-full"
                min="1"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-1">Precio Unitario *</label>
              <input
                type="number"
                name="precio"
                value={datosManuales.precio}
                onChange={(e) => {
                  handleInputChange(e);
                  setTimeout(calcularTotal, 100); // Calcular total después del cambio
                }}
                className="border px-2 py-1 w-full"
                step="0.01"
                min="0"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-1">Total</label>
              <input
                type="number"
                name="total"
                value={datosManuales.total}
                onChange={handleInputChange}
                className="border px-2 py-1 w-full bg-gray-100"
                step="0.01"
                readOnly
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-1">DNI/CUIT</label>
              <input
                type="text"
                name="dni"
                value={datosManuales.dni}
                onChange={handleInputChange}
                className="border px-2 py-1 w-full"
                placeholder="DNI o CUIT del cliente"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-1">Tipo de Consumidor</label>
              <select
                name="tipoConsumidor"
                value={datosManuales.tipoConsumidor}
                onChange={handleInputChange}
                className="border px-2 py-1 w-full"
              >
                <option value="Consumidor Final">Consumidor Final</option>
                <option value="Responsable Inscripto">Responsable Inscripto</option>
                <option value="Monotributo">Monotributo</option>
                <option value="Exento">Exento</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-1">Dirección</label>
              <input
                type="text"
                name="direccion"
                value={datosManuales.direccion}
                onChange={handleInputChange}
                className="border px-2 py-1 w-full"
                placeholder="Dirección del cliente"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-1">Ciudad</label>
              <input
                type="text"
                name="ciudad"
                value={datosManuales.ciudad}
                onChange={handleInputChange}
                className="border px-2 py-1 w-full"
                placeholder="Ciudad del cliente"
              />
            </div>
          </div>
          
          <button 
            onClick={enviarPorWhatsApp} 
            className="mt-4 bg-green-600 text-white px-4 py-2 rounded"
          >
            Enviar por WhatsApp
          </button>
        </div>
      )}

      {/* Mostrar datos de ML solo cuando no esté en modo manual */}
      {!modoManual && datosVenta && (
        <div className="mt-4 border p-4 bg-gray-50 rounded">
          <h3 className="text-lg font-semibold mb-3">Datos de la Venta ML</h3>
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
          <p><strong>Ciudad:</strong> {datosVenta.ciudad || '---'}</p>

          <button onClick={enviarPorWhatsApp} className="mt-4 bg-green-600 text-white px-3 py-1 rounded">
            Enviar por WhatsApp
          </button>
        </div>
      )}

      {mensajeEnviado && <p className="mt-4 text-blue-600">{mensajeEnviado}</p>}
    </div>
  );
}
