'use strict';
// Cierre del día (servicios/cierre-dia.js): resumen en vivo de hoy, cierres guardados y "Cerrar el día" a mano.
// Lo ven y lo hacen quienes ven el historial de caja (encargado y administrador).
const {
  errorInterno, autenticar, requiere, fechaLocal, configCierre, resumenDelDia, cerrarDia, listarCierres, cierreGuardado
} = require('../contexto');

module.exports = function registrarRutas(app) {

const ruta = fn => async (req, res) => { try { await fn(req, res); } catch (err) { errorInterno(res, err); } };

// Cómo está configurado el cierre automático (hora, días, reparto de propinas)
app.get('/api/cierre/config', autenticar, requiere('caja.historial'), ruta(async (req, res) => {
  res.json(await configCierre());
}));

// Lo que va del día, en vivo (sin cerrar nada)
app.get('/api/cierre/hoy', autenticar, requiere('caja.historial'), ruta(async (req, res) => {
  res.json(await resumenDelDia(fechaLocal()));
}));

app.get('/api/cierres', autenticar, requiere('caja.historial'), ruta(async (req, res) => {
  res.json(await listarCierres());
}));

app.get('/api/cierres/:fecha', autenticar, requiere('caja.historial'), ruta(async (req, res) => {
  res.json(await cierreGuardado(req.params.fecha));
}));

// Cerrar el día a mano: si la caja sigue abierta queda "pendiente de arqueo"; repetirlo actualiza el resumen
app.post('/api/cierres', autenticar, requiere('caja.historial'), ruta(async (req, res) => {
  res.status(201).json(await cerrarDia({ fecha: fechaLocal(), usuarioId: req.usuario.id }));
}));

};
