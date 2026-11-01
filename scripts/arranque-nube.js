'use strict';
// Arranque del local en un servidor de la nube (render-local.yaml): corre antes de "npm start".
// - Si el disco ya tiene la base, no hace nada.
// - Si el disco está vacío (primer arranque o disco nuevo) y la copia en la nube está configurada (BACKUP_S3_* y
//   BACKUP_CLAVE), baja y restaura la copia más nueva. Si falla, sale con error y el servidor NO arranca: arrancar
//   con una base vacía dejaría al local sin sus datos y los próximos arranques ya no restaurarían.
// - Sin copia en la nube configurada, el servidor arranca con una base nueva (instalación desde cero).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { DATA_DIR } = require('../src/config');
const { ARCHIVO_BASE, ARCHIVOS_ANTERIORES } = require('../src/archivo-base');
const { configNube } = require('../src/servicios/copia-nube');

const hayBase = [ARCHIVO_BASE, ...ARCHIVOS_ANTERIORES].some(n => fs.existsSync(path.join(DATA_DIR, n)));
if (hayBase) {
  console.log(`[arranque] Base encontrada en ${DATA_DIR}.`);
  process.exit(0);
}
if (!configNube()) {
  console.log('[arranque] Disco vacío y sin copia en la nube configurada: se arranca con una base nueva.');
  process.exit(0);
}
console.log('[arranque] Disco vacío: se restaura la copia más nueva de la nube.');
const r = spawnSync(process.execPath, [path.join(__dirname, 'restaurar.js'), '--nube', '--ultima'], { stdio: 'inherit' });
if (r.status !== 0) {
  console.error('[arranque] No se pudo restaurar la copia: el servidor no arranca para no empezar con la base vacía.');
  process.exit(1);
}
