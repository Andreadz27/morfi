// Insumos y sub-recetas: no se venden, la sub-receta rinde N presentaciones y un plato la usa como ingrediente
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { iniciarServidor, SECRET_KEY } = require('./helpers');

let s, mayonesa, yogurt, limon, ranch, pesto, sandwich, categoriaSola;
const crear = async (datos) => {
  const [st, r] = await s.llamar('POST', '/api/productos', { categoria_id: 1, precio_venta: 0, ...datos }, s.tokenAdmin);
  assert.equal(st, 201, JSON.stringify(r));
  return r.id;
};
const prod = async id => (await s.q('SELECT * FROM productos WHERE id = ?', [id]))[0];
const receta = (id, lineas, token = s.tokenAdmin) => s.llamar('PUT', `/api/productos/${id}/receta`, { lineas }, token);
const cerca = (a, b) => Math.abs(a - b) < 1e-6;

before(async () => {
  s = await iniciarServidor();
  // Costos por gramo; la mayonesa y el yogurt llevan stock (en g)
  mayonesa = await crear({ nombre: 'Mayonesa', clase: 'insumo', unidad: 'g', costo: 5, tracking_stock: 1, stock_actual: 1000, categoria_id: null });
  yogurt = await crear({ nombre: 'Yogurt griego natural', clase: 'insumo', unidad: 'g', costo: 8, tracking_stock: 1, stock_actual: 1000, categoria_id: null });
  limon = await crear({ nombre: 'Jugo de limón', clase: 'insumo', unidad: 'g', costo: 2, categoria_id: null });
  ranch = await crear({ nombre: 'Salsa Ranch', clase: 'elaboracion', rendimiento: 5, categoria_id: null });
  pesto = await crear({ nombre: 'Pesto de albahaca', clase: 'elaboracion', rendimiento: 4, categoria_id: null });
  sandwich = await crear({ nombre: 'Sándwich veggie', precio_venta: 10000, es_plato: 1 });
  // Una categoría con un solo insumo no aparece en la carta
  const [, cat] = await s.llamar('POST', '/api/categorias', { nombre: 'Depósito' }, s.tokenAdmin);
  categoriaSola = cat.id;
  await crear({ nombre: 'Harina', clase: 'insumo', unidad: 'g', categoria_id: categoriaSola });
});
after(async () => { await s.cerrar(); });

test('sub-receta: su costo es el de la receta dividido el rendimiento; el plato la usa por presentación', async () => {
  const [st, r] = await receta(ranch, [{ ingrediente_id: mayonesa, cantidad: 100 }, { ingrediente_id: yogurt, cantidad: 75 }]);
  assert.equal(st, 200, JSON.stringify(r));
  // 100 g * 5 + 75 g * 8 = 1100, rinde 5 => 220 por presentación
  assert.equal(r.costo, 220);
  assert.equal((await prod(ranch)).costo, 220);
  const [, g] = await s.llamar('GET', `/api/productos/${ranch}/receta`, null, s.tokenAdmin);
  assert.deepEqual([g.costo, g.costo_total, g.rendimiento, g.clase], [220, 1100, 5, 'elaboracion']);

  const [st2, r2] = await receta(sandwich, [{ ingrediente_id: ranch, cantidad: 1 }, { ingrediente_id: limon, cantidad: 10 }]);
  assert.equal(st2, 200, JSON.stringify(r2));
  assert.equal((await prod(sandwich)).costo, 220 + 20);
});

test('si sube un insumo, cambia la sub-receta y el plato que la usa; también si cambia el rendimiento', async () => {
  assert.equal((await s.llamar('PUT', `/api/productos/${mayonesa}`, { costo: 6 }, s.tokenAdmin))[0], 200);
  // 100 * 6 + 75 * 8 = 1200 / 5 = 240
  assert.equal((await prod(ranch)).costo, 240);
  assert.equal((await prod(sandwich)).costo, 260);
  assert.equal((await s.llamar('PUT', `/api/productos/${ranch}`, { rendimiento: 4 }, s.tokenAdmin))[0], 200);
  assert.equal((await prod(ranch)).costo, 300);
  assert.equal((await prod(sandwich)).costo, 320);
  // Cambiar la receta de la sub-receta también actualiza el plato
  await receta(ranch, [{ ingrediente_id: mayonesa, cantidad: 100 }, { ingrediente_id: yogurt, cantidad: 75 }, { ingrediente_id: limon, cantidad: 20 }]);
  assert.equal((await prod(ranch)).costo, 310);
  assert.equal((await prod(sandwich)).costo, 330);
});

