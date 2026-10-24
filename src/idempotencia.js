'use strict';
// Pedidos que se reintentan sin duplicarse. El celular del mozo guarda un pedido si se corta el WiFi y lo reenvía al
// volver (public/js/cola-pedidos.js). Si el pedido había llegado pero la respuesta se perdió en el corte, el reenvío
// trae la misma clave (header X-Idempotencia) y se le devuelve la respuesta guardada: la cocina no lo recibe dos veces.
// Solo se guardan las respuestas exitosas. Con un error (mesa ocupada, sin stock...) se puede volver a intentar.
const { run, get } = require('./db');

const CLAVE_VALIDA = /^[A-Za-z0-9-]{8,64}$/;

function idempotente(req, res, next) {
  const clave = String(req.get('X-Idempotencia') || '').trim();
  if (!clave) return next();
  if (!CLAVE_VALIDA.test(clave)) return res.status(400).json({ error: 'Clave de reintento inválida' });
  const k = `${req.usuario.id}:${clave}`;
  (async () => {
    await run("DELETE FROM idempotencia WHERE creado_en < datetime('now', '-3 days')");
    const { changes } = await run('INSERT OR IGNORE INTO idempotencia (clave, ruta) VALUES (?, ?)', [k, `${req.method} ${req.originalUrl}`]);
    if (!changes) {
      const previo = await get('SELECT estado_http, respuesta FROM idempotencia WHERE clave = ?', [k]);
      if (previo && previo.respuesta !== null) {
        res.set('X-Idempotencia-Repetido', '1');
        return res.status(previo.estado_http).json(JSON.parse(previo.respuesta));
      }
      // El primer envío todavía se está procesando: el celular reintenta en unos segundos
      return res.status(409).json({ error: 'Ese pedido se está guardando, probá de nuevo en unos segundos', en_proceso: true });
    }
    const json = res.json.bind(res);
    res.json = body => {
      const ok = res.statusCode >= 200 && res.statusCode < 300;
      (ok ? run('UPDATE idempotencia SET estado_http = ?, respuesta = ? WHERE clave = ?', [res.statusCode, JSON.stringify(body), k])
        : run('DELETE FROM idempotencia WHERE clave = ?', [k])).catch(e => console.error('[idempotencia]', e.message));
      return json(body);
    };
    next();
  })().catch(next);
}

module.exports = { idempotente };
