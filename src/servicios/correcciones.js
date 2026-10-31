'use strict';
// Correcciones después de cobrar: cambiar el medio de pago de un cobro mal cargado y eliminar un pedido
// (cargado por error, duplicado o de prueba), aunque ya esté cobrado.
// Caja, cierre del día, reportes y ganancias se calculan desde los pagos, así que se corrigen solos. Si el cobro
// era de una caja ya cerrada o de un día ya cerrado, se rehace su resumen guardado (lo contado no se toca: la
// diferencia se recalcula).
const { run, get, all, transaccion } = require('../db');
const { emitEvento } = require('../realtime');
const { errorHttp } = require('../util');
const { LOCAL } = require('../tiempo');
const { redondear, resumenCaja } = require('./caja');
const { resumenDelDia } = require('./cierre-dia');
const { facturaVigente } = require('./facturacion');
const { revertirFidelizacionTx } = require('./fidelizacion');
const { METODOS_PAGO, recalcularTotales, saldoPedido } = require('./pedidos');

const MOTIVOS_ELIMINAR = ['Cargado por error', 'Pedido duplicado', 'Era una prueba', 'El cliente se fue', 'Otro'];

// Cajas cerradas y cierres del día que incluyen esos momentos (fechas UTC de la base): se rehace su resumen
async function actualizarCierresTx(fechas) {
  const cajas = new Map();
  const dias = new Set();
  for (const f of fechas.filter(Boolean)) {
    for (const c of await all("SELECT * FROM caja WHERE estado = 'cerrada' AND fecha_apertura <= ? AND fecha_cierre >= ?", [f, f])) cajas.set(c.id, c);
    dias.add((await get(`SELECT date(?, ${LOCAL()}) AS d`, [f])).d);
  }
  for (const caja of cajas.values()) {
    const resumen = await resumenCaja(caja);
    const contado = caja.monto_final_real;
    const diferencia = contado === null || contado === undefined ? null : redondear(contado - resumen.efectivo_esperado);
    await run('UPDATE caja SET resumen = ?, monto_esperado = ?, diferencia = ? WHERE id = ?',
      [JSON.stringify(resumen), resumen.efectivo_esperado, diferencia, caja.id]);
  }
  for (const d of dias) {
    if (await get('SELECT id FROM cierres_dia WHERE fecha = ?', [d]))
      await run('UPDATE cierres_dia SET resumen = ?, actualizado_en = CURRENT_TIMESTAMP WHERE fecha = ?', [JSON.stringify(await resumenDelDia(d)), d]);
  }
  return [...cajas.keys()];
}

// El medio "principal" del pedido (el que se ve en listados): uno solo o "mixto"
async function actualizarMetodoPedidoTx(pedidoId) {
  const metodos = await all('SELECT DISTINCT metodo FROM pagos WHERE pedido_id = ?', [pedidoId]);
  if (metodos.length) await run('UPDATE pedidos SET metodo_pago = ? WHERE id = ?', [metodos.length === 1 ? metodos[0].metodo : 'mixto', pedidoId]);
}

const nombreUsuario = async id => ((await get('SELECT nombre FROM usuarios WHERE id = ?', [id])) || {}).nombre || `usuario ${id}`;

async function corregirMedioDePago(pedidoId, pagoId, metodo, usuarioId) {
  if (!METODOS_PAGO.includes(metodo) || metodo === 'giftcard') throw errorHttp(400, 'Elegí un medio de pago válido');
  const r = await transaccion(async () => {
    const pago = await get('SELECT pg.*, p.numero_pedido, p.estado FROM pagos pg JOIN pedidos p ON p.id = pg.pedido_id WHERE pg.id = ? AND pg.pedido_id = ?',
      [pagoId, pedidoId]);
    if (!pago) throw errorHttp(404, 'Ese cobro no es de este pedido');
    if (pago.metodo === 'giftcard') throw errorHttp(400, 'Un pago con gift card no se puede cambiar: ya descontó el saldo de la tarjeta');
    if (pago.metodo === metodo) return { sinCambios: true, pago };
    // El número de operación de Mercado Pago (MP-…) es de una tarjeta o transferencia: en efectivo no corresponde
    const referencia = metodo === 'efectivo' ? '' : pago.referencia;
    await run('UPDATE pagos SET metodo = ?, referencia = ? WHERE id = ?', [metodo, referencia || '', pago.id]);
    await actualizarMetodoPedidoTx(pedidoId);
    // La nube vuelve a recibir la venta con el medio nuevo
    await run('UPDATE pedidos SET sincronizado_nube = NULL WHERE id = ?', [pedidoId]);
    const cajas = await actualizarCierresTx([pago.fecha]);
    await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)', [usuarioId, 'corregir_pago',
      `Pedido ${pago.numero_pedido}: cobro de ${redondear(pago.monto)} cambiado de ${pago.metodo} a ${metodo} por ${await nombreUsuario(usuarioId)}` +
      (cajas.length ? ` (se actualizó la caja cerrada #${cajas.join(', #')})` : '')]);
    return { pago, cajas };
  });
  if (!r.sinCambios) {
    emitEvento('dashboard:actualizar', { motivo: 'pago_corregido' });
    emitEvento('caja:actualizar', { pedido_id: Number(pedidoId) });
  }
  return { ok: true, metodo, cajas_actualizadas: r.cajas || [] };
}

