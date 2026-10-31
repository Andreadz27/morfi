// Ticket promedio por persona sin cargar nada: las personas salen de lo pedido (bebidas y platos; "para 2" cuenta doble)
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciarServidor } = require('./helpers');
const { clase, porciones } = require('../src/servicios/ticket-promedio');

test('qué cuenta como persona: bebidas y platos sí, pastelería no; "para 2" y "dúo" cuentan doble', () => {
  assert.equal(clase('Cafetería caliente', 'Latte'), 'bebida');
  assert.equal(clase('Bebidas frías & licuados', 'Licuado'), 'bebida');
  assert.equal(clase('Infusiones', 'Tés'), 'bebida');
  assert.equal(clase('Para desayunar', 'Avocado toast'), 'plato');
  assert.equal(clase('Sándwiches', 'Tostado'), 'plato');
  assert.equal(clase('Laminados & bakery', 'Medialuna'), 'acompana');
  assert.equal(clase('Pastelería', 'Brownie'), 'acompana');
  assert.equal(porciones('Brunch dúo (para 2)'), 2);
  assert.equal(porciones('Picada para 4'), 4);
  assert.equal(porciones('Tostado clásico'), 1);
});

let s;
before(async () => { s = await iniciarServidor(); });
after(() => s.cerrar());

test('reporte: 2 cafés + 1 tostado = 2 personas (uno comparte o solo toma café); un dúo = 2 personas', async () => {
  const cat = async nombre => (await s.q('INSERT INTO categorias (nombre) VALUES (?) RETURNING id', [nombre]))[0].id;
  const prod = async (nombre, categoria, precio) => (await s.q('INSERT INTO productos (nombre, categoria_id, precio_venta, activo) VALUES (?, ?, ?, 1) RETURNING id', [nombre, categoria, precio]))[0].id;
  const caf = await cat('Cafetería TP'), san = await cat('Sándwiches TP'), pas = await cat('Pastelería TP');
  const latte = await prod('Latte TP', caf, 1000), tostado = await prod('Tostado TP', san, 4000), duo = await prod('Brunch dúo TP (para 2)', san, 10000), medialuna = await prod('Medialuna TP', pas, 500);
  const vender = async items => {
    const [, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'salon', items }, s.tokenAdmin);
    const [st] = await s.llamar('POST', `/api/pedidos/${p.id}/cobro`, { pagos: [{ metodo: 'efectivo', monto: p.total }] }, s.tokenAdmin);
    assert.equal(st, 200);
  };
  const [, antes] = await s.llamar('GET', '/api/reportes/ticket', undefined, s.tokenAdmin);
  await vender([{ producto_id: latte, cantidad: 2 }, { producto_id: tostado, cantidad: 1 }, { producto_id: medialuna, cantidad: 2 }]); // 7000, 2 personas
  await vender([{ producto_id: duo, cantidad: 1 }]); // 10000, 2 personas
  const [st, t] = await s.llamar('GET', '/api/reportes/ticket', undefined, s.tokenAdmin);
  assert.equal(st, 200, JSON.stringify(t));
  assert.equal(t.total.tickets - antes.total.tickets, 2);
  assert.equal(t.total.personas - antes.total.personas, 4);
  assert.equal(t.total.compartidos - antes.total.compartidos, 1, 'el de 2 cafés y 1 tostado');
  if (!antes.total.tickets) {
    assert.equal(t.total.por_ticket, 8500);
    assert.equal(t.total.por_persona, 4250);
  }
  assert.ok(t.anterior && t.anterior.desde < t.desde);
  assert.equal((await s.llamar('GET', '/api/reportes/ticket?desde=2026-01-10&hasta=2026-01-01', undefined, s.tokenAdmin))[0], 400);
});
