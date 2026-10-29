'use strict';
// Fotos de los platos para la carta (una por producto).
// - Se guardan en la base (tabla producto_fotos): así entran en las copias de seguridad y en la nube.
//   Llegan achicadas desde el navegador (~1200 px, ~200 KB); el tope por foto es MAX_BYTES.
// - El tipo se decide por los primeros bytes, no por lo que dice el navegador: solo JPG, PNG y WEBP.
// - La carta pública las pide con ?v=<versión>: cambiar la foto cambia la dirección, así el celular no muestra la vieja.
const { run, get } = require('../db');
const { errorHttp } = require('../util');

const MAX_BYTES = 2 * 1024 * 1024;

function tipoImagen(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

async function guardarFoto(productoId, datos, usuarioId) {
  if (!Buffer.isBuffer(datos) || !datos.length) throw errorHttp(400, 'No llegó la foto');
  if (datos.length > MAX_BYTES) throw errorHttp(413, 'La foto es muy grande (hasta 2 MB)');
  const tipo = tipoImagen(datos);
  if (!tipo) throw errorHttp(400, 'Formato no admitido: subí una foto JPG, PNG o WEBP');
  const p = await get('SELECT id, nombre FROM productos WHERE id = ? AND activo = 1', [productoId]);
  if (!p) throw errorHttp(404, 'Producto no encontrado');
  await run(`INSERT INTO producto_fotos (producto_id, tipo, tamano, datos, version) VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(producto_id) DO UPDATE SET tipo = excluded.tipo, tamano = excluded.tamano, datos = excluded.datos,
      version = producto_fotos.version + 1, actualizado_en = CURRENT_TIMESTAMP`, [p.id, tipo, datos.length, datos]);
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