test('vender el plato descuenta los insumos de la sub-receta en proporción', async () => {
  const antes = { may: (await prod(mayonesa)).stock_actual, yog: (await prod(yogurt)).stock_actual };
  const [st, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'takeaway', items: [{ producto_id: sandwich, cantidad: 2 }] }, s.tokenVendedor);
  assert.equal(st, 201, JSON.stringify(p));
  const [{ total }] = await s.q('SELECT total FROM pedidos WHERE id = ?', [p.id]);
  assert.equal((await s.llamar('POST', `/api/pedidos/${p.id}/pagar`, { metodo: 'efectivo', monto: total }, s.tokenVendedor))[0], 200);
  // 2 sándwiches x 1 presentación; la receta rinde 4: 2/4 de 100 g de mayonesa y de 75 g de yogurt
  assert.ok(cerca(antes.may - (await prod(mayonesa)).stock_actual, 50));
  assert.ok(cerca(antes.yog - (await prod(yogurt)).stock_actual, 37.5));
  const movs = await s.q('SELECT producto_id, motivo FROM movimientos_stock WHERE motivo LIKE ?', [`%${p.numero_pedido}%`]);
  assert.deepEqual(movs.map(m => m.producto_id).sort(), [mayonesa, yogurt].sort(), 'el limón no lleva stock; la salsa no tiene stock propio');
  assert.match(movs[0].motivo, /2 x Sándwich veggie/);
});

test('los insumos y las sub-recetas no se venden: ni en la carta, ni en el POS, ni en pedidos online', async () => {
  const [, menu] = await s.llamar('GET', '/api/publico/menu');
  const ids = menu.productos.map(p => p.id);
  assert.ok(ids.includes(sandwich));
  for (const id of [mayonesa, ranch]) assert.ok(!ids.includes(id), 'no sale en la carta');
  assert.ok(!menu.categorias.some(c => c.id === categoriaSola), 'una categoría con solo insumos no sale en la carta');
  const [st, r] = await s.llamar('POST', '/api/pedidos', { tipo: 'takeaway', items: [{ producto_id: ranch, cantidad: 1 }] }, s.tokenVendedor);
  assert.deepEqual([st, r.error], [400, 'Producto no disponible']);
  assert.equal((await s.llamar('POST', '/api/publico/pedido',
    { cliente: 'Ana', telefono: '1144443333', items: [{ producto_id: mayonesa, cantidad: 1 }] }))[0], 400);
  // El listado interno sí los trae (Productos, Stock y el editor de recetas), con su tipo
  const [, todos] = await s.llamar('GET', '/api/productos', null, s.tokenAdmin);
  assert.deepEqual(todos.filter(p => [mayonesa, ranch].includes(p.id)).map(p => p.clase).sort(), ['elaboracion', 'insumo']);
});

