// Antes de la suite: levanta el servidor de prueba (qa/servidor.js) y devuelve la función que lo apaga al terminar.
// Con FADIDO_QA_URL ya definida, usa ese servidor (por ejemplo, uno levantado con `node qa/servidor.js`).
'use strict';
const { levantar } = require('../servidor');

module.exports = async function preparar() {
  if (process.env.FADIDO_QA_URL) return;
  const s = await levantar();
  process.env.FADIDO_QA_URL = s.base;
  return async () => { await s.cerrar(); };
};
