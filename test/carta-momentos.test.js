// Carta por momentos del día (Desayuno, Brunch...) y destacados (Nuevo, Recomendado, Lo más pedido)
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciarServidor } = require('./helpers');
const { momentoActual } = require('../src/servicios/carta');

let s, cafes, desayunos, vacia;
before(async () => {
  s = await iniciarServidor();
  const cat = async nombre => (await s.llamar('POST', '/api/categorias', { nombre }, s.tokenAdmin))[1].id;
  cafes = await cat('Cafés (momentos)');
  desayunos = await cat('Desayunos (momentos)');
  vacia = await cat('Sin productos (momentos)');
  await s.llamar('POST', '/api/productos', { nombre: 'Latte M', precio_venta: 6100, categoria_id: cafes }, s.tokenAdmin);
  await s.llamar('POST', '/api/productos', { nombre: 'Tostadas M', precio_venta: 9500, categoria_id: desayunos }, s.tokenAdmin);
});
after(async () => { await s.cerrar(); });

const carta = async () => (await s.llamar('GET', '/api/publico/menu'))[1];

test('el momento de la hora: si se superponen gana el que empezó último; fuera de horario, ninguno', () => {
  const m = [{ id: 1, desde: '08:00', hasta: '12:00' }, { id: 2, desde: '11:00', hasta: '16:00' }, { id: 3, desde: '16:00', hasta: '20:00' }];
  assert.equal(momentoActual(m, '09:15'), 1);
  assert.equal(momentoActual(m, '11:30'), 2);
  assert.equal(momentoActual(m, '16:00'), 3, 'a las 16 en punto ya es la merienda');
  assert.equal(momentoActual(m, '07:59'), null);
  assert.equal(momentoActual(m, '21:00'), null);
  assert.equal(momentoActual([], '10:00'), null);
});

test('crear, editar y borrar momentos; la carta los muestra con sus categorías (solo las que tienen productos)', async () => {
  const [st, d] = await s.llamar('POST', '/api/carta/momentos', { nombre: 'Desayuno', icono: '🌅', desde: '08:00', hasta: '12:00',
    categorias: [cafes, desayunos, vacia], traducciones: { en: { nombre: 'Breakfast' } } }, s.tokenAdmin);
  assert.equal(st, 201);
  await s.llamar('POST', '/api/carta/momentos', { nombre: 'Merienda', desde: '16:00', hasta: '20:00', categorias: [cafes], orden: 2 }, s.tokenAdmin);
  let c = await carta();
  const des = c.momentos.find(m => m.nombre === 'Desayuno');
  assert.deepEqual(des.categorias, [cafes, desayunos], 'la categoría sin productos no aparece');
  assert.deepEqual(des.traducciones, { en: { nombre: 'Breakfast' } });
  assert.ok('momento_actual' in c);
  // Editar: cambia el orden de las categorías; apagado no se ve en la carta
  assert.equal((await s.llamar('PUT', `/api/carta/momentos/${d.id}`, { nombre: 'Desayuno', desde: '08:00', hasta: '12:00',
    categorias: [desayunos, cafes] }, s.tokenAdmin))[0], 200);
  assert.deepEqual((await carta()).momentos.find(m => m.id === d.id).categorias, [desayunos, cafes]);
  await s.llamar('PUT', `/api/carta/momentos/${d.id}`, { nombre: 'Desayuno', desde: '08:00', hasta: '12:00', categorias: [cafes], activo: 0 }, s.tokenAdmin);
  c = await carta();
  assert.ok(!c.momentos.some(m => m.id === d.id));
  assert.equal((await s.llamar('DELETE', `/api/carta/momentos/${d.id}`, undefined, s.tokenAdmin))[0], 200);
  assert.equal((await s.q('SELECT COUNT(*) AS n FROM momento_categorias WHERE momento_id = ?', [d.id]))[0].n, 0);
});

test('los momentos se validan y solo los edita quien maneja el catálogo', async () => {
  const crear = b => s.llamar('POST', '/api/carta/momentos', { nombre: 'X', desde: '08:00', hasta: '12:00', categorias: [cafes], ...b }, s.tokenAdmin).then(r => r[0]);
  assert.equal(await crear({ nombre: '' }), 400);
  assert.equal(await crear({ desde: '8:00' }), 400);
  assert.equal(await crear({ desde: '13:00', hasta: '12:00' }), 400);
  assert.equal(await crear({ categorias: [] }), 400);
  assert.equal(await crear({ categorias: [99999] }), 400);
  assert.equal(await crear({ traducciones: { fr: { nombre: 'Petit déjeuner' } } }), 400);
  assert.equal((await s.llamar('POST', '/api/carta/momentos', { nombre: 'Cajero', desde: '08:00', hasta: '12:00', categorias: [cafes] }, s.tokenVendedor))[0], 403);
});

test('destacados: Nuevo y Recomendado los marca el local; Lo más pedido sale de las ventas', async () => {
  const [, prod] = await s.llamar('POST', '/api/productos', { nombre: 'Avocado toast M', precio_venta: 14000, categoria_id: desayunos, nuevo: 1, recomendado: 1 }, s.tokenAdmin);
  let p = (await carta()).productos.find(x => x.id === prod.id);
  assert.equal(p.nuevo, true);
  assert.equal(p.recomendado, true);
  assert.equal(p.mas_pedido, false, 'sin ventas no es "lo más pedido"');
  // Editar otro campo no borra las marcas; se pueden sacar
  await s.llamar('PUT', `/api/productos/${prod.id}`, { precio_venta: 14500 }, s.tokenAdmin);
  assert.equal((await carta()).productos.find(x => x.id === prod.id).nuevo, true);
  await s.llamar('PUT', `/api/productos/${prod.id}`, { nuevo: 0 }, s.tokenAdmin);
  assert.equal((await carta()).productos.find(x => x.id === prod.id).nuevo, false);
  // Se vende 3 veces en las últimas semanas: pasa a "Lo más pedido"
  const [, ped] = await s.llamar('POST', '/api/pedidos', { tipo: 'mostrador', items: [{ producto_id: prod.id, cantidad: 3 }] }, s.tokenAdmin);
  assert.equal((await s.llamar('POST', `/api/pedidos/${ped.id}/cobro`, { pagos: [{ metodo: 'efectivo', monto: ped.total }] }, s.tokenAdmin))[0], 200);
  p = (await carta()).productos.find(x => x.id === prod.id);
  assert.equal(p.mas_pedido, true);
});
