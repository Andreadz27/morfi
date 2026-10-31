// Correcciones del administrador: cambiar el medio de un cobro y eliminar un pedido (también cobrado).
// La caja y los reportes salen de los pagos; una caja ya cerrada rehace su resumen. Propina por pagar de más.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciarServidor } = require('./helpers');

let s, prod;
before(async () => {
  s = await iniciarServidor();
  [prod] = await s.q('SELECT id FROM productos WHERE activo = 1 AND precio_venta > 0 ORDER BY id LIMIT 1');
  await s.q('UPDATE productos SET precio_venta = 1000, tracking_stock = 1, stock_actual = 50 WHERE id = ?', [prod.id]);
});
after(() => s.cerrar());

const vender = async (metodo, extra = {}) => {
  const [, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'mostrador', items: [{ producto_id: prod.id, cantidad: 2 }] }, s.tokenAdmin);
  const [st, r] = await s.llamar('POST', `/api/pedidos/${p.id}/cobro`, { pagos: [{ metodo, monto: p.total + (extra.mas || 0) }], ...extra.body }, s.tokenAdmin);
  assert.equal(st, 200, JSON.stringify(r));
  const [, d] = await s.llamar('GET', `/api/pedidos/${p.id}`, undefined, s.tokenAdmin);
  return d;
};
const caja = async () => (await s.llamar('GET', '/api/caja/estado', undefined, s.tokenAdmin))[1].resumen;

test('corregir el medio de pago: la caja se corrige sola y queda en auditoría', async () => {
  assert.equal((await s.llamar('POST', '/api/caja/abrir', { monto_inicial: 1000 }, s.tokenAdmin))[0], 201);
  const p = await vender('efectivo');
  assert.equal((await caja()).efectivo_esperado, 3000);

  const [st, r] = await s.llamar('PUT', `/api/pedidos/${p.id}/pagos/${p.pagos[0].id}`, { metodo: 'transferencia' }, s.tokenAdmin);
  assert.equal(st, 200, JSON.stringify(r));
  assert.equal((await caja()).efectivo_esperado, 1000, 'el efectivo esperado baja');
  const [ped] = await s.q('SELECT metodo_pago FROM pedidos WHERE id = ?', [p.id]);
  assert.equal(ped.metodo_pago, 'transferencia');
  const [a] = await s.q("SELECT detalle FROM auditoria WHERE accion = 'corregir_pago' ORDER BY id DESC LIMIT 1");
  assert.match(a.detalle, /de efectivo a transferencia/);

  assert.equal((await s.llamar('PUT', `/api/pedidos/${p.id}/pagos/${p.pagos[0].id}`, { metodo: 'bitcoin' }, s.tokenAdmin))[0], 400);
});

test('solo el administrador corrige y elimina', async () => {
  const p = await vender('tarjeta');
  assert.equal((await s.llamar('PUT', `/api/pedidos/${p.id}/pagos/${p.pagos[0].id}`, { metodo: 'efectivo' }, s.tokenVendedor))[0], 403);
  assert.equal((await s.llamar('POST', `/api/pedidos/${p.id}/eliminar`, { motivo: 'Pedido duplicado' }, s.tokenVendedor))[0], 403);
});

test('eliminar un pedido cobrado: sin cobros, vuelve el stock, queda en cancelados con el motivo', async () => {
  const [{ s: antes }] = await s.q('SELECT stock_actual s FROM productos WHERE id = ?', [prod.id]);
  const esperadoAntes = (await caja()).efectivo_esperado;
  const p = await vender('efectivo');
  assert.equal((await caja()).efectivo_esperado, esperadoAntes + 2000);

  assert.equal((await s.llamar('POST', `/api/pedidos/${p.id}/eliminar`, {}, s.tokenAdmin))[0], 400, 'sin motivo no');
  assert.equal((await s.llamar('POST', `/api/pedidos/${p.id}/eliminar`, { motivo: 'Otro' }, s.tokenAdmin))[0], 400, '"Otro" pide texto');
  const [st, r] = await s.llamar('POST', `/api/pedidos/${p.id}/eliminar`, { motivo: 'Pedido duplicado' }, s.tokenAdmin);
  assert.equal(st, 200, JSON.stringify(r));
  assert.equal(r.cobrado, 2000);

  assert.equal((await caja()).efectivo_esperado, esperadoAntes);
  const [ped] = await s.q('SELECT estado, notas FROM pedidos WHERE id = ?', [p.id]);
  assert.equal(ped.estado, 'cancelado');
  assert.match(ped.notas, /Eliminado: Pedido duplicado/);
  assert.equal((await s.q('SELECT COUNT(*) n FROM pagos WHERE pedido_id = ?', [p.id]))[0].n, 0);
  const [{ s: despues }] = await s.q('SELECT stock_actual s FROM productos WHERE id = ?', [prod.id]);
  assert.equal(despues, antes, 'vuelve el stock');
  assert.equal((await s.llamar('POST', `/api/pedidos/${p.id}/eliminar`, { motivo: 'Pedido duplicado' }, s.tokenAdmin))[0], 400, 'no dos veces');
});

