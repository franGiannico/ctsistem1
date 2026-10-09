// src/utils/leerPdf.js
// Extrae el texto de un PDF en el navegador (pdf.js) y lo devuelve en líneas.
// pdf.js se carga recién cuando se suelta un PDF, para no pesar en el resto de la app.

import { agruparItemsEnLineas } from './comprobanteVenta.js';

export async function extraerTextoPdf(archivo) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const datos = new Uint8Array(await archivo.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data: datos }).promise;

  const paginas = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const pagina = await pdf.getPage(n);
    const contenido = await pagina.getTextContent();
    paginas.push(agruparItemsEnLineas(contenido.items));
  }
  return paginas.join('\n');
}
