// backend/services/ventasSync.js
// Guarda las ventas que vienen de una plataforma (Mercado Libre / Tiendanube)
// SIN borrarlas y volver a crearlas.
//
// Antes cada sincronización hacía deleteMany + insertMany. Eso cambiaba el _id de
// todas las ventas, así que:
//   - el navegador seguía con los _id viejos y al tildar o guardar una nota la
//     venta "no existía" (404),
//   - se perdían las notas escritas a mano (y, en Tiendanube, también las tildas).
//
// Ahora se actualiza cada venta por su numeroVenta (upsert):
//   - Los datos que vienen de la plataforma (producto, cliente, envío, imagen...)
//     se refrescan en cada sincronización.
//   - completada / entregada y la nota escrita a mano NO se pisan nunca.
//   - La nota que trae la plataforma solo se usa mientras nadie la haya editado
//     (campo notaEditada).
//   - Las ventas de esa plataforma que ya no aparecen (despachadas, canceladas...)
//     se eliminan, igual que antes.

const Venta = require('../models/Venta');

/**
 * @param {Object}   opciones
 * @param {Object}   opciones.filtro   Qué ventas pertenecen a la plataforma. Ej: { esML: true }
 * @param {Object[]} opciones.ventas   Ventas actuales de la plataforma (objetos planos).
 * @param {string[]} [opciones.mantener] numeroVenta que NO deben borrarse aunque no estén
 *                                       en "ventas" (ej. si falló la consulta de su envío).
 */
async function guardarVentasSincronizadas({ filtro, ventas, mantener = [] }) {
  const operaciones = [];

  for (const venta of ventas) {
    // Estos campos son del usuario: nunca se pisan con lo que viene de la plataforma.
    // eslint-disable-next-line no-unused-vars
    const { nota, completada, entregada, notaEditada, _id, ...datos } = venta;
    const notaPlataforma = nota || '';

    // 1) Crear si no existe / refrescar los datos de la plataforma si ya existe
    operaciones.push({
      updateOne: {
        filter: { numeroVenta: datos.numeroVenta },
        update: {
          $set: datos,
          $setOnInsert: {
            completada: false,
            entregada: false,
            nota: notaPlataforma,
            notaEditada: false,
          },
        },
        upsert: true,
      },
    });

    // 2) Actualizar la nota de la plataforma solo si el usuario no la editó
    operaciones.push({
      updateOne: {
        filter: { numeroVenta: datos.numeroVenta, notaEditada: { $ne: true } },
        update: { $set: { nota: notaPlataforma } },
      },
    });
  }

  if (operaciones.length > 0) {
    try {
      await Venta.bulkWrite(operaciones, { ordered: false });
    } catch (error) {
      // Dos sincronizaciones simultáneas pueden chocar por el índice único de
      // numeroVenta (E11000): el resto de las operaciones igual se aplica.
      const soloDuplicados =
        error?.writeErrors?.length > 0 && error.writeErrors.every((e) => e?.err?.code === 11000 || e?.code === 11000);
      if (!soloDuplicados) throw error;
      console.warn('⚠️ Sincronización: se ignoraron duplicados simultáneos.');
    }
  }

  // Quitar las de esta plataforma que ya no corresponden
  const conservar = [...ventas.map((v) => v.numeroVenta), ...mantener];
  const borradas = await Venta.deleteMany({
    ...filtro,
    numeroVenta: { $nin: conservar },
  });

  return { guardadas: ventas.length, eliminadas: borradas.deletedCount || 0 };
}

module.exports = { guardarVentasSincronizadas };