// Devuelve al stock lo que descontó la venta (los movimientos "Venta <número>")
async function devolverStockTx(pedido, usuarioId) {
  const movs = await all(`SELECT producto_id, cantidad FROM movimientos_stock WHERE tipo = 'venta' AND (motivo = ? OR motivo LIKE ?)`,
    [`Venta ${pedido.numero_pedido}`, `Venta ${pedido.numero_pedido} (%`]);
  for (const m of movs) {
    await run('UPDATE productos SET stock_actual = stock_actual + ? WHERE id = ?', [-m.cantidad, m.producto_id]);
    await run(`INSERT INTO movimientos_stock (producto_id, tipo, cantidad, motivo, usuario_id) VALUES (?, 'anulacion', ?, ?, ?)`,
      [m.producto_id, -m.cantidad, `Pedido ${pedido.numero_pedido} eliminado`, usuarioId || null]);
  }
}

// Quita los puntos que el cliente ganó con este pedido
async function quitarPuntosGanadosTx(pedido, usuarioId) {
  const g = await get("SELECT cliente_id, COALESCE(SUM(puntos), 0) AS puntos FROM puntos_movimientos WHERE pedido_id = ? AND tipo = 'gana' GROUP BY cliente_id", [pedido.id]);
  if (!g || !(g.puntos > 0)) return;
  await run('INSERT INTO puntos_movimientos (cliente_id, pedido_id, puntos, tipo, detalle, usuario_id) VALUES (?, ?, ?, ?, ?, ?)',
    [g.cliente_id, pedido.id, -g.puntos, 'ajuste', `Pedido ${pedido.numero_pedido} eliminado`, usuarioId]);
  await run('UPDATE clientes SET puntos = COALESCE(puntos, 0) - ? WHERE id = ?', [g.puntos, g.cliente_id]);
}

// Eliminar: el pedido queda en "Cancelados" con el motivo (no se borra, para poder revisarlo), sin cobros, y no
// cuenta en ventas, caja ni ganancias. Vuelven el stock, los puntos y el cupón; la mesa queda libre.
async function eliminarPedido(pedidoId, { motivo, detalle = '' }, usuarioId) {
  motivo = String(motivo || '').trim();
  detalle = String(detalle || '').trim().slice(0, 200);
  if (!MOTIVOS_ELIMINAR.includes(motivo)) throw errorHttp(400, 'Elegí por qué se elimina el pedido');
  if (motivo === 'Otro' && !detalle) throw errorHttp(400, 'Escribí el motivo');
  const r = await transaccion(async () => {
    const pedido = await get('SELECT * FROM pedidos WHERE id = ?', [pedidoId]);
    if (!pedido) throw errorHttp(404, 'Pedido no encontrado');
    if (pedido.estado === 'cancelado') throw errorHttp(400, 'Ese pedido ya está eliminado');
    if (await facturaVigente(pedido.id)) throw errorHttp(400, 'El pedido tiene factura: primero anulala con nota de crédito (en el detalle del pedido)');
    const pagos = await all('SELECT * FROM pagos WHERE pedido_id = ? ORDER BY id', [pedido.id]);
    if (pagos.some(p => p.metodo === 'giftcard')) throw errorHttp(400, 'Se pagó con gift card: no se puede eliminar desde acá');

    if (pedido.estado === 'pagado') {
      await devolverStockTx(pedido, usuarioId);
      await quitarPuntosGanadosTx(pedido, usuarioId);
    }
    await revertirFidelizacionTx(pedido.id, usuarioId);
    await run('DELETE FROM pagos WHERE pedido_id = ?', [pedido.id]);
    const texto = motivo === 'Otro' ? detalle : detalle ? `${motivo}: ${detalle}` : motivo;
    await run(`UPDATE pedidos SET estado = 'cancelado', cerrado_en = COALESCE(cerrado_en, CURRENT_TIMESTAMP), sincronizado_nube = NULL,
      notas = TRIM(COALESCE(notas, '') || ' ' || ?) WHERE id = ?`, [`[Eliminado: ${texto}]`, pedido.id]);
    if (pedido.mesa_id && pedido.estado === 'abierto') await run("UPDATE mesas SET estado = 'libre' WHERE id = ?", [pedido.mesa_id]);
    const cajas = await actualizarCierresTx([...pagos.map(p => p.fecha), pedido.cerrado_en]);
    const cobros = pagos.map(p => `${p.metodo} ${redondear(p.monto)}${p.referencia ? ' ' + p.referencia : ''}`).join(' + ');
    await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)', [usuarioId, 'eliminar_pedido',
      `Pedido ${pedido.numero_pedido} (${redondear(pedido.total)}) eliminado por ${await nombreUsuario(usuarioId)}. Motivo: ${texto}.` +
      (cobros ? ` Cobros quitados: ${cobros}.` : '') + (cajas.length ? ` Se actualizó la caja cerrada #${cajas.join(', #')}.` : '')]);
    return { pedido, devolver: pagos.reduce((s, p) => s + p.monto, 0), cajas };
  });
  const id = Number(pedidoId);
  emitEvento('pedido:cancelado', { id, numero_pedido: r.pedido.numero_pedido });
  emitEvento('cocina:actualizar', { pedido_id: id, accion: 'cancelado' });
  emitEvento('delivery:actualizar', { pedido_id: id, accion: 'cancelado' });
  emitEvento('dashboard:actualizar', { motivo: 'pedido_eliminado' });
  emitEvento('stock:actualizar', { pedido_id: id, accion: 'anulacion' });
  return { ok: true, estado_anterior: r.pedido.estado, cobrado: redondear(r.devolver), cajas_actualizadas: r.cajas };
}

