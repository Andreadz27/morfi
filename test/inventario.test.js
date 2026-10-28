// Inventario sin cargar dos veces: la compra con artículos suma al stock y actualiza el costo (y el de los platos
// que lo usan); anularla resta lo sumado; el conteo ajusta por diferencia y la valoriza al costo.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { iniciarServidor, SECRET_KEY } = require('./helpers');

let s, hoy, ricota, palta, plato, salsa;
before(async () => {
  s = await iniciarServidor();
  hoy = (await s.llamar('GET', '/api/contabilidad/opciones', undefined, s.tokenAdmin))[1].hoy;
  const crear = async (datos) => (await s.llamar('POST', '/api/productos', datos, s.tokenAdmin))[1].id;
  ricota = await crear({ nombre: 'Ricota prueba', clase: 'insumo', unidad: 'g', costo: 5, precio_venta: 0 });
  palta = await crear({ nombre: 'Palta prueba', clase: 'insumo', unidad: 'unidad', costo: 900, precio_venta: 0, tracking_stock: 1, stock_actual: 4 });
  salsa = await crear({ nombre: 'Salsa prueba', clase: 'elaboracion', unidad: 'unidad', precio_venta: 0 });
  plato = await crear({ nombre: 'Tostada prueba', precio_venta: 5000, es_plato: 1 });
  // La tostada lleva 100 g de ricota y media palta
  const [st] = await s.llamar('PUT', `/api/productos/${plato}/receta`, { lineas: [
    { ingrediente_id: ricota, cantidad: 100 }, { ingrediente_id: palta, cantidad: 0.5 }] }, s.tokenAdmin);
  assert.equal(st, 200);
});
after(() => s.cerrar());

const producto = async id => (await s.q('SELECT stock_actual, costo, tracking_stock FROM productos WHERE id = ?', [id]))[0];
const compra = (articulos, extra = {}) => s.llamar('POST', '/api/contabilidad/gastos', {
  fecha: hoy, categoria: 'mercaderia', descripcion: 'Compra verdulería', tipo_comprobante: 'factura_b', neto: 60000, articulos, ...extra
}, s.tokenAdmin);

test('compra con artículos: suma stock, prende el control, actualiza el costo y el del plato', async () => {
  const [st, r] = await compra([{ producto_id: ricota, cantidad: 5000, importe: 40000 }, { producto_id: palta, cantidad: 20, importe: 20000 }]);
  assert.equal(st, 201, JSON.stringify(r));
  const ri = await producto(ricota), pa = await producto(palta);
  assert.equal(ri.tracking_stock, 1, 'la ricota pasa a tener control de stock');
  assert.equal(ri.stock_actual, 5000);
  assert.equal(ri.costo, 8);          // 40000 / 5000 g
  assert.equal(pa.stock_actual, 24);  // 4 + 20
  assert.equal(pa.costo, 1000);
  // Tostada: 100 g × $8 + 0,5 × $1000
  assert.equal((await producto(plato)).costo, 1300);
  const movs = await s.q("SELECT motivo FROM movimientos_stock WHERE producto_id = ? AND tipo = 'entrada'", [ricota]);
  assert.match(movs[0].motivo, new RegExp(`^Compra #${r.id}`));
  // El listado de gastos trae los artículos
  const [, gastos] = await s.llamar('GET', `/api/contabilidad/gastos?desde=${hoy}&hasta=${hoy}`, undefined, s.tokenAdmin);
  const g = gastos.find(x => x.id === r.id);
  assert.deepEqual(g.articulos.map(a => [a.nombre, a.cantidad]), [['Ricota prueba', 5000], ['Palta prueba', 20]]);

  // Anular: se resta lo sumado; el costo queda el de la última compra
  assert.equal((await s.llamar('DELETE', `/api/contabilidad/gastos/${r.id}`, undefined, s.tokenAdmin))[0], 200);
  assert.equal((await producto(ricota)).stock_actual, 0);
  assert.equal((await producto(palta)).stock_actual, 4);
  assert.equal((await producto(ricota)).costo, 8);
});

