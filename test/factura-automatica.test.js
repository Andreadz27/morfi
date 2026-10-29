// Factura automática (Integraciones → AFIP): cada pedido pagado se factura solo a Consumidor Final, B o C según
// la condición del local; la factura elegida en el cobro manda y nunca sale duplicada. ARCA simulado.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciarServidor, esperar } = require('./helpers');
const { iniciarArcaSimulado } = require('./afip-simulado');

let arca, s, prod;
const BASE = { cuit: '20-11111111-2', access_token: 'x', activa: true, iva_tipo: 5, pto_venta: 3 };
const configurar = extra => s.llamar('PUT', '/api/integraciones/config/afip', { ...BASE, ...extra }, s.tokenAdmin);
const comprobantes = id => s.q('SELECT tipo_comprobante, cuit_receptor FROM comprobantes_afip WHERE pedido_id = ? ORDER BY id', [id]);
async function esperarComprobantes(id, n = 1) {
  for (let i = 0; i < 60; i++) { const c = await comprobantes(id); if (c.length >= n) return c; await esperar(100); }
  return comprobantes(id);
}
async function pedidoPagado() {
  const [, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'takeaway', items: [{ producto_id: prod.id, cantidad: 1 }] }, s.tokenVendedor);
  assert.equal((await s.llamar('POST', `/api/pedidos/${p.id}/pagar`, { metodo: 'tarjeta', monto: 1210 }, s.tokenVendedor))[0], 200);
  return p;
}

before(async () => {
  arca = await iniciarArcaSimulado();
  s = await iniciarServidor({ GM_AFIP_API_URL: arca.url });
  [prod] = await s.q("SELECT id FROM productos WHERE activo = 1 AND clase = 'venta' ORDER BY id LIMIT 1");
  await s.q('UPDATE productos SET precio_venta = 1210 WHERE id = ?', [prod.id]);
});
after(async () => {
  await s.cerrar();
  await arca.cerrar();
});

test('apagada (como viene), o sin la condición de IVA del local: no factura sola', async () => {
  assert.equal((await configurar({ condicion_iva: 'ri' }))[0], 200);
  let p = await pedidoPagado();
  await esperar(800);
  assert.deepEqual(await comprobantes(p.id), []);
  await configurar({ factura_auto: true });
  p = await pedidoPagado();
  await esperar(800);
  assert.deepEqual(await comprobantes(p.id), [], 'sin condición de IVA no se adivina el tipo');
});

test('Responsable Inscripto: Factura B a Consumidor Final al pagar; monotributo: Factura C', async () => {
  await configurar({ factura_auto: true, condicion_iva: 'ri' });
  let p = await pedidoPagado();
  assert.deepEqual(await esperarComprobantes(p.id), [{ tipo_comprobante: 6, cuit_receptor: '' }]);
  await configurar({ factura_auto: true, condicion_iva: 'monotributo' });
  p = await pedidoPagado();
  assert.deepEqual((await esperarComprobantes(p.id)).map(c => c.tipo_comprobante), [11]);
});

test('la factura elegida en el cobro manda (A con CUIT) y no sale otra automática', async () => {
  await configurar({ factura_auto: true, condicion_iva: 'ri' });
  const [, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'takeaway', items: [{ producto_id: prod.id, cantidad: 1 }] }, s.tokenVendedor);
  const [st, r] = await s.llamar('POST', `/api/pedidos/${p.id}/cobro`, {
    pagos: [{ metodo: 'tarjeta', monto: 1210 }], factura: { tipo_comprobante: 1, cuit_receptor: '20111111112' }
  }, s.tokenVendedor);
  assert.equal(st, 200, JSON.stringify(r));
  await esperar(1000);
  assert.deepEqual((await comprobantes(p.id)).map(c => c.tipo_comprobante), [1], 'una sola: la A');
});
