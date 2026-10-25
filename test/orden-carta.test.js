const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciarServidor } = require('./helpers');

let s, cat;
before(async () => {
  s = await iniciarServidor();
  [, cat] = await s.llamar('POST', '/api/categorias', { nombre: 'Cafetería caliente (orden)', orden: 50 }, s.tokenAdmin);
});
after(async () => { await s.cerrar(); });

const crear = (nombre, orden) => s.llamar('POST', '/api/productos', { nombre, precio_venta: 5000, categoria_id: cat.id, ...(orden !== undefined ? { orden } : {}) }, s.tokenAdmin);
const nombresEnCarta = async () => (await s.llamar('GET', '/api/publico/menu'))[1].productos.filter(p => p.categoria_id === cat.id).map(p => p.nombre);
const nombresEnSistema = async () => (await s.llamar('GET', '/api/productos', undefined, s.tokenAdmin))[1].filter(p => p.categoria_id === cat.id).map(p => p.nombre);

test('sin posiciones cargadas, la carta sigue en orden alfabético', async () => {
  await crear('Lungo');
  await crear('Espresso');
  await crear('Doppio');
  assert.deepEqual(await nombresEnCarta(), ['Doppio', 'Espresso', 'Lungo']);
});

test('con posición, los productos salen como en la carta impresa; los que no tienen van después por nombre', async () => {
  const ids = Object.fromEntries((await s.q('SELECT id, nombre FROM productos WHERE categoria_id = ?', [cat.id])).map(p => [p.nombre, p.id]));
  await s.llamar('PUT', `/api/productos/${ids.Espresso}`, { orden: 1 }, s.tokenAdmin);
  await s.llamar('PUT', `/api/productos/${ids.Lungo}`, { orden: 2 }, s.tokenAdmin);
  await crear('Cortado', 3);
  await crear('Americano');
  const esperado = ['Espresso', 'Lungo', 'Cortado', 'Americano', 'Doppio'];
  assert.deepEqual(await nombresEnCarta(), esperado);
  assert.deepEqual(await nombresEnSistema(), esperado, 'el sistema (punto de venta, productos) usa el mismo orden');
  // Editar otra cosa no cambia la posición
  await s.llamar('PUT', `/api/productos/${ids.Lungo}`, { precio_venta: 5200 }, s.tokenAdmin);
  assert.equal((await s.q('SELECT orden FROM productos WHERE id = ?', [ids.Lungo]))[0].orden, 2);
});

test('una posición inválida no se guarda', async () => {
  assert.equal((await crear('Flat white', -1))[0], 400);
  assert.equal((await crear('Flat white', 'abc'))[0], 400);
  assert.equal((await s.q("SELECT COUNT(*) AS n FROM productos WHERE nombre = 'Flat white'"))[0].n, 0);
});
