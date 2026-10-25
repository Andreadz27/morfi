// Opciones y adicionales de los productos ("¿Qué leche?", "Adicionales"): el recargo sale de la base,
// se valida contra los grupos del producto y el nombre lleva lo elegido en cocina, ticket y factura.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciarServidor } = require('./helpers');

let s, latte, tostado, leche, extras;
const op = (g, nombre) => g.opciones.find(o => o.nombre === nombre).id;
const grupo = async id => (await s.llamar('GET', '/api/opciones/grupos', undefined, s.tokenAdmin))[1].find(g => g.id === id);
const pedir = (items, token = s.tokenAdmin) => s.llamar('POST', '/api/pedidos', { tipo: 'mostrador', items }, token);
const itemsDe = id => s.q('SELECT nombre_producto, precio_unitario, subtotal, opciones FROM pedido_items WHERE pedido_id = ? ORDER BY id', [id]);

before(async () => {
  s = await iniciarServidor();
  latte = (await s.llamar('POST', '/api/productos', { nombre: 'Latte O', precio_venta: 6100 }, s.tokenAdmin))[1].id;
  tostado = (await s.llamar('POST', '/api/productos', { nombre: 'Tostado O', precio_venta: 13000 }, s.tokenAdmin))[1].id;
  const [st1, l] = await s.llamar('POST', '/api/opciones/grupos', { nombre: '¿Qué leche?', tipo: 'una', obligatorio: true, productos: [latte],
    opciones: [{ nombre: 'Entera' }, { nombre: 'Descremada' }, { nombre: 'Vegetal', precio: 1300, traducciones: { en: { nombre: 'Plant-based' } } }],
    traducciones: { en: { nombre: 'Which milk?' } } }, s.tokenAdmin);
  assert.equal(st1, 201);
  const [st2, e] = await s.llamar('POST', '/api/opciones/grupos', { nombre: 'Adicionales', tipo: 'varias', maximo: 2, productos: [latte],
    opciones: [{ nombre: 'Shot extra', precio: 900 }, { nombre: 'Crema', precio: 500 }, { nombre: 'Canela', precio: 0 }] }, s.tokenAdmin);
  assert.equal(st2, 201);
  leche = await grupo(l.id);
  extras = await grupo(e.id);
});
after(async () => { await s.cerrar(); });

test('el precio suma los adicionales desde la base y el nombre lleva lo elegido', async () => {
  const [st, p] = await pedir([{ producto_id: latte, cantidad: 2, opciones: [op(leche, 'Vegetal'), op(extras, 'Shot extra')], precio: 1 }]);
  assert.equal(st, 201);
  const [it] = await itemsDe(p.id);
  assert.equal(it.precio_unitario, 6100 + 1300 + 900, 'el precio del navegador no cuenta');
  assert.equal(it.subtotal, (6100 + 1300 + 900) * 2);
  assert.equal(it.nombre_producto, 'Latte O · Vegetal, Shot extra');
  assert.deepEqual(JSON.parse(it.opciones).map(o => o.nombre), ['Vegetal', 'Shot extra']);
  assert.equal(p.total, (6100 + 1300 + 900) * 2);
});

test('si no se elige la opción obligatoria va la primera (pedidos del asistente o de clientes viejos)', async () => {
  const [, p] = await pedir([{ producto_id: latte, cantidad: 1 }, { producto_id: tostado, cantidad: 1 }]);
  const [l, t] = await itemsDe(p.id);
  assert.equal(l.nombre_producto, 'Latte O · Entera');
  assert.equal(l.precio_unitario, 6100);
  assert.equal(t.nombre_producto, 'Tostado O', 'un producto sin opciones queda igual');
  assert.equal(t.opciones, '');
});

test('opciones inválidas se rechazan sin crear el pedido', async () => {
  const antes = (await s.q('SELECT COUNT(*) AS n FROM pedidos'))[0].n;
  const mal = async (opciones, prod = latte) => (await pedir([{ producto_id: prod, cantidad: 1, opciones }]))[0];
  assert.equal(await mal([op(leche, 'Entera'), op(leche, 'Vegetal')]), 400, 'dos leches');
  assert.equal(await mal([op(extras, 'Shot extra'), op(extras, 'Crema'), op(extras, 'Canela')]), 400, 'más adicionales que el tope');
  assert.equal(await mal([op(extras, 'Crema')], tostado), 400, 'opción de otro producto');
  assert.equal(await mal([999999]), 400);
  assert.equal(await mal(['x']), 400);
  assert.equal((await s.q('SELECT COUNT(*) AS n FROM pedidos'))[0].n, antes);
});