test('eliminar un pedido de una caja ya cerrada rehace su resumen', async () => {
  const p = await vender('efectivo');
  const [, c] = await s.llamar('GET', '/api/caja/estado', undefined, s.tokenAdmin);
  const esperado = c.resumen.efectivo_esperado;
  assert.equal((await s.llamar('POST', '/api/caja/cerrar', { monto_final_real: esperado }, s.tokenAdmin))[0], 200);
  const [{ id }] = await s.q('SELECT id FROM caja ORDER BY id DESC LIMIT 1');

  assert.equal((await s.llamar('POST', `/api/pedidos/${p.id}/eliminar`, { motivo: 'Era una prueba' }, s.tokenAdmin))[0], 200);
  const [cerrada] = await s.q('SELECT monto_esperado, diferencia FROM caja WHERE id = ?', [id]);
  assert.equal(cerrada.monto_esperado, esperado - 2000);
  assert.equal(cerrada.diferencia, 2000, 'lo contado no cambia: ahora sobra');
});

test('pagar de más con propina: el excedente queda como propina del pedido', async () => {
  const [, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'mostrador', items: [{ producto_id: prod.id, cantidad: 1 }] }, s.tokenAdmin);
  // Como manda la pantalla de cobro al tocar "Es propina": la propina sube y el cobro es el total con propina
  const [st, r] = await s.llamar('POST', `/api/pedidos/${p.id}/cobro`, { pagos: [{ metodo: 'tarjeta', monto: 1500 }], propina: 500 }, s.tokenAdmin);
  assert.equal(st, 200, JSON.stringify(r));
  assert.equal(r.cerrado, true);
  const [ped] = await s.q('SELECT total, propina FROM pedidos WHERE id = ?', [p.id]);
  assert.deepEqual(ped, { total: 1500, propina: 500 });
});

test('quitar un producto de un pedido abierto: una unidad o el renglón; solo administrador', async () => {
  const [otro] = await s.q('SELECT id FROM productos WHERE activo = 1 AND precio_venta > 0 AND id <> ? ORDER BY id LIMIT 1', [prod.id]);
  await s.q('UPDATE productos SET precio_venta = 500 WHERE id = ?', [otro.id]);
  const [, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'mostrador', items: [{ producto_id: prod.id, cantidad: 3 }, { producto_id: otro.id, cantidad: 1 }] }, s.tokenAdmin);
  const [, d] = await s.llamar('GET', `/api/pedidos/${p.id}`, undefined, s.tokenAdmin);
  const tres = d.items.find(i => i.producto_id === prod.id), uno = d.items.find(i => i.producto_id === otro.id);
  assert.equal(d.total, 3500);

  assert.equal((await s.llamar('DELETE', `/api/pedidos/${p.id}/items/${tres.id}`, { cantidad: 1 }, s.tokenVendedor))[0], 403);
  let [st, r] = await s.llamar('DELETE', `/api/pedidos/${p.id}/items/${tres.id}`, { cantidad: 1 }, s.tokenAdmin);
  assert.equal(st, 200, JSON.stringify(r));
  assert.equal(r.total, 2500);
  [st, r] = await s.llamar('DELETE', `/api/pedidos/${p.id}/items/${uno.id}`, {}, s.tokenAdmin);
  assert.equal(st, 200, JSON.stringify(r));
  assert.equal(r.total, 2000);
  assert.equal((await s.q('SELECT COUNT(*) n FROM pedido_items WHERE pedido_id = ?', [p.id]))[0].n, 1);
  // El último producto no: para eso está "Eliminar pedido"
  assert.equal((await s.llamar('DELETE', `/api/pedidos/${p.id}/items/${tres.id}`, {}, s.tokenAdmin))[0], 400);
  const [a] = await s.q("SELECT detalle FROM auditoria WHERE accion = 'quitar_item' ORDER BY id DESC LIMIT 1");
  assert.match(a.detalle, /quitado 1 x/);

  // Pedido cobrado: no se toca
  const v = await vender('efectivo');
  assert.equal((await s.llamar('DELETE', `/api/pedidos/${v.id}/items/${v.items[0].id}`, { cantidad: 1 }, s.tokenAdmin))[0], 400);
});
