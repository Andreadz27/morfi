'use strict';
// Tipo de una imagen por sus primeros bytes (no por lo que dice el navegador): solo JPG, PNG y WEBP.
// Aparte de servicios/fotos-productos.js porque también lo usa Fadido Nube (nube/tienda.js), que no tiene la base del local.
function tipoImagen(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

module.exports = { tipoImagen };
