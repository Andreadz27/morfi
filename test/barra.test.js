// Pedido desde la barra sin pasar por la caja: el cliente pide con el QR del mostrador, el pedido va a cocina,
// lo sigue desde el celular, avisa que transfirió, la caja confirma con un toque y se cierra; la pantalla de
// retiro muestra preparando / listos y "entregado" lo saca. También: transferencia de una mesa cierra la mesa.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciarServidor } = require('./helpers');

let s, token, prod;
before(async () => {
  s = await iniciarServidor({ BASE_URL: 'http://127.0.0.1' });
  [prod] = await s.q("SELECT id, precio_venta FROM productos WHERE activo = 1 AND precio_venta > 0 AND clase = 'venta' ORDER BY id LIMIT 1");
  const [st, qr] = await s.llamar('GET', '/api/barra/qr', undefined, s.tokenAdmin);
  assert.equal(st, 200, JSON.stringify(qr));
  token = qr.url.split('barra=')[1];
  assert.match(token, /^[a-f0-9]{24}$/);
  assert.match(qr.pantalla, /retiro\.html\?t=/);
  await s.llamar('PUT', '/api/config', { alias_transferencia: 'castillo.694' }, s.tokenAdmin);
});
after(() => s.cerrar());

const pedir = body => s.llamar('POST', `/api/publico/barra/${token}/pedido`, body);
const cliente = (codigo, ruta = '', metodo = 'GET', body) => s.llamar(metodo, `/api/publico/pedido-barra/${codigo}${ruta}`, body);

test('el QR de la barra: token propio, uno inventado no sirve, el mismo hasta que se pide uno nuevo', async () => {
  assert.equal((await s.llamar('GET', `/api/publico/barra/${token}`))[0], 200);
  assert.equal((await s.llamar('GET', `/api/publico/barra/${'a'.repeat(24)}`))[0], 404);
  const [, otra] = await s.llamar('GET', '/api/barra/qr', undefined, s.tokenAdmin);
  assert.equal(otra.url.split('barra=')[1], token);
});

