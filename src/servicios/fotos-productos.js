'use strict';
// Fotos de los platos para la carta (una por producto).
// - Se guardan en la base (tabla producto_fotos): así entran en las copias de seguridad y en la nube.
//   Llegan achicadas desde el navegador (~1200 px, ~200 KB); el tope por foto es MAX_BYTES.
// - El tipo se decide por los primeros bytes, no por lo que dice el navegador: solo JPG, PNG y WEBP.
// - La carta pública las pide con ?v=<versión>: cambiar la foto cambia la dirección, así el celular no muestra la vieja.
const { run, get } = require('../db');
const { errorHttp } = require('../util');
const { tipoImagen } = require('../tipo-imagen');

const MAX_BYTES = 2 * 1024 * 1024;

async function guardarFoto(productoId, datos, usuarioId) {
  if (!Buffer.isBuffer(datos) || !datos.length) throw errorHttp(400, 'No llegó la foto');
  if (datos.length > MAX_BYTES) throw errorHttp(413, 'La foto es muy grande (hasta 2 MB)');
  const tipo = tipoImagen(datos);
  if (!tipo) throw errorHttp(400, 'Formato no admitido: subí una foto JPG, PNG o WEBP');
  const p = await get('SELECT id, nombre FROM productos WHERE id = ? AND activo = 1', [productoId]);
  if (!p) throw errorHttp(404, 'Producto no encontrado');
  // La versión es la hora (ms) y nunca baja: quitar la foto y subir otra no repite un ?v= que el celular ya guardó
  await run(`INSERT INTO producto_fotos (producto_id, tipo, tamano, datos, version) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(producto_id) DO UPDATE SET tipo = excluded.tipo, tamano = excluded.tamano, datos = excluded.datos,
      version = MAX(producto_fotos.version + 1, excluded.version), actualizado_en = CURRENT_TIMESTAMP`, [p.id, tipo, datos.length, datos, Date.now()]);
  await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)', [usuarioId, 'foto_producto', `Foto de ${p.nombre}`]);
  return { producto_id: p.id, tipo, tamano: datos.length, foto: (await get('SELECT version FROM producto_fotos WHERE producto_id = ?', [p.id])).version };
}

async function borrarFoto(productoId, usuarioId) {
  const r = await run('DELETE FROM producto_fotos WHERE producto_id = ?', [productoId]);
  if (!r.changes) throw errorHttp(404, 'El producto no tiene foto');
  await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)', [usuarioId, 'foto_producto', `Quitó la foto del producto #${productoId}`]);
}

// Solo de productos que están en la carta: la de uno dado de baja o un insumo no se sirve
async function fotoPublica(productoId) {
  const f = await get(`SELECT f.tipo, f.datos FROM producto_fotos f JOIN productos p ON p.id = f.producto_id
    WHERE f.producto_id = ? AND p.activo = 1 AND p.clase = 'venta'`, [productoId]);
  if (!f) throw errorHttp(404, 'Sin foto');
  return f;
}

module.exports = { MAX_BYTES, tipoImagen, guardarFoto, borrarFoto, fotoPublica };
