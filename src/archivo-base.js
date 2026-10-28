'use strict';
// Archivo de la base de datos. Con los nombres anteriores del sistema era morfi.db (Morfi) y antes
// gastromanager.db (GastroManager): al arrancar se renombra sola, antes de abrirla. Van juntos los archivos -wal y -shm (con WAL, si el servidor
// se cortó, ahí están las últimas operaciones). El principal se mueve último: si algo se interrumpe a mitad
// de camino, el próximo arranque termina el cambio.
// Sin dependencias del resto del sistema: lo usan también init-db.js y los scripts.
const fs = require('fs');
const path = require('path');

const ARCHIVO_BASE = 'fadido.db';
// De la más nueva a la más vieja: si por algún motivo quedaran las dos, se usa la de Morfi
const ARCHIVOS_ANTERIORES = ['morfi.db', 'gastromanager.db'];

function rutaBase(dir) {
  const nueva = path.join(dir, ARCHIVO_BASE);
  if (fs.existsSync(nueva)) return nueva;
  const vieja = ARCHIVOS_ANTERIORES.map(n => path.join(dir, n)).find(r => fs.existsSync(r));
  if (vieja) {
    for (const sufijo of ['-wal', '-shm', '']) {
      if (fs.existsSync(vieja + sufijo)) fs.renameSync(vieja + sufijo, nueva + sufijo);
    }
  }
  return nueva;
}

module.exports = { ARCHIVO_BASE, ARCHIVOS_ANTERIORES, rutaBase };