// Quitar un producto (o algunas unidades) de un pedido abierto. Lo ya cobrado de ese plato (cuenta dividida por
// plato) no se puede quitar, y el total no puede quedar por debajo de lo ya cobrado.
async function quitarItem(pedidoId, itemId, cantidad, usuarioId) {
  const r = await transaccion(async () => {
    const pedido = await get('SELECT * FROM pedidos WHERE id = ?', [pedidoId]);
    if (!pedido) throw errorHttp(404, 'Pedido no encontrado');
    if (pedido.estado !== 'abierto') throw errorHttp(400, 'Solo se quitan productos de un pedido abierto');
    const item = await get('SELECT * FROM pedido_items WHERE id = ? AND pedido_id = ?', [itemId, pedidoId]);
    if (!item) throw errorHttp(404, 'Ese producto no es de este pedido');
    const actual = Number(item.cantidad) || 0;
    const quitar = cantidad === undefined || cantidad === null || cantidad === '' ? actual : Number(cantidad);
    if (!(quitar > 0) || quitar > actual + 1e-9) throw errorHttp(400, 'Cantidad inválida');
    if (actual - quitar < (Number(item.cantidad_pagada) || 0) - 1e-9) throw errorHttp(400, 'Esa parte ya está cobrada: no se puede quitar');
    const quedan = Math.round((actual - quitar) * 10000) / 10000;
    if (quedan <= 0) {
      const { n } = await get('SELECT COUNT(*) AS n FROM pedido_items WHERE pedido_id = ?', [pedidoId]);
      if (n <= 1) throw errorHttp(400, 'Es el único producto del pedido: usá "Eliminar pedido"');
      await run('DELETE FROM pedido_items WHERE id = ?', [item.id]);
    } else {
      await run('UPDATE pedido_items SET cantidad = ?, subtotal = ? WHERE id = ?', [quedan, redondear(item.subtotal * quedan / actual), item.id]);
    }
    const { total } = await recalcularTotales(pedidoId);
    const { pagado } = await saldoPedido(pedidoId);
    if (total < pagado - 0.009) throw errorHttp(400, 'Quitarlo deja el total por debajo de lo ya cobrado');
    await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)', [usuarioId, 'quitar_item',
      `Pedido ${pedido.numero_pedido}: quitado ${quitar} x ${item.nombre_producto} (${redondear(item.subtotal * quitar / actual)}) por ${await nombreUsuario(usuarioId)}. Total nuevo ${total}`]);
    return { pedido, total, nombre: item.nombre_producto, quitar };
  });
  emitEvento('cocina:actualizar', { pedido_id: Number(pedidoId), accion: 'item_quitado' });
  emitEvento('dashboard:actualizar', { motivo: 'pedido_actualizado' });
  return { ok: true, total: r.total, quitado: `${r.quitar} x ${r.nombre}` };
}

module.exports = { corregirMedioDePago, eliminarPedido, quitarItem, MOTIVOS_ELIMINAR };