test('editar el grupo: cambiar precio, sacar y agregar opciones; los pedidos viejos no cambian', async () => {
  const [, viejo] = await pedir([{ producto_id: latte, cantidad: 1, opciones: [op(extras, 'Crema')] }]);
  const crema = op(extras, 'Crema');
  const [st] = await s.llamar('PUT', `/api/opciones/grupos/${extras.id}`, { nombre: 'Adicionales', tipo: 'varias', maximo: 2, productos: [latte],
    opciones: [{ id: op(extras, 'Shot extra'), nombre: 'Shot extra', precio: 1000 }, { nombre: 'Miel', precio: 400 }] }, s.tokenAdmin);
  assert.equal(st, 200);
  const g = await grupo(extras.id);
  assert.deepEqual(g.opciones.map(o => [o.nombre, o.precio]), [['Shot extra', 1000], ['Miel', 400]]);
  assert.equal((await pedir([{ producto_id: latte, cantidad: 1, opciones: [crema] }]))[0], 400, 'la crema ya no está');
  const [, nuevo] = await pedir([{ producto_id: latte, cantidad: 1, opciones: [op(g, 'Shot extra'), op(g, 'Miel')] }]);
  assert.equal((await itemsDe(nuevo.id))[0].precio_unitario, 6100 + 1000 + 400);
  assert.equal((await itemsDe(viejo.id))[0].precio_unitario, 6100 + 500, 'el pedido viejo conserva su precio');
  extras = g;
});

test('agregar a un pedido abierto, QR de mesa y pedido online también cobran las opciones', async () => {
  const [, p] = await pedir([{ producto_id: tostado, cantidad: 1 }]);
  assert.equal((await s.llamar('POST', `/api/pedidos/${p.id}/items`, { producto_id: latte, cantidad: 1, opciones: [op(leche, 'Vegetal')] }, s.tokenAdmin))[0], 201);
  assert.equal((await itemsDe(p.id))[1].precio_unitario, 6100 + 1300);

  const [online, r] = await s.llamar('POST', '/api/publico/pedido', { cliente: 'Ana', telefono: '1155550000', tipo: 'takeaway',
    items: [{ producto_id: latte, cantidad: 1, opciones: [op(leche, 'Descremada'), op(extras, 'Miel')] }] });
  assert.equal(online, 201);
  const [it] = await itemsDe(r.id);
  assert.equal(it.nombre_producto, 'Latte O · Descremada, Miel');
  assert.equal(it.precio_unitario, 6100 + 400);

  const [mesa] = await s.q("INSERT INTO mesas (nombre, capacidad, sector, orden, estado, qr_token) VALUES ('Mesa Opciones', 4, 'T', 99, 'libre', 'abcabcabcabcabcabcabcabc') RETURNING id, qr_token");
  await s.q("UPDATE configuracion SET qr_mesa_modo = 'directo' WHERE id = 1");
  const [stM] = await s.llamar('POST', `/api/publico/mesa/${mesa.qr_token}/pedido`, { items: [{ producto_id: latte, cantidad: 1, opciones: [op(leche, 'Vegetal')] }] });
  assert.ok([200, 201].includes(stM));
  const [ped] = await s.q("SELECT id FROM pedidos WHERE mesa_id = ? AND estado = 'abierto'", [mesa.id]);
  assert.equal((await itemsDe(ped.id))[0].precio_unitario, 6100 + 1300);
});

test('la carta y el punto de venta reciben los grupos de cada producto; solo el catálogo los edita', async () => {
  const [, carta] = await s.llamar('GET', '/api/publico/menu');
  const p = carta.productos.find(x => x.id === latte);
  assert.deepEqual(p.grupos.sort(), [leche.id, extras.id].sort());
  const g = carta.grupos.find(x => x.id === leche.id);
  assert.equal(g.traducciones.en.nombre, 'Which milk?');
  assert.equal(g.opciones.find(o => o.nombre === 'Vegetal').traducciones.en.nombre, 'Plant-based');
  const [, prods] = await s.llamar('GET', '/api/productos', undefined, s.tokenVendedor);
  assert.equal(prods.find(x => x.id === tostado).grupos.length, 0);
  assert.equal((await s.llamar('POST', '/api/opciones/grupos', { nombre: 'X', opciones: [{ nombre: 'a' }] }, s.tokenVendedor))[0], 403);
  // Validaciones del grupo
  const crear = b => s.llamar('POST', '/api/opciones/grupos', { nombre: 'Y', opciones: [{ nombre: 'a' }], ...b }, s.tokenAdmin).then(r => r[0]);
  assert.equal(await crear({ nombre: '' }), 400);
  assert.equal(await crear({ opciones: [] }), 400);
  assert.equal(await crear({ opciones: [{ nombre: 'a', precio: -1 }] }), 400);
  assert.equal(await crear({ productos: [999999] }), 400);
});
