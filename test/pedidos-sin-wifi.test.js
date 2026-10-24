// Pedidos que el celular del mozo guarda sin WiFi y reenvía al volver: el reenvío no duplica (X-Idempotencia)
// y un pedido de mesa que choca con uno ya abierto en esa mesa se suma a él (sumar_si_mesa_abierta).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciarServidor } = require('./helpers');

let s, prod, mesas;
before(async () => {
  s = await iniciarServidor();
  [prod] = await s.q('SELECT id, precio_venta FROM productos WHERE activo = 1 ORDER BY id LIMIT 1');
  mesas = (await s.q('SELECT id FROM mesas ORDER BY id DESC LIMIT 3')).map(m => m.id);
});
after(async () => { await s.cerrar(); });

const conClave = (metodo, ruta, body, clave) => s.llamar(metodo, ruta, body, s.tokenVendedor, { 'X-Idempotencia': clave });
const cuantos = async (sql, p) => (await s.q(sql, p))[0].n;

test('el mismo pedido reenviado con la misma clave se guarda una sola vez', async () => {
  const body = { tipo: 'takeaway', cliente: 'Reenvío', items: [{ producto_id: prod.id, cantidad: 1 }] };
  const [st1, p1] = await conClave('POST', '/api/pedidos', body, 'clave-pedido-0001');
  const [st2, p2] = await conClave('POST', '/api/pedidos', body, 'clave-pedido-0001');
  assert.deepEqual([st1, st2], [201, 201]);
  assert.equal(p2.id, p1.id, 'el reenvío devuelve el mismo pedido');
  assert.equal(await cuantos("SELECT COUNT(*) n FROM pedidos WHERE cliente = 'Reenvío'"), 1);

  // Otra clave es otro pedido
  const [, p3] = await conClave('POST', '/api/pedidos', body, 'clave-pedido-0002');
  assert.notEqual(p3.id, p1.id);

  // Agregado reenviado: un solo ítem
  const item = { producto_id: prod.id, cantidad: 2 };
  await conClave('POST', `/api/pedidos/${p1.id}/items`, item, 'clave-item-00001');
  await conClave('POST', `/api/pedidos/${p1.id}/items`, item, 'clave-item-00001');
  assert.equal(await cuantos('SELECT COUNT(*) n FROM pedido_items WHERE pedido_id = ?', [p1.id]), 2);
});

test('un envío que falló no queda guardado: con la misma clave se puede reintentar', async () => {
  const [st1] = await conClave('POST', '/api/pedidos', { tipo: 'salon', mesa_id: 999999, items: [{ producto_id: prod.id, cantidad: 1 }] }, 'clave-error-0001');
  assert.equal(st1, 400);
  const [st2, p] = await conClave('POST', '/api/pedidos', { tipo: 'takeaway', cliente: 'Reintento', items: [{ producto_id: prod.id, cantidad: 1 }] }, 'clave-error-0001');
  assert.equal(st2, 201, JSON.stringify(p));
  assert.equal((await conClave('POST', '/api/pedidos', {}, 'mala clave!'))[0], 400, 'clave inválida');
});

test('pedido guardado sin WiFi para una mesa que ya se abrió: se suma a ese pedido', async () => {
  const [, abierto] = await s.llamar('POST', '/api/pedidos', { tipo: 'salon', mesa_id: mesas[0], items: [{ producto_id: prod.id, cantidad: 1 }] }, s.tokenVendedor);
  const otro = { tipo: 'salon', mesa_id: mesas[0], items: [{ producto_id: prod.id, cantidad: 2, notas: 'sin sal' }] };
  assert.equal((await s.llamar('POST', '/api/pedidos', otro, s.tokenVendedor))[0], 409, 'sin la marca, sigue el aviso de mesa ocupada');

  const [st, r] = await conClave('POST', '/api/pedidos', { ...otro, sumar_si_mesa_abierta: true }, 'clave-mesa-00001');
  assert.equal(st, 201, JSON.stringify(r));
  assert.equal(r.id, abierto.id);
  assert.equal(r.agregado_a_mesa, true);
  assert.equal(r.total, prod.precio_venta * 3);
  assert.equal(await cuantos("SELECT COUNT(*) n FROM pedidos WHERE mesa_id = ? AND estado = 'abierto'", [mesas[0]]), 1);
  const [{ notas }] = await s.q('SELECT notas FROM pedido_items WHERE pedido_id = ? ORDER BY id DESC LIMIT 1', [abierto.id]);
  assert.equal(notas, 'sin sal');
  // Reenviado otra vez (se perdió la respuesta): no se suma de nuevo
  await conClave('POST', '/api/pedidos', { ...otro, sumar_si_mesa_abierta: true }, 'clave-mesa-00001');
  assert.equal(await cuantos('SELECT COUNT(*) n FROM pedido_items WHERE pedido_id = ?', [abierto.id]), 2);
});
