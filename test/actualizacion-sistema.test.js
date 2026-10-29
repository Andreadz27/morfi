// Actualizar sin tocar la PC: el administrador pide "Actualizar ahora" (queda data/actualizar-ahora.json para el
// vigilante de Windows) y el vigilante pregunta si el local está tranquilo antes de una actualización automática.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { iniciarServidor } = require('./helpers');

let s;
before(async () => { s = await iniciarServidor(); });
after(() => s.cerrar());

test('estado y "Actualizar ahora": solo el administrador; deja el pedido para el vigilante', async () => {
  assert.equal((await s.llamar('GET', '/api/sistema/actualizacion', undefined, s.tokenVendedor))[0], 403);
  assert.equal((await s.llamar('POST', '/api/sistema/actualizar', {}, s.tokenVendedor))[0], 403);
  const [st, e] = await s.llamar('GET', '/api/sistema/actualizacion', undefined, s.tokenAdmin);
  assert.equal(st, 200);
  assert.match(e.local.corto, /^[0-9a-f]{7}$/, 'versión instalada (commit)');
  assert.deepEqual([e.pedida, e.automatica], [null, true]);
  assert.ok(Array.isArray(e.registro));

  const [stP] = await s.llamar('POST', '/api/sistema/actualizar', {}, s.tokenAdmin);
  assert.equal(stP, 202);
  const pedido = JSON.parse(fs.readFileSync(path.join(s.dataDir, 'actualizar-ahora.json'), 'utf8'));
  assert.ok(pedido.usuario_id && pedido.en);
  const [, e2] = await s.llamar('GET', '/api/sistema/actualizacion', undefined, s.tokenAdmin);
  assert.ok(e2.pedida, 'Configuración muestra que ya está pedida');
  const [aud] = await s.q("SELECT detalle FROM auditoria WHERE accion = 'actualizar_sistema'");
  assert.ok(aud);
});

test('¿local tranquilo?: solo responde a la misma PC, sin datos del negocio; pedidos abiertos o automática apagada lo impiden', async () => {
  // Por el túnel o un proxy (llega con X-Forwarded-For) no existe
  assert.equal((await s.llamar('GET', '/api/sistema/tranquilo', undefined, null, { 'X-Forwarded-For': '1.2.3.4' }))[0], 404);
  let [st, t] = await s.llamar('GET', '/api/sistema/tranquilo');
  assert.equal(st, 200);
  assert.deepEqual(Object.keys(t).sort(), ['abiertos', 'automatica', 'caja_abierta', 'minutos_sin_movimiento', 'tranquilo']);

  await s.q("UPDATE pedidos SET estado = 'pagado' WHERE estado = 'abierto'");
  await s.q("UPDATE caja SET estado = 'cerrada' WHERE estado = 'abierta'");
  await s.q("UPDATE pedidos SET creado_en = datetime('now', '-2 hours')");
  await s.q("UPDATE pagos SET fecha = datetime('now', '-2 hours')");
  [, t] = await s.llamar('GET', '/api/sistema/tranquilo');
  assert.equal(t.tranquilo, true, JSON.stringify(t));

  const [prod] = await s.q("SELECT id FROM productos WHERE activo = 1 AND precio_venta > 0 AND clase = 'venta' LIMIT 1");
  const [stN] = await s.llamar('POST', '/api/pedidos', { tipo: 'takeaway', items: [{ producto_id: prod.id, cantidad: 1 }] }, s.tokenVendedor);
  assert.equal(stN, 201);
  [, t] = await s.llamar('GET', '/api/sistema/tranquilo');
  assert.deepEqual([t.tranquilo, t.abiertos], [false, 1], 'con un pedido abierto no se actualiza');

  await s.q("UPDATE pedidos SET estado = 'pagado', creado_en = datetime('now', '-2 hours') WHERE estado = 'abierto'");
  assert.equal((await s.llamar('PUT', '/api/config', { auto_actualizar: 0 }, s.tokenAdmin))[0], 200);
  [, t] = await s.llamar('GET', '/api/sistema/tranquilo');
  assert.deepEqual([t.automatica, t.tranquilo], [false, false], 'apagada en Configuración: solo "Actualizar ahora"');
  const [, e] = await s.llamar('GET', '/api/sistema/actualizacion', undefined, s.tokenAdmin);
  assert.equal(e.automatica, false);
});
