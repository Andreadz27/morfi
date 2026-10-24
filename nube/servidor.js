'use strict';
// Morfi Nube: npm run nube (PORT, NUBE_DATOS, NUBE_SECRETO, TRUST_PROXY=1 detrás de un proxy con https)
const { app } = require('./app');
const { listo } = require('./db');
const { copiaSiCorresponde } = require('./copias');

const PORT = Number(process.env.PORT) || 4000;
listo.then(() => {
  app.listen(PORT, () => console.log(`[nube] Morfi Nube en http://localhost:${PORT}`));
  // Copia de la base al iniciar (si la última tiene más de 24 h) y revisión cada hora
  copiaSiCorresponde();
  setInterval(copiaSiCorresponde, 60 * 60 * 1000).unref();
}).catch(e => { console.error('[nube] No se pudo abrir la base:', e); process.exit(1); });
