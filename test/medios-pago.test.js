// MODO y Cuenta DNI: se cobran como cualquier medio, figuran en el arqueo de caja y van a "Bancos y tarjetas"
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciarServidor } = require('./helpers');

let s, prod;
before(async () => {
  s = await iniciarServidor();
  [prod] = await s.q('SELECT id FROM productos WHERE activo = 1 AND precio_venta > 0 ORDER BY id LIMIT 1');
});
after(() => s.cerrar());

const vender = async metodo => {
  const [, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'mostrador', items: [{ producto_id: prod.id, cantidad: 1 }] }, s.tokenAdmin);
  const [st, r] = await s.llamar('POST', `/api/pedidos/${p.id}/cobro`, { pagos: [{ metodo, monto: p.total }] }, s.tokenAdmin);
  assert.equal(st, 200, JSON.stringify(r));
  return p.total;
};

test('cobro con MODO y con Cuenta DNI: arqueo por medio y asiento en Bancos', async () => {
  assert.equal((await s.llamar('POST', '/api/caja/abrir', { monto_inicial: 0 }, s.tokenAdmin))[0], 201);
  const modo = await vender('modo');
  const dni = await vender('cuentadni');

  const [, caja] = await s.llamar('GET', '/api/caja/estado', undefined, s.tokenAdmin);
  const porMetodo = Object.fromEntries(caja.resumen.por_metodo.map(m => [m.metodo, m.total]));
  assert.equal(porMetodo.modo, modo);
  assert.equal(porMetodo.cuentadni, dni);
  assert.equal(caja.resumen.efectivo_esperado, 0, 'no suman al efectivo');

  const hoy = (await s.llamar('GET', '/api/contabilidad/opciones', undefined, s.tokenAdmin))[1].hoy;
  const [, d] = await s.llamar('GET', `/api/contabilidad/libro-diario?desde=${hoy}&hasta=${hoy}`, undefined, s.tokenAdmin);
  const saldo = Object.fromEntries(d.balance.map(c => [c.cuenta, c.saldo]));
  assert.equal(saldo['Bancos y tarjetas'], modo + dni);
  assert.equal(saldo['Otros medios de cobro'], undefined);
});

test('un medio que no existe se rechaza', async () => {
  const [, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'mostrador', items: [{ producto_id: prod.id, cantidad: 1 }] }, s.tokenAdmin);
  assert.equal((await s.llamar('POST', `/api/pedidos/${p.id}/cobro`, { pagos: [{ metodo: 'bitcoin', monto: p.total }] }, s.tokenAdmin))[0], 400);
});
