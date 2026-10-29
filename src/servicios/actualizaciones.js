'use strict';
// Actualizaciones sin tocar nada en la PC del local.
// El servidor no se puede actualizar a sí mismo (la actualización lo detiene y corre como administrador). Lo hace
// el vigilante de Windows (scripts/windows/vigilar.ps1, tarea del sistema cada 5 minutos):
// - "Actualizar ahora" (administrador, en Configuración): el servidor deja el pedido en data/actualizar-ahora.json
//   y el vigilante, en la próxima vuelta, arranca la tarea "Fadido - actualizar" (con copia y vuelta atrás).
// - Automática (configuracion.auto_actualizar, encendida por defecto): si hay una versión nueva y el local está
//   tranquilo (sin pedidos abiertos, caja cerrada y 30 minutos sin movimiento), el vigilante la instala solo.
// El vigilante pregunta si el local está tranquilo en /api/sistema/tranquilo, que solo responde a la misma PC.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { run, get } = require('../db');
const { DATA_DIR } = require('../config');

const RAIZ = path.join(__dirname, '..', '..');
const PEDIDO = path.join(DATA_DIR, 'actualizar-ahora.json');
const LOG = path.join(RAIZ, 'logs', 'actualizaciones.log');
const MINUTOS_TRANQUILO = 30;
const CACHE_REMOTA_MS = 10 * 60 * 1000;

const git = args => new Promise(ok => {
  execFile('git', args, { cwd: RAIZ, timeout: 20000, windowsHide: true }, (err, stdout) => ok(err ? null : String(stdout).trim()));
});

let remota = { hash: null, en: 0 };
async function versionRemota({ refrescar = false } = {}) {
  if (!refrescar && Date.now() - remota.en < CACHE_REMOTA_MS) return remota.hash;
  const r = await git(['ls-remote', 'origin', 'refs/heads/main']);
  remota = { hash: r ? r.split(/\s+/)[0] || null : null, en: Date.now() };
  return remota.hash;
}

async function versionLocal() {
  const r = await git(['log', '-1', '--format=%H|%cI|%s']);
  if (!r) return null;
  const [hash, fecha, ...titulo] = r.split('|');
  return { hash, corto: hash.slice(0, 7), fecha, titulo: titulo.join('|') };
}

// Las últimas líneas del registro de scripts/actualizar.js (qué pasó la última vez)
function ultimasLineas(n = 8) {
  try { return fs.readFileSync(LOG, 'utf8').trim().split(/\r?\n/).slice(-n); } catch (e) { return []; }
}

const leerPedido = () => { try { return JSON.parse(fs.readFileSync(PEDIDO, 'utf8')); } catch (e) { return null; } };

async function estadoActualizacion({ refrescar = false } = {}) {
  const [local, hashRemota, c] = await Promise.all([versionLocal(), versionRemota({ refrescar }),
    get('SELECT auto_actualizar FROM configuracion WHERE id = 1')]);
  return {
    local, remota: hashRemota ? hashRemota.slice(0, 7) : null,
    hay_nueva: !!(local && hashRemota && local.hash !== hashRemota),
    pedida: leerPedido(), automatica: !c || c.auto_actualizar !== 0,
    registro: ultimasLineas()
  };
}

async function pedirActualizacion(usuarioId) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const pedido = { usuario_id: usuarioId, en: new Date().toISOString() };
  fs.writeFileSync(PEDIDO, JSON.stringify(pedido));
  await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)', [usuarioId, 'actualizar_sistema', 'Pidió actualizar el sistema ahora']);
  return pedido;
}

// Para el vigilante: ¿se puede actualizar sin molestar? (solo números, ningún dato del negocio)
async function localTranquilo() {
  const [{ n: abiertos }, caja, mov, c] = await Promise.all([
    get("SELECT COUNT(*) AS n FROM pedidos WHERE estado = 'abierto'"),
    get("SELECT 1 AS x FROM caja WHERE estado = 'abierta' LIMIT 1").catch(() => null),
    get(`SELECT CAST((julianday('now') - julianday(MAX(t))) * 24 * 60 AS INTEGER) AS min FROM (
      SELECT MAX(creado_en) AS t FROM pedidos UNION ALL SELECT MAX(fecha) FROM pagos)`),
    get('SELECT auto_actualizar FROM configuracion WHERE id = 1')
  ]);
  const sinMovimiento = mov && mov.min !== null ? mov.min : 9999;
  const automatica = !c || c.auto_actualizar !== 0;
  return {
    automatica, abiertos, caja_abierta: !!caja, minutos_sin_movimiento: sinMovimiento,
    tranquilo: automatica && abiertos === 0 && !caja && sinMovimiento >= MINUTOS_TRANQUILO
  };
}

module.exports = { estadoActualizacion, pedirActualizacion, localTranquilo, versionLocal, PEDIDO_ACTUALIZAR: PEDIDO };
