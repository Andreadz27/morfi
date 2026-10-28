'use strict';
// Inventario sin cargar dos veces:
// - Compra con artículos: al guardar una compra de mercadería (Contabilidad → Gastos) con lo que trajo el proveedor,
//   cada artículo suma al stock y el producto pasa a costar lo que se pagó (importe / cantidad). Los platos que lo
//   usan en su receta recalculan su costo. Anular la compra resta lo que había sumado (el costo no vuelve atrás:
//   el precio de la última compra sigue siendo el de referencia).
// - Conteo: se anota lo que hay de cada producto; la diferencia con lo que dice el sistema se registra como
//   entrada o salida y queda valorizada al costo, para ver cuánto se perdió (o sobró) en plata.
// Todo lo que cambia el stock deja su movimiento en movimientos_stock.
const { run, get, all } = require('../db');
const { errorHttp } = require('../util');
const { recalcularCostosConIngrediente } = require('./recetas');

const MAX_LINEAS = 100;
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const r4 = n => Math.round((Number(n) || 0) * 10000) / 10000;

async function productoInventariable(id) {
  const p = await get("SELECT id, nombre, clase, costo, tracking_stock FROM productos WHERE id = ? AND activo = 1", [id]);
  if (!p) throw errorHttp(400, 'Uno de los artículos no es un producto activo');
  // Una sub-receta no se compra: se compran sus insumos
  if (p.clase === 'elaboracion') throw errorHttp(400, `${p.nombre} es una elaboración propia: cargá sus insumos`);
  return p;
}

// ----- Compras -----
function normalizarArticulos(articulos) {
  if (!Array.isArray(articulos) || !articulos.length) return [];
  if (articulos.length > MAX_LINEAS) throw errorHttp(400, `Hasta ${MAX_LINEAS} artículos por compra`);
  return articulos.map(a => {
    const cantidad = Number(a && a.cantidad);
    const imp = a ? a.importe : undefined;
    const importe = imp === undefined || imp === '' || imp === null ? 0 : Number(imp);
    if (!Number.isFinite(cantidad) || cantidad <= 0) throw errorHttp(400, 'La cantidad de cada artículo tiene que ser mayor a cero');
    if (!Number.isFinite(importe) || importe < 0) throw errorHttp(400, 'El importe de un artículo no puede ser negativo');
    return { producto_id: Number(a.producto_id), cantidad: r4(cantidad), importe: r2(importe) };
  });
}

async function registrarArticulosCompraTx(gasto, articulos, usuarioId) {
  const lineas = normalizarArticulos(articulos);
  if (!lineas.length) return [];
  if (gasto.categoria !== 'mercaderia') throw errorHttp(400, 'Los artículos con stock van en compras de "Mercadería e insumos"');
  const proveedor = gasto.proveedor_id ? await get('SELECT nombre FROM proveedores WHERE id = ?', [gasto.proveedor_id]) : null;
  const motivo = `Compra #${gasto.id}${proveedor ? ' a ' + proveedor.nombre : ''}${gasto.numero_comprobante ? ' (' + gasto.numero_comprobante + ')' : ''}`.slice(0, 200);
  const productos = [];
  for (const l of lineas) {
    const p = await productoInventariable(l.producto_id);
    // Si se compra es porque se quiere seguir: queda con control de stock
    const costoNuevo = l.importe > 0 ? r4(l.importe / l.cantidad) : null;
    await run(`UPDATE productos SET tracking_stock = 1, stock_actual = stock_actual + ?${costoNuevo !== null ? ', costo = ?' : ''} WHERE id = ?`,
      costoNuevo !== null ? [l.cantidad, costoNuevo, p.id] : [l.cantidad, p.id]);
    await run("INSERT INTO movimientos_stock (producto_id, tipo, cantidad, motivo, usuario_id) VALUES (?, 'entrada', ?, ?, ?)",
      [p.id, l.cantidad, motivo, usuarioId || null]);
    await run('INSERT INTO gasto_articulos (gasto_id, producto_id, cantidad, monto, costo_anterior) VALUES (?, ?, ?, ?, ?)',
      [gasto.id, p.id, l.cantidad, l.importe, p.costo]);
    if (costoNuevo !== null && Number(p.costo) !== costoNuevo) await recalcularCostosConIngrediente(p.id);
    productos.push(p.id);
  }
  return productos;
}

// Anular la compra: se resta lo que había sumado (lo que ya se usó queda como está: el stock puede quedar bajo)
async function revertirArticulosCompraTx(gasto, usuarioId) {
  const lineas = await all('SELECT producto_id, cantidad FROM gasto_articulos WHERE gasto_id = ?', [gasto.id]);
  for (const l of lineas) {
    await run('UPDATE productos SET stock_actual = stock_actual - ? WHERE id = ?', [l.cantidad, l.producto_id]);
    await run("INSERT INTO movimientos_stock (producto_id, tipo, cantidad, motivo, usuario_id) VALUES (?, 'salida', ?, ?, ?)",
      [l.producto_id, l.cantidad, `Compra #${gasto.id} anulada`, usuarioId || null]);
  }
  return lineas.map(l => l.producto_id);
}

