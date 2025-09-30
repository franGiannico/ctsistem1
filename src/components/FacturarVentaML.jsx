import { useState } from 'react';
import styles from './FacturarVentaML.module.css';

export default function FacturarVentaML() {
  const [numeroVenta, setNumeroVenta] = useState('');
  const [datosVenta, setDatosVenta] = useState(null);
  const [mensajeEnviado, setMensajeEnviado] = useState('');
  const [dniManual, setDniManual] = useState('');
  const [modoManual, setModoManual] = useState(false);
  const [tipoConsumidorSeleccionado, setTipoConsumidorSeleccionado] = useState('Consumidor Final');
  
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
        setMensajeEnviado(`No se encontró la venta: ${data.error}`);
      } else {
        console.log('Datos recibidos del backend:', data);
        setDatosVenta(data);
        setMensajeEnviado('');
      }
    } catch (error) {
      console.error('Error buscando venta:', error);
      setDatosVenta(null);
      if (error.message.includes('404')) {
        setMensajeEnviado(`La venta ${numeroVenta} no existe o no es accesible desde tu cuenta de ML`);
      } else {
        setMensajeEnviado(`Error al buscar la venta: ${error.message}`);
      }
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
        producto: String(datosVenta.producto || '---'),
        cantidad: String(datosVenta.cantidad || '---'),
        precio: String(datosVenta.precio || '---'),
        total: String(datosVenta.total || '---'),
        cliente: String(datosVenta.cliente || '---'),
        dni: String(dniManual || datosVenta.dni || '---'),
               tipoConsumidor: tipoConsumidorSeleccionado,
        direccion: String(datosVenta.direccion || '---'),
        ciudad: String(datosVenta.ciudad || '---')
      };
    }

           // Determinar tipo de factura según tipo de consumidor
           const tipoFactura = datosParaEnviar.tipoConsumidor === 'Consumidor Final' ? 'B' : 'A';

           const texto = `
💳 *FACTURAR VENTA${modoManual ? ' MANUAL' : ' ML'}*  
🗓️ Fecha: ${new Date().toLocaleDateString()}
🧾 Producto: ${datosParaEnviar.producto}
📦 Unidades: ${datosParaEnviar.cantidad}
💲 Precio final: $${datosParaEnviar.precio}
📈 Total: $${datosParaEnviar.total}
📑 Tipo de factura: ${tipoFactura}
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
    <div className={styles.container}>
      <h2 className={styles.title}>Facturar Venta</h2>

      {/* Toggle entre modo ML y manual */}
      <div className={styles.modeToggle}>
        <button
          onClick={() => setModoManual(false)}
          className={`${styles.modeButton} ${!modoManual ? styles.active : ''}`}
        >
          Buscar en ML
        </button>
        <button
          onClick={() => setModoManual(true)}
          className={`${styles.modeButton} ${modoManual ? styles.active : ''}`}
        >
          Cargar Manual
        </button>
      </div>

      {/* Modo búsqueda ML */}
      {!modoManual && (
        <div className={styles.searchSection}>
          <input
            type="text"
            placeholder="Número de venta ML"
            value={numeroVenta}
            onChange={(e) => setNumeroVenta(e.target.value)}
            className={styles.searchInput}
          />
          <button onClick={buscarVenta} className={styles.searchButton}>Buscar</button>
        </div>
      )}

      {/* Modo manual */}
      {modoManual && (
        <div className={styles.manualForm}>
          <h3 className={styles.formTitle}>Datos de la Venta</h3>
          
          <div className={styles.formGrid}>
            <div key="form-producto" className={styles.formGroup}>
              <label className={styles.formLabel}>Producto *</label>
              <input
                type="text"
                name="producto"
                value={datosManuales.producto}
                onChange={handleInputChange}
                className={styles.formInput}
                placeholder="Nombre del producto"
                required
              />
            </div>
            
            <div key="form-cliente" className={styles.formGroup}>
              <label className={styles.formLabel}>Cliente *</label>
              <input
                type="text"
                name="cliente"
                value={datosManuales.cliente}
                onChange={handleInputChange}
                className={styles.formInput}
                placeholder="Nombre del cliente"
                required
              />
            </div>
            
            <div key="form-cantidad" className={styles.formGroup}>
              <label className={styles.formLabel}>Cantidad *</label>
              <input
                type="number"
                name="cantidad"
                value={datosManuales.cantidad}
                onChange={(e) => {
                  handleInputChange(e);
                  setTimeout(calcularTotal, 100);
                }}
                className={styles.formInput}
                min="1"
                required
              />
            </div>
            
            <div key="form-precio" className={styles.formGroup}>
              <label className={styles.formLabel}>Precio Unitario *</label>
              <input
                type="number"
                name="precio"
                value={datosManuales.precio}
                onChange={(e) => {
                  handleInputChange(e);
                  setTimeout(calcularTotal, 100);
                }}
                className={styles.formInput}
                step="0.01"
                min="0"
                required
              />
            </div>
            
            <div key="form-total" className={styles.formGroup}>
              <label className={styles.formLabel}>Total</label>
              <input
                type="number"
                name="total"
                value={datosManuales.total}
                onChange={handleInputChange}
                className={`${styles.formInput} ${styles.readonly}`}
                step="0.01"
                readOnly
              />
            </div>
            
            <div key="form-dni" className={styles.formGroup}>
              <label className={styles.formLabel}>DNI/CUIT</label>
              <input
                type="text"
                name="dni"
                value={datosManuales.dni}
                onChange={handleInputChange}
                className={styles.formInput}
                placeholder="DNI o CUIT del cliente"
              />
            </div>
            
            <div key="form-tipo-consumidor" className={styles.formGroup}>
              <label className={styles.formLabel}>Tipo de Consumidor</label>
              <select
                name="tipoConsumidor"
                value={datosManuales.tipoConsumidor}
                onChange={handleInputChange}
                className={styles.formSelect}
              >
                <option value="Consumidor Final">Consumidor Final</option>
                <option value="Responsable Inscripto">Responsable Inscripto</option>
                <option value="Monotributo">Monotributo</option>
                <option value="Exento">Exento</option>
              </select>
            </div>
            
            <div key="form-direccion" className={styles.formGroup}>
              <label className={styles.formLabel}>Dirección</label>
              <input
                type="text"
                name="direccion"
                value={datosManuales.direccion}
                onChange={handleInputChange}
                className={styles.formInput}
                placeholder="Dirección del cliente"
              />
            </div>
            
            <div key="form-ciudad" className={styles.formGroup}>
              <label className={styles.formLabel}>Ciudad</label>
              <input
                type="text"
                name="ciudad"
                value={datosManuales.ciudad}
                onChange={handleInputChange}
                className={styles.formInput}
                placeholder="Ciudad del cliente"
              />
            </div>
          </div>
          
          <button 
            onClick={enviarPorWhatsApp} 
            className={styles.submitButton}
          >
            Enviar por WhatsApp
          </button>
        </div>
      )}

      {/* Mostrar datos de ML solo cuando no esté en modo manual */}
      {!modoManual && datosVenta && (
        <div className={styles.mlDataSection}>
          <h3 className={styles.mlDataTitle}>Datos de la Venta ML</h3>
          
          <div className={styles.dataGrid}>
            <div key="producto" className={styles.dataItem}>
              <div className={styles.dataLabel}>Producto</div>
              <div className={styles.dataValue}>{String(datosVenta.producto || '---')}</div>
            </div>
            <div key="cantidad" className={styles.dataItem}>
              <div className={styles.dataLabel}>Cantidad</div>
              <div className={styles.dataValue}>{String(datosVenta.cantidad || '---')}</div>
            </div>
            <div key="precio" className={styles.dataItem}>
              <div className={styles.dataLabel}>Precio Final</div>
              <div className={styles.dataValue}>${String(datosVenta.precio || '---')}</div>
            </div>
            <div key="total" className={styles.dataItem}>
              <div className={styles.dataLabel}>Total</div>
              <div className={styles.dataValue}>${String(datosVenta.total || '---')}</div>
            </div>
            <div key="cliente" className={styles.dataItem}>
              <div className={styles.dataLabel}>Cliente</div>
              <div className={styles.dataValue}>{String(datosVenta.cliente || '---')}</div>
            </div>
            <div key="tipo-consumidor" className={styles.dataItem}>
              <div className={styles.dataLabel}>Tipo Consumidor</div>
              <select
                value={tipoConsumidorSeleccionado}
                onChange={(e) => setTipoConsumidorSeleccionado(e.target.value)}
                className={styles.tipoConsumidorSelect}
              >
                <option value="Consumidor Final">Consumidor Final</option>
                <option value="Responsable Inscripto">Responsable Inscripto</option>
                <option value="Monotributo">Monotributo</option>
                <option value="Exento">Exento</option>
              </select>
            </div>
            <div key="direccion" className={styles.dataItem}>
              <div className={styles.dataLabel}>Dirección</div>
              <div className={styles.dataValue}>{String(datosVenta.direccion || '---')}</div>
            </div>
            <div key="ciudad" className={styles.dataItem}>
              <div className={styles.dataLabel}>Ciudad</div>
              <div className={styles.dataValue}>{String(datosVenta.ciudad || '---')}</div>
            </div>
          </div>
          
          <div className={styles.dniSection}>
            <div className={styles.dniLabel}>
              DNI/CUIT (ML no expone el DNI real por privacidad)
            </div>
            <input
              type="text"
              placeholder="Ingrese el DNI/CUIT del cliente"
              value={dniManual}
              onChange={(e) => setDniManual(e.target.value)}
              className={styles.dniInput}
            />
            <div className={styles.dniNote}>
              Valor actual: {datosVenta.dni || '---'} (ID interno de ML)
            </div>
          </div>

          <button onClick={enviarPorWhatsApp} className={styles.whatsappButton}>
            Enviar por WhatsApp
          </button>
        </div>
      )}

      {mensajeEnviado && (
        <div className={`${styles.message} ${
          mensajeEnviado.includes('enviado') ? styles.success : 
          mensajeEnviado.includes('Error') ? styles.error : 
          styles.info
        }`}>
          {mensajeEnviado}
        </div>
      )}
    </div>
  );
}
