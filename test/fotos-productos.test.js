// Fotos de los platos para la carta: una por producto, el formato se decide por los bytes y la carta pública
// las muestra con una versión que cambia con cada foto nueva (así el celular no se queda con la vieja).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciarServidor } = require('./helpers');

// Archivos mínimos con la firma de cada formato
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(60, 3)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(60, 1)]);

let s, cat, plato;
const subir = (id, datos, { token = s.tokenAdmin, tipo = 'image/jpeg' } = {}) =>
  fetch(`${s.base}/api/productos/${id}/foto`, {
    method: 'PUT', body: datos, headers: { 'Content-Type': tipo, ...(token ? { Authorization: 'Bearer ' + token } : {}) }
  }).then(async r => [r.status, await r.json()]);
const carta = async () => (await s.llamar('GET', '/api/publico/menu'))[1];
const enCarta = async id => (await carta()).productos.find(p => p.id === id);

before(async () => {
  s = await iniciarServidor();
  cat = (await s.llamar('POST', '/api/categorias', { nombre: 'Platos (fotos)' }, s.tokenAdmin))[1].id;
  plato = (await s.llamar('POST', '/api/productos', { nombre: 'Tostón de palta', precio_venta: 9800, categoria_id: cat }, s.tokenAdmin))[1].id;
});
after(async () => { await s.cerrar(); });

test('subir la foto: la carta la muestra y se sirve sin login con su tipo', async () => {
  assert.equal((await enCarta(plato)).foto, null, 'sin foto todavía');
  const [st, r] = await subir(plato, JPG);
  assert.equal(st, 200);
  assert.equal(r.tipo, 'image/jpeg');
  const v = (await enCarta(plato)).foto;
  assert.ok(v, 'la carta trae la versión de la foto');
  const f = await fetch(`${s.base}/api/publico/fotos/${plato}?v=${v}`);
  assert.equal(f.status, 200);
  assert.equal(f.headers.get('content-type'), 'image/jpeg');
  assert.match(f.headers.get('cache-control'), /max-age=2592000/);
  assert.deepEqual(Buffer.from(await f.arrayBuffer()), JPG);
  // La lista de productos del panel también sabe que tiene foto
  const [, productos] = await s.llamar('GET', '/api/productos', undefined, s.tokenAdmin);
  assert.equal(productos.find(p => p.id === plato).foto, v);
});

test('una foto nueva reemplaza a la anterior y cambia la versión (el celular no muestra la vieja)', async () => {
  const antes = (await enCarta(plato)).foto;
  assert.equal((await subir(plato, PNG, { tipo: 'image/png' }))[0], 200);
  const despues = (await enCarta(plato)).foto;
  assert.notEqual(despues, antes);
  assert.equal((await s.q('SELECT COUNT(*) AS n FROM producto_fotos WHERE producto_id = ?', [plato]))[0].n, 1);
  const f = await fetch(`${s.base}/api/publico/fotos/${plato}?v=${despues}`);
  assert.equal(f.headers.get('content-type'), 'image/png');
});

test('el formato se decide por los bytes: un PDF o un texto con tipo de imagen no pasan', async () => {
  assert.equal((await subir(plato, PDF))[0], 400);
  assert.equal((await subir(plato, Buffer.from('<script>alert(1)</script> no soy una foto')))[0], 400);
  assert.equal((await subir(plato, Buffer.alloc(0)))[0], 400);
  assert.equal((await subir(plato, Buffer.concat([JPG, Buffer.alloc(2 * 1024 * 1024)])))[0], 413);
  assert.equal((await subir(999999, JPG))[0], 404);
});

test('solo la sube o la quita quien maneja el catálogo', async () => {
  assert.equal((await subir(plato, JPG, { token: s.tokenVendedor }))[0], 403);
  assert.equal((await subir(plato, JPG, { token: null }))[0], 401);
  assert.equal((await s.llamar('DELETE', `/api/productos/${plato}/foto`, undefined, s.tokenVendedor))[0], 403);
});

test('quitar la foto: la carta vuelve a mostrar el plato sin foto', async () => {
  assert.equal((await s.llamar('DELETE', `/api/productos/${plato}/foto`, undefined, s.tokenAdmin))[0], 200);
  assert.equal((await enCarta(plato)).foto, null);
  assert.equal((await fetch(`${s.base}/api/publico/fotos/${plato}`)).status, 404);
  assert.equal((await s.llamar('DELETE', `/api/productos/${plato}/foto`, undefined, s.tokenAdmin))[0], 404);
});

test('la foto de un producto dado de baja o de un insumo no se sirve en la carta pública', async () => {
  const baja = (await s.llamar('POST', '/api/productos', { nombre: 'Plato viejo', precio_venta: 100, categoria_id: cat }, s.tokenAdmin))[1].id;
  assert.equal((await subir(baja, JPG))[0], 200);
  assert.equal((await fetch(`${s.base}/api/publico/fotos/${baja}`)).status, 200);
  await s.llamar('DELETE', `/api/productos/${baja}`, undefined, s.tokenAdmin);
  assert.equal((await fetch(`${s.base}/api/publico/fotos/${baja}`)).status, 404);
  assert.equal((await subir(baja, JPG))[0], 404, 'tampoco se le puede subir una');

  const insumo = (await s.llamar('POST', '/api/productos', { nombre: 'Palta (insumo)', clase: 'insumo', precio_venta: 0 }, s.tokenAdmin))[1].id;
  assert.equal((await subir(insumo, JPG))[0], 200);
  assert.equal((await fetch(`${s.base}/api/publico/fotos/${insumo}`)).status, 404);
});