async function articulosDe(gastoIds) {
  if (!gastoIds.length) return {};
  const filas = await all(`SELECT a.gasto_id, a.producto_id, a.cantidad, a.monto AS importe, p.nombre, p.unidad
    FROM gasto_articulos a JOIN productos p ON p.id = a.producto_id
    WHERE a.gasto_id IN (${gastoIds.map(() => '?').join(',')}) ORDER BY a.id`, gastoIds);
  const por = {};
  for (const f of filas) (por[f.gasto_id] = por[f.gasto_id] || []).push(f);
  return por;
}

// ----- Conteo -----
// items: [{ producto_id, contado }]. Los que no se contaron no se mandan (no se tocan).
async function registrarConteoTx({ items, notas }, usuarioId) {
  if (!Array.isArray(items) || !items.length) throw errorHttp(400, 'Anotá lo contado de al menos un producto');
  if (items.length > 1000) throw errorHttp(400, 'Demasiados productos en un conteo');
  const vistos = new Set();
  const lineas = [];
  for (const it of items) {
    const contado = Number(it && it.contado);
    if (!Number.isFinite(contado) || contado < 0) throw errorHttp(400, 'Lo contado no puede ser negativo');
    const id = Number(it.producto_id);
    if (vistos.has(id)) throw errorHttp(400, 'Un producto aparece dos veces en el conteo');
    vistos.add(id);
    const p = await get('SELECT id, nombre, stock_actual, costo, tracking_stock FROM productos WHERE id = ? AND activo = 1', [id]);
    if (!p || !p.tracking_stock) throw errorHttp(400, 'Solo se cuentan productos con control de stock');
    lineas.push({ p, contado: r4(contado), diferencia: r4(contado - (Number(p.stock_actual) || 0)) });
  }
  const conDiferencia = lineas.filter(l => l.diferencia !== 0);
  const valor = r2(lineas.reduce((t, l) => t + l.diferencia * (Number(l.p.costo) || 0), 0));
  const { id } = await run('INSERT INTO conteos_stock (notas, productos, con_diferencia, valor_diferencia, usuario_id) VALUES (?, ?, ?, ?, ?)',
    [String(notas || '').trim().slice(0, 300), lineas.length, conDiferencia.length, valor, usuarioId || null]);
  for (const l of lineas) {
    await run('INSERT INTO conteo_stock_items (conteo_id, producto_id, sistema, contado, diferencia, costo) VALUES (?, ?, ?, ?, ?, ?)',
      [id, l.p.id, r4(l.p.stock_actual), l.contado, l.diferencia, Number(l.p.costo) || 0]);
    if (!l.diferencia) continue;
    // Relativo, como el resto de los movimientos: una venta en el medio no se pisa
    await run('UPDATE productos SET stock_actual = stock_actual + ? WHERE id = ?', [l.diferencia, l.p.id]);
    await run('INSERT INTO movimientos_stock (producto_id, tipo, cantidad, motivo, usuario_id) VALUES (?, ?, ?, ?, ?)',
      [l.p.id, l.diferencia > 0 ? 'entrada' : 'salida', Math.abs(l.diferencia), `Conteo #${id}`, usuarioId || null]);
  }
  await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)',
    [usuarioId || null, 'conteo_stock', `Conteo #${id}: ${lineas.length} productos, ${conDiferencia.length} con diferencia (${valor})`]);
  return { id, productos: lineas.length, con_diferencia: conDiferencia.length, valor_diferencia: valor };
}

const listarConteos = () => all(`SELECT c.*, u.nombre AS usuario_nombre FROM conteos_stock c
  LEFT JOIN usuarios u ON u.id = c.usuario_id ORDER BY c.id DESC LIMIT 50`);

async function detalleConteo(id) {
  const conteo = await get(`SELECT c.*, u.nombre AS usuario_nombre FROM conteos_stock c
    LEFT JOIN usuarios u ON u.id = c.usuario_id WHERE c.id = ?`, [id]);
  if (!conteo) throw errorHttp(404, 'Conteo no encontrado');
  conteo.items = await all(`SELECT i.*, p.nombre, p.unidad, ROUND(i.diferencia * i.costo, 2) AS valor
    FROM conteo_stock_items i JOIN productos p ON p.id = i.producto_id WHERE i.conteo_id = ? ORDER BY ABS(i.diferencia * i.costo) DESC, p.nombre`, [id]);
  return conteo;
}

module.exports = { registrarArticulosCompraTx, revertirArticulosCompraTx, articulosDe, registrarConteoTx, listarConteos, detalleConteo };
