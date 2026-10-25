const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciarServidor } = require('./helpers');
const { normalizarTraducciones, leerTraducciones } = require('../src/traducciones');

let s;
before(async () => { s = await iniciarServidor(); });
after(async () => { await s.cerrar(); });

const enCarta = async id => (await s.llamar('GET', '/api/publico/menu'))[1].productos.find(p => p.id === id);

test('un producto con traducciones las muestra en la carta pública', async () => {
  const [st, r] = await s.llamar('POST', '/api/productos', {
    nombre: 'Tostado clásico', descripcion: 'Jamón cocido y queso fundido.', precio_venta: 13000, categoria_id: 2,
    traducciones: { en: { nombre: 'Ham and cheese toastie', descripcion: 'Ham and melted cheese.' }, pt: { nombre: 'Misto quente' } }
  }, s.tokenAdmin);
  assert.equal(st, 201);
  const p = await enCarta(r.id);
  assert.equal(p.nombre, 'Tostado clásico', 'el nombre de siempre sigue en español');
  assert.deepEqual(p.traducciones, {
    en: { nombre: 'Ham and cheese toastie', descripcion: 'Ham and melted cheese.' }, pt: { nombre: 'Misto quente' }
  });
});

test('editar un producto sin mandar traducciones no las borra; mandarlas vacías sí', async () => {
  const [, r] = await s.llamar('POST', '/api/productos', {
    nombre: 'Medialuna', precio_venta: 3900, traducciones: { en: { nombre: 'Croissant' } }
  }, s.tokenAdmin);
  await s.llamar('PUT', `/api/productos/${r.id}`, { nombre: 'Medialuna de manteca', precio_venta: 4000 }, s.tokenAdmin);
  assert.deepEqual((await enCarta(r.id)).traducciones, { en: { nombre: 'Croissant' } });
  await s.llamar('PUT', `/api/productos/${r.id}`, { traducciones: { en: { nombre: '' }, pt: {} } }, s.tokenAdmin);
  assert.deepEqual((await enCarta(r.id)).traducciones, {});
  assert.equal((await s.q('SELECT traducciones FROM productos WHERE id = ?', [r.id]))[0].traducciones, null);
});

test('las categorías también se traducen', async () => {
  const [, c] = await s.llamar('POST', '/api/categorias', { nombre: 'Cafetería fría', traducciones: { en: { nombre: 'Iced coffee' } } }, s.tokenAdmin);
  await s.llamar('POST', '/api/productos', { nombre: 'Iced latte', precio_venta: 6500, categoria_id: c.id }, s.tokenAdmin);
  const cat = () => s.llamar('GET', '/api/publico/menu').then(([, m]) => m.categorias.find(x => x.id === c.id));
  assert.deepEqual((await cat()).traducciones, { en: { nombre: 'Iced coffee' } });
  await s.llamar('PUT', `/api/categorias/${c.id}`, { traducciones: { pt: { nombre: 'Cafés gelados' } } }, s.tokenAdmin);
  assert.deepEqual((await cat()).traducciones, { pt: { nombre: 'Cafés gelados' } });
});

test('traducciones inválidas se rechazan sin guardar el producto', async () => {
  const crear = traducciones => s.llamar('POST', '/api/productos', { nombre: 'Chipá', precio_venta: 5500, traducciones }, s.tokenAdmin);
  assert.equal((await crear({ fr: { nombre: 'Pain au fromage' } }))[0], 400, 'idioma no soportado');
  assert.equal((await crear('no es json'))[0], 400);
  assert.equal((await crear([1, 2]))[0], 400);
  assert.equal((await crear({ en: { nombre: 'x'.repeat(121) } }))[0], 400, 'nombre demasiado largo');
  assert.equal((await s.q("SELECT COUNT(*) AS n FROM productos WHERE nombre = 'Chipá'"))[0].n, 0);
});

test('normalizar: recorta, descarta campos y idiomas vacíos; leer tolera basura', () => {
  assert.equal(normalizarTraducciones({ en: { nombre: '  Tea  ', descripcion: ' ', otro: 'x' } }), '{"en":{"nombre":"Tea"}}');
  assert.equal(normalizarTraducciones({ en: { nombre: 'Tea', descripcion: 'Hot' } }, ['nombre']), '{"en":{"nombre":"Tea"}}');
  assert.equal(normalizarTraducciones(''), null);
  assert.equal(normalizarTraducciones({ en: null }), null);
  assert.deepEqual(leerTraducciones('{roto'), {});
  assert.deepEqual(leerTraducciones('[1]'), {});
  assert.deepEqual(leerTraducciones(null), {});
});