test('pedido de barra: va a cocina con precio de la base, el cliente lo sigue, avisa transferencia y la caja cierra', async () => {
  assert.equal((await pedir({ items: [{ producto_id: prod.id, cantidad: 1 }] }))[0], 400, 'sin nombre');
  assert.equal((await pedir({ cliente: 'Ana', items: [] }))[0], 400);
  assert.equal((await pedir({ cliente: 'Ana', items: [{ producto_id: prod.id, cantidad: 99 }] }))[0], 400);
  const [st, r] = await pedir({ cliente: 'Ana López', items: [{ producto_id: prod.id, cantidad: 2, precio: 1 }] });
  assert.equal(st, 201, JSON.stringify(r));
  assert.match(r.codigo, /^[a-f0-9]{24}$/);
  assert.equal(r.total, prod.precio_venta * 2, 'el precio sale de la base, no del celular');
  const [ped] = await s.q('SELECT id, tipo, origen, cliente FROM pedidos WHERE codigo_cliente = ?', [r.codigo]);
  assert.deepEqual([ped.tipo, ped.origen, ped.cliente], ['mostrador', 'barra', 'Ana López']);
  // En la pantalla de cocina
  const [, cocina] = await s.llamar('GET', '/api/cocina', undefined, s.tokenAdmin);
  assert.ok((Array.isArray(cocina) ? cocina : cocina.pedidos || []).some(p => p.id === ped.id), 'está en cocina');

  let [, e] = await cliente(r.codigo);
  assert.deepEqual([e.etapa, e.pagado, e.cliente, e.cuenta.saldo], ['preparando', false, 'Ana', r.total]);
  assert.equal(e.numero_corto, String(Number(r.numero_pedido.split('-').pop())), 'número corto para llamarlo');
  assert.deepEqual(e.pago.transferencia, { alias: 'castillo.694', titular: '' });
  assert.equal(e.pago.mercadopago, false, 'sin Mercado Pago configurado');
  assert.equal((await cliente(r.codigo, '/pagar', 'POST'))[0], 400);
  assert.equal((await cliente('b'.repeat(24)))[0], 404);

  // Pantalla de retiro (pública: solo número y nombre) y panel de la caja (con saldo y aviso)
  let [, tv] = await s.llamar('GET', `/api/publico/retiro/${token}`);
  assert.ok(tv.preparando.some(p => p.nombre === 'Ana'));
  assert.equal(tv.preparando[0].saldo, undefined, 'la TV no muestra plata');

  [, e] = await cliente(r.codigo, '/transferi', 'POST');
  assert.equal(e.aviso_pago, 'transferencia');
  let [, panel] = await s.llamar('GET', '/api/retiro', undefined, s.tokenAdmin);
  const fila = panel.preparando.find(p => p.id === ped.id);
  assert.deepEqual([fila.aviso_pago, fila.pagado], ['transferencia', false]);

  // El mozo no cobra; la caja sí: un toque cobra lo que falta por transferencia y cierra
  const [, u] = await s.llamar('POST', '/api/usuarios', { nombre: 'Mozo B', email: 'mozo-barra@test.com', password: 'mozo12345', rol: 'mozo' }, s.tokenAdmin);
  await s.q('UPDATE usuarios SET debe_cambiar_password = 0 WHERE id = ?', [u.id]);
  assert.equal((await s.llamar('POST', `/api/pedidos/${ped.id}/cobrar-transferencia`, {}, s.token(u.id)))[0], 403);
  const [stC, c] = await s.llamar('POST', `/api/pedidos/${ped.id}/cobrar-transferencia`, {}, s.tokenAdmin);
  assert.equal(stC, 200, JSON.stringify(c));
  assert.equal(c.cerrado, true);
  const [pago] = await s.q('SELECT metodo, monto FROM pagos WHERE pedido_id = ?', [ped.id]);
  assert.deepEqual([pago.metodo, pago.monto], ['transferencia', r.total]);
  [, e] = await cliente(r.codigo);
  assert.deepEqual([e.pagado, e.aviso_pago], [true, '']);
  assert.equal((await s.llamar('POST', `/api/pedidos/${ped.id}/cobrar-transferencia`, {}, s.tokenAdmin))[0], 400, 'no se cobra dos veces');

  // Cocina lo marca listo: el cliente lo ve y aparece en "listos"; la caja lo entrega y sale de la pantalla
  assert.equal((await s.llamar('PUT', `/api/cocina/${ped.id}/listo`, {}, s.tokenAdmin))[0], 200);
  [, e] = await cliente(r.codigo);
  assert.equal(e.etapa, 'listo');
  [, tv] = await s.llamar('GET', `/api/publico/retiro/${token}`);
  assert.ok(tv.listos.some(p => p.numero_pedido === r.numero_pedido));
  assert.equal((await s.llamar('POST', `/api/pedidos/${ped.id}/retirado`, {}, s.tokenAdmin))[0], 200);
  [, tv] = await s.llamar('GET', `/api/publico/retiro/${token}`);
  assert.ok(!tv.listos.some(p => p.numero_pedido === r.numero_pedido));
  [, e] = await cliente(r.codigo);
  assert.equal(e.etapa, 'retirado');
});

test('pedido de la caja (mostrador) también aparece en la pantalla de retiro', async () => {
  const [, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'mostrador', cliente: 'Juan', items: [{ producto_id: prod.id, cantidad: 1 }] }, s.tokenAdmin);
  const [, tv] = await s.llamar('GET', `/api/publico/retiro/${token}`);
  assert.ok(tv.preparando.some(x => x.numero_pedido === p.numero_pedido && x.nombre === 'Juan'));
});

test('mesa que avisa "paga por transferencia": la caja cobra con un toque, la mesa se cierra y se libera', async () => {
  const [mesa] = await s.q("SELECT id, qr_token FROM mesas WHERE estado = 'libre' ORDER BY id LIMIT 1");
  const [, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'salon', mesa_id: mesa.id, items: [{ producto_id: prod.id, cantidad: 1 }] }, s.tokenAdmin);
  assert.ok(p.id);
  const [, sol] = await s.llamar('POST', `/api/publico/mesa/${mesa.qr_token}/llamar`, { tipo: 'cuenta', forma: 'transferencia' });
  const [st, r] = await s.llamar('POST', `/api/mesas/solicitudes/${sol.id}/cobrar-transferencia`, {}, s.tokenAdmin);
  assert.equal(st, 200, JSON.stringify(r));
  assert.equal(r.cerrado, true);
  const [m] = await s.q('SELECT estado FROM mesas WHERE id = ?', [mesa.id]);
  assert.equal(m.estado, 'libre');
  const [sl] = await s.q('SELECT estado FROM solicitudes_mesa WHERE id = ?', [sol.id]);
  assert.equal(sl.estado, 'atendida');
});
