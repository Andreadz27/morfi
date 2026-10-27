'use strict';
// Recetas: los ingredientes de cada plato.
// - Al cobrar un plato con receta se descuenta el stock de sus ingredientes (no el del plato).
// - El costo del plato es la suma de sus ingredientes: se recalcula al guardar la receta y cuando cambia
//   el costo de un ingrediente. Así la rentabilidad y el costo teórico de Contabilidad usan el costo real.
// Sub-recetas: un producto de clase 'elaboracion' (Salsa Ranch) tiene receta y rinde N presentaciones.
// - Un plato la usa como ingrediente ("1 presentación"); su costo es el de la receta dividido el rendimiento.
// - Un solo nivel: una sub-receta lleva insumos, nunca otra sub-receta ni un plato con receta (sin ciclos).
// - Al vender el plato se descuentan los insumos de la sub-receta, en proporción.
// Los insumos ('insumo') y las sub-recetas no se venden: no salen en la carta, el POS ni los pedidos.
const { run, get, all } = require('../db');
const { errorHttp } = require('../util');

const MAX_LINEAS = 50;
const CLASES = ['venta', 'insumo', 'elaboracion'];
const r4 = n => Math.round((Number(n) || 0) * 10000) / 10000;

async function obtenerReceta(platoId) {
  const lineas = await all(`
    SELECT r.ingrediente_id, r.cantidad, i.nombre, i.unidad, COALESCE(i.costo, 0) AS costo_unitario,
           i.tracking_stock, i.stock_actual, i.clase
    FROM recetas r JOIN productos i ON i.id = r.ingrediente_id
    WHERE r.plato_id = ? ORDER BY r.id`, [platoId]);
  return lineas.map(l => ({ ...l, subtotal: r4(l.cantidad * l.costo_unitario) }));
}

const costoDe = lineas => Math.round(lineas.reduce((s, l) => s + l.cantidad * l.costo_unitario, 0) * 100) / 100;

// Costo de un producto con receta: el de sus ingredientes; el de una sub-receta, por presentación
const costoConReceta = (producto, lineas) =>
  Math.round(costoDe(lineas) / (producto.clase === 'elaboracion' ? Number(producto.rendimiento) || 1 : 1) * 100) / 100;

const tieneReceta = async id => !!(await get('SELECT 1 AS x FROM recetas WHERE plato_id = ? LIMIT 1', [id]));
const esIngredienteDe = async (id, soloSubRecetas) => !!(await get(`SELECT 1 AS x FROM recetas r JOIN productos p ON p.id = r.plato_id
  WHERE r.ingrediente_id = ? ${soloSubRecetas ? "AND p.clase = 'elaboracion'" : ''} LIMIT 1`, [id]));

// Reemplaza la receta (va dentro de transaccion()). lineas: [{ ingrediente_id, cantidad }]; vacía = sin receta.
async function guardarRecetaTx(platoId, lineas) {
  const plato = await get('SELECT id, clase, rendimiento FROM productos WHERE id = ?', [platoId]);
  if (!plato) throw errorHttp(404, 'Producto no encontrado');
  if (!Array.isArray(lineas)) throw errorHttp(400, 'Faltan los ingredientes');
  if (lineas.length > MAX_LINEAS) throw errorHttp(400, `Una receta tiene como máximo ${MAX_LINEAS} ingredientes`);
  const esSubReceta = plato.clase === 'elaboracion';
  if (lineas.length && plato.clase === 'insumo') throw errorHttp(400, 'Un insumo no lleva receta: si se prepara en la cocina, cambialo a sub-receta');
  // Un plato que es ingrediente de otro no puede tener receta (sin recetas anidadas ni ciclos); una sub-receta sí
  if (lineas.length && !esSubReceta && await esIngredienteDe(platoId))
    throw errorHttp(400, 'Este producto es ingrediente de otra receta: no puede tener receta propia');

  const porIngrediente = new Map();
  for (const l of lineas) {
    const ingredienteId = parseInt(l && l.ingrediente_id, 10);
    const cantidad = Number(l && l.cantidad);
    if (!ingredienteId) throw errorHttp(400, 'Ingrediente inválido');
    if (ingredienteId === Number(platoId)) throw errorHttp(400, 'Un producto no puede ser ingrediente de sí mismo');
    if (!Number.isFinite(cantidad) || cantidad <= 0 || cantidad > 100000) throw errorHttp(400, 'Cantidad de ingrediente inválida');
    const ing = await get('SELECT id, nombre, clase FROM productos WHERE id = ? AND activo = 1', [ingredienteId]);
    if (!ing) throw errorHttp(400, 'El ingrediente no existe o está inactivo');
    if (esSubReceta && ing.clase === 'elaboracion') throw errorHttp(400, `${ing.nombre} es una sub-receta: una sub-receta no puede llevar otra`);
    // Una sub-receta con receta propia sí puede ser ingrediente de un plato (se descuentan sus insumos)
    if (ing.clase !== 'elaboracion' && await tieneReceta(ingredienteId))
      throw errorHttp(400, `${ing.nombre} tiene receta propia: no se puede usar como ingrediente`);
    // El mismo ingrediente dos veces se suma
    porIngrediente.set(ingredienteId, r4((porIngrediente.get(ingredienteId) || 0) + cantidad));
  }

  await run('DELETE FROM recetas WHERE plato_id = ?', [platoId]);
  for (const [ingredienteId, cantidad] of porIngrediente) {
    const { unidad } = await get('SELECT unidad FROM productos WHERE id = ?', [ingredienteId]);
    await run('INSERT INTO recetas (plato_id, ingrediente_id, cantidad, unidad) VALUES (?, ?, ?, ?)',
      [platoId, ingredienteId, cantidad, unidad || 'unidad']);
  }
  const receta = await obtenerReceta(platoId);
  if (receta.length) {
    await run('UPDATE productos SET costo = ? WHERE id = ?', [costoConReceta(plato, receta), platoId]);
    // Cambió el costo de la sub-receta: también el de los platos que la usan
    if (esSubReceta) await recalcularCostosConIngrediente(platoId);
  }
  return receta;
}

