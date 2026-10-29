'use strict';
// Actualizar el sistema sin tocar la PC (servicios/actualizaciones.js y scripts/windows/vigilar.ps1)
const { errorInterno, autenticar, esAdmin } = require('../contexto');
const { estadoActualizacion, pedirActualizacion, localTranquilo } = require('../servicios/actualizaciones');

// Solo la misma PC (el vigilante), sin pasar por el túnel ni un proxy: ahí llega con X-Forwarded-For
const desdeEstaPC = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) &&
  !req.headers['x-forwarded-for'] && !req.headers['cf-connecting-ip'];

module.exports = function registrarRutas(app) {

app.get('/api/sistema/actualizacion', autenticar, esAdmin, async (req, res) => {
  try { res.json(await estadoActualizacion({ refrescar: req.query.refrescar === '1' })); } catch (err) { errorInterno(res, err); }
});

app.post('/api/sistema/actualizar', autenticar, esAdmin, async (req, res) => {
  try { res.status(202).json({ ok: true, pedido: await pedirActualizacion(req.usuario.id) }); } catch (err) { errorInterno(res, err); }
});

app.get('/api/sistema/tranquilo', async (req, res) => {
  if (!desdeEstaPC(req)) return res.status(404).json({ error: 'No encontrado' });
  try { res.json(await localTranquilo()); } catch (err) { errorInterno(res, err); }
});

};
