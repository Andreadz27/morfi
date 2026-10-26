'use strict';
// Caja: arqueo (lo que tiene que haber) y cierre. Lo usan las rutas de caja y el cierre del día (cierre-dia.js).
const { run, get, all } = require('../db');

const redondear = n => Math.round((Number(n) || 0) * 100) / 100;

// Arqueo: cobros del turno por medio de pago, ingresos/egresos de efectivo y
// efectivo esperado = inicial + ventas en efectivo + ingresos − egresos
async function resumenCaja(caja) {
  const hasta = caja.fecha_cierre || '9999-12-31';
  const porMetodo = await all(`
    SELECT metodo, COALESCE(SUM(monto), 0) AS total, COUNT(*) AS cantidad
    FROM pagos WHERE fecha >= ? AND fecha <= ?
    GROUP BY metodo ORDER BY total DESC`, [caja.fecha_apertura, hasta]);
  const movimientos = await all(`
    SELECT m.id, m.tipo, m.concepto, m.monto, m.fecha, u.nombre AS usuario_nombre
    FROM movimientos_caja m LEFT JOIN usuarios u ON u.id = m.usuario_id
    WHERE m.caja_id = ? ORDER BY m.fecha`, [caja.id]);
  const suma = tipo => redondear(movimientos.filter(m => m.tipo === tipo).reduce((s, m) => s + m.monto, 0));
  const ventasEfectivo = redondear((porMetodo.find(m => m.metodo === 'efectivo') || {}).total);
  const ingresos = suma('ingreso'), egresos = suma('egreso');
  return {
    monto_inicial: redondear(caja.monto_inicial),
    por_metodo: porMetodo.map(m => ({ ...m, total: redondear(m.total) })),
    total_ventas: redondear(porMetodo.reduce((s, m) => s + m.total, 0)),
    cobros: porMetodo.reduce((s, m) => s + m.cantidad, 0),
    ventas_efectivo: ventasEfectivo,
    ingresos, egresos, movimientos,
    efectivo_esperado: redondear(caja.monto_inicial + ventasEfectivo + ingresos - egresos)
  };
}

// Cierra la caja abierta (dentro de una transacción). contado = efectivo contado; null = nadie lo contó
// (cierre automático del día): queda "pendiente de arqueo" hasta que el encargado cargue lo contado.
async function cerrarCajaTx(caja, { contado, observaciones = '', usuarioId = null }) {
  const resumen = await resumenCaja(caja);
  const pendiente = contado === null || contado === undefined;
  const diferencia = pendiente ? null : redondear(contado - resumen.efectivo_esperado);
  await run(`UPDATE caja SET estado = 'cerrada', fecha_cierre = CURRENT_TIMESTAMP, monto_final_real = ?,
               monto_esperado = ?, diferencia = ?, resumen = ?, observaciones_cierre = ?, pendiente_arqueo = ? WHERE id = ?`,
    [pendiente ? null : redondear(contado), resumen.efectivo_esperado, diferencia, JSON.stringify(resumen),
     String(observaciones || ''), pendiente ? 1 : 0, caja.id]);
  await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)',
    [usuarioId, 'cerrar_caja', pendiente
      ? `Caja #${caja.id} cerrada sin contar (cierre del día). Esperado ${resumen.efectivo_esperado}: falta el arqueo`
      : `Caja #${caja.id} cerrada. Esperado ${resumen.efectivo_esperado}, contado ${redondear(contado)}, diferencia ${diferencia}`]);
  return { resumen, diferencia, pendiente };
}

const cajaAbierta = () => get("SELECT * FROM caja WHERE estado = 'abierta'");

module.exports = { redondear, resumenCaja, cerrarCajaTx, cajaAbierta };