// Cambió el costo de un ingrediente: actualiza el costo de los platos que lo usan (va dentro de transaccion()).
// Si uno de ellos es una sub-receta, sigue con los platos que la usan.
async function recalcularCostosConIngrediente(ingredienteId, vistos = new Set()) {
  const platos = await all(`SELECT DISTINCT p.id, p.clase, p.rendimiento FROM recetas r JOIN productos p ON p.id = r.plato_id
    WHERE r.ingrediente_id = ?`, [ingredienteId]);
  for (const plato of platos) {
    if (vistos.has(plato.id)) continue;
    vistos.add(plato.id);
    await run('UPDATE productos SET costo = ? WHERE id = ?', [costoConReceta(plato, await obtenerReceta(plato.id)), plato.id]);
    if (plato.clase === 'elaboracion') await recalcularCostosConIngrediente(plato.id, vistos);
  }
  return platos.length;
}

// Al cambiar el tipo de un producto no puede quedar una receta anidada (va dentro de transaccion())
async function validarClaseTx(id, clase) {
  if (!CLASES.includes(clase)) throw errorHttp(400, 'Tipo de producto inválido');
  if (clase === 'insumo' && await tieneReceta(id)) throw errorHttp(400, 'Tiene receta: un insumo no lleva receta (puede ser sub-receta)');
  if (clase === 'elaboracion' && await esIngredienteDe(id, true)) throw errorHttp(400, 'Es ingrediente de una sub-receta: no puede ser sub-receta');
  if (clase !== 'elaboracion' && await tieneReceta(id) && await esIngredienteDe(id))
    throw errorHttp(400, 'Es una sub-receta que usan otros platos: no se puede cambiar de tipo');
}

// Descuento de stock de un ítem vendido (dentro de la transacción del cobro).
// Con receta: los ingredientes que llevan stock; de una sub-receta con receta, sus insumos en proporción.
// Sin receta: el producto, si lleva stock (como antes).
async function descontarStockItemTx(item, pedido, usuarioId) {
  const ingredientesDe = id => all(`
    SELECT r.ingrediente_id, r.cantidad, i.tracking_stock, i.clase, i.rendimiento FROM recetas r JOIN productos i ON i.id = r.ingrediente_id
    WHERE r.plato_id = ?`, [id]);
  const ingredientes = await ingredientesDe(item.producto_id);
  const movimientos = [];
  for (const i of ingredientes) {
    const cantidad = i.cantidad * item.cantidad;
    const insumos = i.clase === 'elaboracion' ? await ingredientesDe(i.ingrediente_id) : [];
    if (!insumos.length) {
      if (i.tracking_stock) movimientos.push({ id: i.ingrediente_id, cantidad: r4(cantidad), receta: true });
      continue;
    }
    const rinde = Number(i.rendimiento) || 1;
    for (const s of insumos.filter(x => x.tracking_stock))
      movimientos.push({ id: s.ingrediente_id, cantidad: r4(cantidad * s.cantidad / rinde), receta: true });
  }
  if (!ingredientes.length) {
    const producto = await get('SELECT tracking_stock FROM productos WHERE id = ?', [item.producto_id]);
    if (producto && producto.tracking_stock) movimientos.push({ id: item.producto_id, cantidad: item.cantidad, receta: false });
  }
  for (const m of movimientos) {
    await run('UPDATE productos SET stock_actual = stock_actual - ? WHERE id = ?', [m.cantidad, m.id]);
    await run(`INSERT INTO movimientos_stock (producto_id, tipo, cantidad, motivo, usuario_id) VALUES (?, 'venta', ?, ?, ?)`,
      [m.id, -m.cantidad, m.receta ? `Venta ${pedido.numero_pedido} (${item.cantidad} x ${item.nombre_producto})` : `Venta ${pedido.numero_pedido}`, usuarioId || null]);
  }
}

// Recetario: los productos con receta (sub-recetas primero), con sus ingredientes
async function recetario() {
  const productos = await all(`SELECT p.id, p.nombre, p.clase, p.rendimiento, p.costo, p.precio_venta FROM productos p
    WHERE p.activo = 1 AND EXISTS (SELECT 1 FROM recetas r WHERE r.plato_id = p.id) ORDER BY p.clase = 'elaboracion' DESC, p.nombre`);
  for (const p of productos) p.lineas = await obtenerReceta(p.id);
  return productos;
}

module.exports = { obtenerReceta, guardarRecetaTx, recalcularCostosConIngrediente, descontarStockItemTx, validarClaseTx, recetario,
  costoConReceta, CLASES, costoReceta: costoDe };