test('validaciones: un solo nivel, el insumo sin receta, tipos y rendimiento válidos', async () => {
  const error = async (promesa, re) => { const [st, r] = await promesa; assert.equal(st, 400, JSON.stringify(r)); assert.match(r.error, re); };
  await error(receta(pesto, [{ ingrediente_id: ranch, cantidad: 1 }]), /no puede llevar otra/);
  await error(receta(mayonesa, [{ ingrediente_id: limon, cantidad: 1 }]), /insumo no lleva receta/);
  // Un plato con receta sigue sin poder ser ingrediente
  await error(receta(pesto, [{ ingrediente_id: sandwich, cantidad: 1 }]), /receta propia/);
  // Cambiar de tipo sin armar recetas anidadas
  await error(s.llamar('PUT', `/api/productos/${ranch}`, { clase: 'venta' }, s.tokenAdmin), /no se puede cambiar de tipo/);
  await error(s.llamar('PUT', `/api/productos/${ranch}`, { clase: 'insumo' }, s.tokenAdmin), /insumo no lleva receta/);
  await error(s.llamar('PUT', `/api/productos/${mayonesa}`, { clase: 'elaboracion' }, s.tokenAdmin), /ingrediente de una sub-receta/);
  await error(s.llamar('PUT', `/api/productos/${limon}`, { clase: 'otra' }, s.tokenAdmin), /Tipo de producto inválido/);
  await error(s.llamar('PUT', `/api/productos/${ranch}`, { rendimiento: 0 }, s.tokenAdmin), /rendimiento/);
  assert.equal((await prod(ranch)).clase, 'elaboracion', 'no cambió nada');
});

test('recetario: las sub-recetas primero, con sus ingredientes; el cajero no lo ve', async () => {
  const [st, lista] = await s.llamar('GET', '/api/recetario', null, s.tokenAdmin);
  assert.equal(st, 200, JSON.stringify(lista));
  assert.deepEqual(lista.map(r => r.nombre), ['Salsa Ranch', 'Sándwich veggie'], 'el pesto todavía no tiene receta');
  assert.deepEqual(lista[0].lineas.map(l => [l.nombre, l.cantidad, l.unidad]),
    [['Mayonesa', 100, 'g'], ['Yogurt griego natural', 75, 'g'], ['Jugo de limón', 20, 'g']]);
  assert.equal((await s.llamar('GET', '/api/recetario', null, s.tokenVendedor))[0], 403);
});

test('npm run recetario:importar: crea insumos y sub-recetas; correrlo de nuevo no duplica', async () => {
  const archivo = path.join(s.dataDir, 'recetario.json');
  fs.writeFileSync(archivo, JSON.stringify({ subrecetas: [
    { nombre: 'Salsa tzatziki', rendimiento: 3, ingredientes: [
      { nombre: 'yogurt griego natural', cantidad: 150, unidad: 'g' }, // ya existe (sin importar mayúsculas)
      { nombre: 'Pepino rallado', cantidad: 40, unidad: 'g' },
      { nombre: 'Ralladura de lima', cantidad: 1, unidad: 'unidad' }] },
    { nombre: 'Pesto de albahaca', rendimiento: 6, ingredientes: [{ nombre: 'Albahaca', cantidad: 200, unidad: 'g' }] }
  ] }));
  const importar = () => execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'importar-recetario.js'), archivo],
    { env: { ...process.env, GM_DATA_DIR: s.dataDir, SECRET_KEY }, encoding: 'utf8' });
  assert.match(importar(), /Sub-recetas nuevas: +1[\s\S]*actualizadas: 1[\s\S]*Insumos nuevos: +3/);
  const tz = (await s.q("SELECT * FROM productos WHERE nombre = 'Salsa tzatziki'"))[0];
  assert.deepEqual([tz.clase, tz.rendimiento, tz.precio_venta], ['elaboracion', 3, 0]);
  assert.equal((await s.q("SELECT clase, unidad FROM productos WHERE nombre = 'Pepino rallado'"))[0].clase, 'insumo');
  // 150 g de yogurt a $8 / 3 presentaciones
  assert.equal(tz.costo, 400);
  assert.equal((await prod(pesto)).rendimiento, 6, 'la sub-receta que ya estaba se actualiza');
  const contar = async () => (await s.q('SELECT COUNT(*) c FROM productos'))[0].c;
  const antes = await contar();
  assert.match(importar(), /Sub-recetas nuevas: +0[\s\S]*actualizadas: 2[\s\S]*Insumos nuevos: +0/);
  assert.equal(await contar(), antes);
  assert.equal((await s.q('SELECT COUNT(*) c FROM recetas WHERE plato_id = ?', [tz.id]))[0].c, 3);
});
