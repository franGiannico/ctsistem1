// src/utils/comprobanteVenta.js
// Lee el "Detalle de venta" que imprime el sistema de stock de la tienda
// (texto copiado del PDF, o texto extraído del PDF) y devuelve los datos
// necesarios para cargar la venta. Ignora el membrete (dirección, teléfono,
// CUIT, web, etc.).
//
// El texto puede venir con distinto orden de líneas según cómo se copie, por eso:
//  - Si trae la sección "RETIRO DE PRODUCTOS" (tabla CODIGO / PRODUCTO / CANTIDAD,
//    una fila por producto), se usa esa, y se verifica contra "Total de Productos".
//  - Si no, se usa la tabla principal (Codigo / Descripcion / Precio / Cantidad...),
//    donde cada producto termina en la línea con precio, cantidad, descuento y subtotal.

const MONTO = String.raw`\$\s*[\d.]+(?:,\d+)?`;
const BLOQUE_PRECIOS = new RegExp(
  `${MONTO}\\s+(\\d+(?:[.,]\\d+)?)\\s+${MONTO}\\s+${MONTO}`
);

const normalizarEspacios = (t) => String(t || '').replace(/\s+/g, ' ').trim();

const aCantidad = (valor) => {
  const n = parseFloat(String(valor).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 1;
};

export const esComprobanteDeVenta = (texto) =>
  /Detalle de venta/i.test(texto) ||
  (/Codigo\s+Descripcion\s+Precio\s+Cantidad/i.test(texto) && /Nro\.?\s*:/i.test(texto)) ||
  /RETIRO DE PRODUCTOS/i.test(texto);

// Tabla "RETIRO DE PRODUCTOS": CODIGO  PRODUCTO  CANTIDAD (una fila por producto)
const productosDeRetiro = (lineas) => {
  const idxEncabezado = lineas.findIndex((l) => /^CODIGO\s+PRODUCTO\s+CANTIDAD/i.test(l));
  if (idxEncabezado === -1) return [];

  const productos = [];
  let acumulado = '';

  for (let i = idxEncabezado + 1; i < lineas.length; i++) {
    const linea = lineas[i];
    if (/^Firma\b/i.test(linea)) break;

    acumulado = normalizarEspacios(`${acumulado} ${linea}`);
    // Fila completa = código, descripción y cantidad entera al final
    const m = acumulado.match(/^(\S+)\s+(.+?)\s+(\d+(?:[.,]\d+)?)$/);
    if (m) {
      productos.push({ sku: m[1], nombre: m[2].trim(), cantidad: aCantidad(m[3]) });
      acumulado = '';
    }
  }
  return productos;
};

// Tabla principal: cada producto termina en la línea con precio / cantidad / descuento / subtotal
const productosDeTablaPrincipal = (lineas) => {
  const idxEncabezado = lineas.findIndex((l) => /^Codigo\s+Descripcion\s+Precio\s+Cantidad/i.test(l));
  if (idxEncabezado === -1) return [];

  const productos = [];
  let acumulado = '';

  for (let i = idxEncabezado + 1; i < lineas.length; i++) {
    const linea = lineas[i];
    if (/^Descuento\s+Gral/i.test(linea) || /^Total\s+Descuentos/i.test(linea)) break;

    acumulado = normalizarEspacios(`${acumulado} ${linea}`);
    const m = acumulado.match(BLOQUE_PRECIOS);
    if (m) {
      const antes = normalizarEspacios(acumulado.slice(0, m.index));
      const partes = antes.match(/^(\S+)\s*(.*)$/);
      if (partes) {
        productos.push({
          sku: partes[1],
          nombre: partes[2].trim() || partes[1],
          cantidad: aCantidad(m[1]),
        });
      }
      acumulado = '';
    }
  }
  return productos;
};

export function parsearComprobanteVenta(texto) {
  const lineas = String(texto || '')
    .split(/\r?\n/)
    .map(normalizarEspacios)
    .filter(Boolean);

  const plano = lineas.join('\n');

  // Número de comprobante: "Nro.: 5005"
  const nro = (plano.match(/Nro\.?\s*:\s*(\d+)/i) || [])[1] || '';

  // Cliente: preferimos el nombre completo de la sección de retiro
  // ("Cliente : GOMEZ FABIAN ALEJANDRO Nro. : 5005"); si no está, usamos el del
  // encabezado y le sumamos la continuación si el nombre se cortó en dos líneas.
  let cliente = '';
  const clienteRetiro = plano.match(/Cliente\s*:\s*(.+?)\s+Nro\.?\s*:/i);
  if (clienteRetiro) {
    cliente = clienteRetiro[1].trim();
  } else {
    const idx = lineas.findIndex((l) => /^Cliente\s*:/i.test(l));
    if (idx !== -1) {
      cliente = lineas[idx].replace(/^Cliente\s*:\s*/i, '').trim();
      const siguiente = lineas[idx + 1] || '';
      // a) El resto del nombre en su propia línea (todo en mayúsculas, sin etiquetas)
      if (/^[A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ .'-]{1,40}$/.test(siguiente) && !/(CUIT|DNI|TEL|FECHA|SUCURSAL)/.test(siguiente)) {
        cliente = `${cliente} ${siguiente}`;
      } else {
        // b) El resto del nombre quedó pegado al final de la línea de la dirección
        const cola = siguiente.match(/Argentina\s+([A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ .'-]{1,40})$/);
        if (cola) cliente = `${cliente} ${cola[1].trim()}`;
      }
    }
  }
  cliente = normalizarEspacios(cliente);

  // Sucursal y tipo de venta
  const sucursalMatch = plano.match(/Sucursal\s*:\s*([^\n]+)/i);
  const sucursal = sucursalMatch
    ? normalizarEspacios(sucursalMatch[1].replace(/\s+Total de Productos.*$/i, ''))
    : '';
  const tipoVenta = ((plano.match(/C\.\s*Venta\s*:\s*([^\n]+?)(?:\s+Sucursal|\n|$)/i) || [])[1] || '').trim();

  // Productos
  const totalDeclarado = parseInt((plano.match(/Total de Productos\s*:?\s*(\d+)/i) || [])[1], 10) || null;
  let productos = productosDeRetiro(lineas);
  const retiroCoincide = productos.length > 0 && (!totalDeclarado || productos.length === totalDeclarado);
  if (!retiroCoincide) {
    const principal = productosDeTablaPrincipal(lineas);
    if (principal.length > 0) productos = principal;
  }

  if (productos.length === 0) {
    return {
      error:
        'No se detectó ningún producto en el comprobante. Probá copiar también la sección "RETIRO DE PRODUCTOS" o la tabla "Codigo Descripcion Precio Cantidad...".',
    };
  }

  return { nro, cliente, sucursal, tipoVenta, productos };
}

// Une los fragmentos de texto que devuelve pdf.js en líneas, ordenadas de arriba
// hacia abajo y de izquierda a derecha.
// items: [{ str, transform: [a, b, c, d, x, y] }]
export function agruparItemsEnLineas(items, tolerancia = 3) {
  const fragmentos = items
    .filter((it) => it && typeof it.str === 'string' && it.str.trim() !== '')
    .map((it) => ({
      texto: it.str,
      x: it.transform[4],
      y: it.transform[5],
      ancho: it.width || 0,
    }))
    .sort((a, b) => b.y - a.y || a.x - b.x);

  const lineas = [];
  for (const f of fragmentos) {
    const ultima = lineas[lineas.length - 1];
    if (ultima && Math.abs(ultima.y - f.y) <= tolerancia) {
      ultima.frags.push(f);
    } else {
      lineas.push({ y: f.y, frags: [f] });
    }
  }

  return lineas
    .map((linea) =>
      linea.frags
        .sort((a, b) => a.x - b.x)
        .map((f) => f.texto)
        .join(' ')
    )
    .map(normalizarEspacios)
    .filter(Boolean)
    .join('\n');
}
