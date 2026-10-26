// Venta cruzada: con qué se sugiere cada categoría, versión grande, horario de las promos y qué incluye un combo
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciarServidor } = require('./helpers');
const { disponibleAhora, textoHorario } = require('../src/servicios/venta-cruzada');

let s, cafes, bakery, latte, latteGrande, medialuna, promo;
const prod = async b => (await s.llamar('POST', '/api/productos', b, s.tokenAdmin))[1].id;
const carta = async () => (await s.llamar('GET', '/api/publico/menu'))[1];
// Hoy (día de la semana del local) y mañana, para armar horarios que estén o no vigentes ahora
let hoy;

before(async () => {
  s = await iniciarServidor();
  hoy = require('../src/servicios/cierre-dia').ahoraLocal().dia;
  cafes = (await s.llamar('POST', '/api/categorias', { nombre: 'Cafés VC' }, s.tokenAdmin))[1].id;
  bakery = (await s.llamar('POST', '/api/categorias', { nombre: 'Bakery VC' }, s.tokenAdmin))[1].id;
  latteGrande = await prod({ nombre: 'Latte grande VC', precio_venta: 6800, categoria_id: cafes });
  latte = await prod({ nombre: 'Latte VC', precio_venta: 6100, categoria_id: cafes, version_grande_id: latteGrande });
  medialuna = await prod({ nombre: 'Medialuna VC', precio_venta: 3900, categoria_id: bakery });
});
after(async () => { await s.cerrar(); });

test('horario: disponible y texto', () => {
  const h = { dias: [1, 2, 3, 4, 5], desde: '08:00', hasta: '12:00' };
  assert.equal(disponibleAhora(h, { dia: 2, hora: '09:30' }), true);
  assert.equal(disponibleAhora(h, { dia: 2, hora: '12:00' }), false, 'a las 12 en punto ya terminó');
  assert.equal(disponibleAhora(h, { dia: 6, hora: '09:30' }), false, 'sábado no');
  assert.equal(disponibleAhora(null, { dia: 6, hora: '03:00' }), true, 'sin horario, siempre');
  assert.equal(textoHorario(h), 'de lun a vie de 08:00 a 12:00');
});

test('categoría: con qué se sugiere (sin sí misma; las que no existen se rechazan)', async () => {
  assert.equal((await s.llamar('PUT', `/api/categorias/${cafes}`, { sugerir: [bakery, cafes] }, s.tokenAdmin))[0], 200);
  assert.equal((await s.q('SELECT sugerir FROM categorias WHERE id = ?', [cafes]))[0].sugerir, String(bakery));
  assert.equal((await s.llamar('PUT', `/api/categorias/${cafes}`, { sugerir: [999999] }, s.tokenAdmin))[0], 400);
  await s.llamar('POST', '/api/productos', { nombre: 'Algo VC', precio_venta: 1, categoria_id: cafes }, s.tokenAdmin);
  const c = (await carta()).categorias.find(x => x.id === cafes);
  assert.deepEqual(c.sugerir, [bakery]);
});

test('versión grande: se guarda, se conserva al editar y no puede ser el mismo producto', async () => {
  let p = (await carta()).productos.find(x => x.id === latte);
  assert.equal(p.version_grande_id, latteGrande);
  await s.llamar('PUT', `/api/productos/${latte}`, { precio_venta: 6200 }, s.tokenAdmin);
  p = (await carta()).productos.find(x => x.id === latte);
  assert.equal(p.version_grande_id, latteGrande);
  assert.equal((await s.llamar('PUT', `/api/productos/${latte}`, { version_grande_id: latte }, s.tokenAdmin))[0], 400);
  assert.equal((await s.llamar('PUT', `/api/productos/${latte}`, { version_grande_id: 999999 }, s.tokenAdmin))[0], 400);
});

test('combo: qué incluye, validado', async () => {
  const combo = { componentes: [{ productos: [latte, latteGrande], cantidad: 1 }, { productos: [medialuna], cantidad: 2 }] };
  promo = await prod({ nombre: 'Promo VC', precio_venta: 9500, categoria_id: bakery, combo });
  const p = (await carta()).productos.find(x => x.id === promo);
  assert.deepEqual(p.combo, combo);
  const put = c => s.llamar('PUT', `/api/productos/${promo}`, { combo: c }, s.tokenAdmin).then(r => r[0]);
  assert.equal(await put({ componentes: [{ productos: [promo], cantidad: 1 }] }), 400, 'no se incluye a sí mismo');
  assert.equal(await put({ componentes: [{ productos: [999999], cantidad: 1 }] }), 400);
  assert.equal(await put({ componentes: [{ productos: [latte], cantidad: 0 }] }), 400);
  assert.equal(await put(''), 200, 'vacío: deja de ser combo');
  assert.equal((await carta()).productos.find(x => x.id === promo).combo, null);
  await put(combo);
});

test('horario: el cliente no puede pedir la promo fuera de horario; en el punto de venta sí (solo avisa)', async () => {
  const otroDia = (hoy + 1) % 7;
  // Fuera de horario: solo otro día
  assert.equal((await s.llamar('PUT', `/api/productos/${promo}`, { horario: { dias: [otroDia], desde: '00:00', hasta: '23:59' } }, s.tokenAdmin))[0], 200);
  let p = (await carta()).productos.find(x => x.id === promo);
  assert.equal(p.disponible, false);
  assert.match(p.horario_texto, /00:00 a 23:59/);
  const [st, r] = await s.llamar('POST', '/api/publico/pedido', { cliente: 'Ana', telefono: '1155550000', tipo: 'takeaway',
    items: [{ producto_id: promo, cantidad: 1 }] });
  assert.equal(st, 400);
  assert.match(r.error, /Promo VC se pide/);
  assert.equal((await s.llamar('POST', '/api/pedidos', { tipo: 'mostrador', items: [{ producto_id: promo, cantidad: 1 }] }, s.tokenAdmin))[0], 201,
    'la cajera la puede cargar igual');
  // En horario (todo el día de hoy): el cliente la pide
  await s.llamar('PUT', `/api/productos/${promo}`, { horario: { dias: [hoy], desde: '00:00', hasta: '23:59' } }, s.tokenAdmin);
  p = (await carta()).productos.find(x => x.id === promo);
  assert.equal(p.disponible, true);
  assert.equal((await s.llamar('POST', '/api/publico/pedido', { cliente: 'Ana', telefono: '1155550000', tipo: 'takeaway',
    items: [{ producto_id: promo, cantidad: 1 }] }))[0], 201);
  // Horarios inválidos
  const put = h => s.llamar('PUT', `/api/productos/${promo}`, { horario: h }, s.tokenAdmin).then(r => r[0]);
  assert.equal(await put({ dias: [], desde: '08:00', hasta: '12:00' }), 400);
  assert.equal(await put({ dias: [1], desde: '12:00', hasta: '08:00' }), 400);
  assert.equal(await put({ dias: [1], desde: '8', hasta: '12:00' }), 400);
  assert.equal(await put(''), 200, 'vacío: siempre disponible');
});