test('compra: reglas de los artículos', async () => {
  assert.equal((await compra([{ producto_id: ricota, cantidad: 1000 }], { categoria: 'servicios' }))[0], 400, 'solo en mercadería');
  assert.equal((await compra([{ producto_id: ricota, cantidad: 0, importe: 10 }]))[0], 400, 'cantidad cero');
  assert.equal((await compra([{ producto_id: salsa, cantidad: 1, importe: 10 }]))[0], 400, 'una elaboración no se compra');
  assert.equal((await compra([{ producto_id: 999999, cantidad: 1 }]))[0], 400, 'producto inexistente');
  // Sin importe: suma stock pero no toca el costo
  const antes = (await producto(palta)).costo;
  const [st, r] = await compra([{ producto_id: palta, cantidad: 2 }]);
  assert.equal(st, 201);
  assert.equal((await producto(palta)).costo, antes);
  // Ya sumó stock: no puede dejar de ser mercadería
  assert.equal((await s.llamar('PUT', `/api/contabilidad/gastos/${r.id}`, { categoria: 'otros' }, s.tokenAdmin))[0], 400);
  // Si falla un artículo no queda nada a medias (ni el gasto ni el stock del primero)
  const stockAntes = (await producto(palta)).stock_actual;
  const gastosAntes = (await s.q('SELECT COUNT(*) AS n FROM gastos'))[0].n;
  assert.equal((await compra([{ producto_id: palta, cantidad: 3, importe: 3000 }, { producto_id: salsa, cantidad: 1 }]))[0], 400);
  assert.equal((await producto(palta)).stock_actual, stockAntes);
  assert.equal((await s.q('SELECT COUNT(*) AS n FROM gastos'))[0].n, gastosAntes);
});

test('conteo: ajusta por diferencia, la valoriza al costo y deja el detalle', async () => {
  await compra([{ producto_id: ricota, cantidad: 3000, importe: 24000 }]);   // ricota: 3000 g a $8
  const sistemaPalta = (await producto(palta)).stock_actual;
  const [st, r] = await s.llamar('POST', '/api/stock/conteos', { notas: 'Cierre semanal', items: [
    { producto_id: ricota, contado: 2800 },          // faltan 200 g → −$1600
    { producto_id: palta, contado: sistemaPalta }    // justo
  ] }, s.tokenAdmin);
  assert.equal(st, 201, JSON.stringify(r));
  assert.equal(r.productos, 2);
  assert.equal(r.con_diferencia, 1);
  assert.equal(r.valor_diferencia, -1600);
  assert.equal((await producto(ricota)).stock_actual, 2800);
  const [, det] = await s.llamar('GET', `/api/stock/conteos/${r.id}`, undefined, s.tokenAdmin);
  assert.equal(det.notas, 'Cierre semanal');
  assert.deepEqual(det.items.map(i => [i.nombre, i.sistema, i.contado, i.diferencia, i.valor]),
    [['Ricota prueba', 3000, 2800, -200, -1600], ['Palta prueba', sistemaPalta, sistemaPalta, 0, 0]]);
  const mov = (await s.q("SELECT tipo, cantidad, motivo FROM movimientos_stock WHERE producto_id = ? ORDER BY id DESC LIMIT 1", [ricota]))[0];
  assert.deepEqual([mov.tipo, mov.cantidad, mov.motivo], ['salida', 200, `Conteo #${r.id}`]);
  const [, lista] = await s.llamar('GET', '/api/stock/conteos', undefined, s.tokenAdmin);
  assert.equal(lista[0].id, r.id);

  // Reglas
  assert.equal((await s.llamar('POST', '/api/stock/conteos', { items: [] }, s.tokenAdmin))[0], 400);
  assert.equal((await s.llamar('POST', '/api/stock/conteos', { items: [{ producto_id: ricota, contado: -1 }] }, s.tokenAdmin))[0], 400);
  assert.equal((await s.llamar('POST', '/api/stock/conteos', { items: [{ producto_id: plato, contado: 3 }] }, s.tokenAdmin))[0], 400, 'sin control de stock');
  assert.equal((await s.llamar('POST', '/api/stock/conteos', { items: [{ producto_id: ricota, contado: 1 }, { producto_id: ricota, contado: 2 }] }, s.tokenAdmin))[0], 400);
});

test('permisos: cocina ve los conteos pero no cuenta; sin permiso de contabilidad no se carga la compra', async () => {
  const [, u] = await s.llamar('POST', '/api/usuarios', { nombre: 'Cocina Test', email: 'cocina-inv@test.com', password: 'cocina1234', rol: 'cocina' }, s.tokenAdmin);
  // Recién creado tendría que cambiar la clave antes de usar el sistema (todo daría 403 por eso)
  await s.q('UPDATE usuarios SET debe_cambiar_password = 0 WHERE id = ?', [u.id]);
  const token = jwt.sign({ id: u.id }, SECRET_KEY);
  assert.equal((await s.llamar('GET', '/api/stock/conteos', undefined, token))[0], 200);
  assert.equal((await s.llamar('POST', '/api/stock/conteos', { items: [{ producto_id: ricota, contado: 1 }] }, token))[0], 403);
  assert.equal((await s.llamar('POST', '/api/contabilidad/gastos', { fecha: hoy, categoria: 'mercaderia', descripcion: 'x',
    tipo_comprobante: 'factura_b', neto: 10, articulos: [{ producto_id: ricota, cantidad: 1 }] }, token))[0], 403);
});
