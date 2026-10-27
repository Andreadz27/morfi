// Menú Take Away: productos marcados "para llevar", nombre de la categoría en ese menú y el momento que muestra solo eso
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciarServidor } = require('./helpers');

let s, caliente, grande, bakery, doppio, espresso, latteGrande, medialuna;
const producto = async datos => {
  const [st, r] = await s.llamar('POST', '/api/productos', datos, s.tokenAdmin);
  assert.equal(st, 201, JSON.stringify(r));
  return r.id;
};
const carta = async () => (await s.llamar('GET', '/api/publico/menu'))[1];

before(async () => {
  s = await iniciarServidor();
  const cat = async datos => (await s.llamar('POST', '/api/categorias', datos, s.tokenAdmin))[1].id;
  caliente = await cat({ nombre: 'Cafetería caliente (TA)', nombre_para_llevar: '  Cafetería mediana ' });
  grande = await cat({ nombre: 'Cafetería grande (TA)' });
  bakery = await cat({ nombre: 'Bakery (TA)' });
  doppio = await producto({ nombre: 'Doppio TA', precio_venta: 5300, categoria_id: caliente, para_llevar: 1 });
  espresso = await producto({ nombre: 'Espresso TA', precio_venta: 5100, categoria_id: caliente });
  latteGrande = await producto({ nombre: 'Latte grande TA', precio_venta: 6800, categoria_id: grande, para_llevar: true });
  medialuna = await producto({ nombre: 'Medialuna TA', precio_venta: 3900, categoria_id: bakery });
});
after(async () => { await s.cerrar(); });

test('producto y categoría guardan lo del menú Take Away; editar sin el campo lo conserva', async () => {
  const [{ para_llevar }] = await s.q('SELECT para_llevar FROM productos WHERE id = ?', [doppio]);
  assert.equal(para_llevar, 1);
  assert.equal((await s.q('SELECT para_llevar FROM productos WHERE id = ?', [espresso]))[0].para_llevar, 0);
  await s.llamar('PUT', `/api/productos/${doppio}`, { precio_venta: 5400 }, s.tokenAdmin);
  assert.equal((await s.q('SELECT para_llevar FROM productos WHERE id = ?', [doppio]))[0].para_llevar, 1);
  assert.equal((await s.q('SELECT nombre_para_llevar FROM categorias WHERE id = ?', [caliente]))[0].nombre_para_llevar, 'Cafetería mediana');
  await s.llamar('PUT', `/api/categorias/${grande}`, { nombre_para_llevar: 'Cafetería grande' }, s.tokenAdmin);
  assert.equal((await s.q('SELECT nombre_para_llevar FROM categorias WHERE id = ?', [grande]))[0].nombre_para_llevar, 'Cafetería grande');
});

test('el momento Take Away lista solo las categorías con productos para llevar; los demás momentos, como siempre', async () => {
  const [st] = await s.llamar('POST', '/api/carta/momentos', { nombre: 'Para llevar TA', desde: '07:00', hasta: '21:00',
    categorias: [caliente, grande, bakery], solo_para_llevar: 1 }, s.tokenAdmin);
  assert.equal(st, 201);
  await s.llamar('POST', '/api/carta/momentos', { nombre: 'Desayuno TA', desde: '08:00', hasta: '12:00', categorias: [caliente, bakery] }, s.tokenAdmin);
  const c = await carta();
  const llevar = c.momentos.find(m => m.nombre === 'Para llevar TA');
  assert.equal(llevar.solo_para_llevar, true);
  assert.deepEqual(llevar.categorias, [caliente, grande], 'bakery no tiene nada para llevar');
  assert.deepEqual(c.momentos.find(m => m.nombre === 'Desayuno TA').categorias, [caliente, bakery]);
  // La carta trae la marca de cada producto y el nombre para llevar de la categoría (el navegador filtra)
  const marca = Object.fromEntries(c.productos.filter(p => [doppio, espresso, latteGrande, medialuna].includes(p.id)).map(p => [p.id, p.para_llevar]));
  assert.deepEqual(marca, { [doppio]: true, [espresso]: false, [latteGrande]: true, [medialuna]: false });
  assert.equal(c.categorias.find(x => x.id === caliente).nombre_para_llevar, 'Cafetería mediana');
  // Editar el momento conserva la marca de Take Away si se manda
  const [, lista] = await s.llamar('GET', '/api/carta/momentos', null, s.tokenAdmin);
  const m = lista.find(x => x.nombre === 'Para llevar TA');
  await s.llamar('PUT', `/api/carta/momentos/${m.id}`, { ...m, solo_para_llevar: false }, s.tokenAdmin);
  assert.deepEqual((await carta()).momentos.find(x => x.id === m.id).categorias, [caliente, grande, bakery]);
});

test('los productos del menú Take Away se venden como siempre (precio de la base)', async () => {
  const [st, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'takeaway', items: [{ producto_id: doppio, cantidad: 2, precio: 1 }] }, s.tokenVendedor);
  assert.equal(st, 201, JSON.stringify(p));
  const [{ total }] = await s.q('SELECT total FROM pedidos WHERE id = ?', [p.id]);
  assert.equal(total, 10800);
});
