'use strict';
// Pagos que se repiten (ej.: el ayudante que viene los sábados). La administradora elige los días de la semana y el
// monto; cada uno de esos días queda cargado como gasto pendiente (las próximas SEMANAS semanas), para pagarlo desde
// Contabilidad → Gastos como cualquier otro. Si cambian los días o el monto, se acomodan los que vienen (desde mañana,
// pendientes): los pagados, los anulados y los de hoy o antes no se tocan. Un día anulado a mano no se vuelve a cargar.
const { run, get, all, transaccion } = require('../db');
const { errorHttp } = require('../util');
const { fechaLocal } = require('../tiempo');

const SEMANAS = 4;
const NOMBRES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const CATEGORIAS = ['sueldos', 'alquiler', 'servicios', 'impuestos', 'mantenimiento', 'marketing', 'otros', 'mercaderia', 'comisiones'];
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

const diasDe = texto => [...new Set(String(texto || '').split(',').filter(x => /^[0-6]$/.test(x)).map(Number))].sort();
const diaSemana = fecha => new Date(fecha + 'T12:00:00Z').getUTCDay();
const sumarDias = (fecha, n) => new Date(Date.parse(fecha + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

function validar(b) {
  const descripcion = String((b && b.descripcion) || '').trim().slice(0, 120);
  if (!descripcion) throw errorHttp(400, 'Escribí qué se paga (ej.: Ayudante)');
  const monto = r2(b.monto);
  if (!(monto > 0) || monto > 100000000) throw errorHttp(400, 'Escribí cuánto se paga cada día');
  const categoria = CATEGORIAS.includes(b.categoria) ? b.categoria : 'sueldos';
  const dias = diasDe(Array.isArray(b.dias) ? b.dias.join(',') : b.dias);
  return { descripcion, monto, categoria, dias: dias.join(','), activo: b.activo === false || b.activo === 0 ? 0 : 1 };
}

// Cada pago con los próximos días cargados
async function listarConProximos() {
  const hoy = fechaLocal();
  const lista = [];
  for (const r of await all('SELECT * FROM gastos_recurrentes ORDER BY activo DESC, descripcion')) {
    lista.push({ ...r, dias: diasDe(r.dias), activo: !!r.activo,
      proximos: await all(`SELECT id, fecha, total, estado FROM gastos WHERE recurrente_id = ? AND anulado = 0 AND fecha >= ?
        ORDER BY fecha LIMIT 8`, [r.id, hoy]) });
  }
  return lista;
}

// Carga los días que faltan (de hoy a SEMANAS semanas) de los pagos activos. Devuelve cuántos cargó.
async function generarTx(hoy = fechaLocal()) {
  let cargados = 0;
  for (const r of await all('SELECT * FROM gastos_recurrentes WHERE activo = 1')) {
    const dias = diasDe(r.dias);
    if (!dias.length) continue;
    for (let i = 0; i < SEMANAS * 7; i++) {
      const fecha = sumarDias(hoy, i);
      const dia = diaSemana(fecha);
      if (!dias.includes(dia)) continue;
      // Ya cargado (también si se anuló a mano: no se vuelve a cargar)
      if (await get('SELECT 1 AS x FROM gastos WHERE recurrente_id = ? AND fecha = ?', [r.id, fecha])) continue;
      await run(`INSERT INTO gastos (fecha, categoria, descripcion, tipo_comprobante, neto, iva, otros_impuestos, total, vencimiento, recurrente_id)
        VALUES (?, ?, ?, 'sin_comprobante', ?, 0, 0, ?, ?, ?)`, [fecha, r.categoria, `${r.descripcion} ${NOMBRES[dia]}`, r.monto, r.monto, fecha, r.id]);
      cargados++;
    }
  }
  return cargados;
}

const generar = (hoy) => transaccion(() => generarTx(hoy));

// Crear o editar: los pendientes que vienen (desde mañana) de días que ya no van se anulan, los que siguen toman el
// monto nuevo, y se cargan los días nuevos
async function guardar(id, body, usuarioId) {
  const r = validar(body || {});
  return transaccion(async () => {
    const hoy = fechaLocal();
    let rid = id;
    let antes = [], antesActivo = 1;
    if (id) {
      const actual = await get('SELECT * FROM gastos_recurrentes WHERE id = ?', [id]);
      if (!actual) throw errorHttp(404, 'No existe ese pago');
      antes = diasDe(actual.dias);
      antesActivo = actual.activo;
      await run('UPDATE gastos_recurrentes SET descripcion = ?, categoria = ?, monto = ?, dias = ?, activo = ? WHERE id = ?',
        [r.descripcion, r.categoria, r.monto, r.dias, r.activo, id]);
    } else {
      rid = (await run('INSERT INTO gastos_recurrentes (descripcion, categoria, monto, dias, activo) VALUES (?, ?, ?, ?, ?)',
        [r.descripcion, r.categoria, r.monto, r.dias, r.activo])).id;
    }
    const dias = diasDe(r.dias);
    let anulados = 0, actualizados = 0;
    for (const g of await all(`SELECT id, fecha FROM gastos WHERE recurrente_id = ? AND anulado = 0 AND estado = 'pendiente' AND fecha > ?`, [rid, hoy])) {
      const dia = diaSemana(g.fecha);
      if (!antes.includes(dia)) continue; // un día extra (cargado a mano) queda como está
      if (!r.activo || !dias.includes(dia)) {
        await run('UPDATE gastos SET anulado = 1 WHERE id = ?', [g.id]);
        anulados++;
      } else {
        await run('UPDATE gastos SET total = ?, neto = ?, descripcion = ?, categoria = ? WHERE id = ?',
          [r.monto, r.monto, `${r.descripcion} ${NOMBRES[dia]}`, r.categoria, g.id]);
        actualizados++;
      }
    }
    // Un día que se había sacado y vuelve: el pendiente anulado por el cambio de días se recupera (solo de los días que
    // se agregan ahora: un sábado anulado a mano porque no vino sigue anulado)
    for (const g of await all(`SELECT id, fecha FROM gastos WHERE recurrente_id = ? AND anulado = 1 AND estado = 'pendiente' AND fecha > ?
      AND caja_movimiento_id IS NULL`, [rid, hoy])) {
      if (r.activo && dias.includes(diaSemana(g.fecha)) && (!antes.includes(diaSemana(g.fecha)) || !antesActivo)) {
        await run('UPDATE gastos SET anulado = 0, total = ?, neto = ?, descripcion = ?, categoria = ? WHERE id = ?',
          [r.monto, r.monto, `${r.descripcion} ${NOMBRES[diaSemana(g.fecha)]}`, r.categoria, g.id]);
        actualizados++;
      }
    }
    const cargados = await generarTx(hoy);
    await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)', [usuarioId, 'gasto_recurrente',
      `${r.descripcion}: ${r.monto} los ${dias.map(d => NOMBRES[d]).join(', ') || '(ningún día)'}${r.activo ? '' : ' (pausado)'}. ` +
      `Próximos: ${cargados} cargados, ${actualizados} actualizados, ${anulados} anulados`]);
    return { id: rid, cargados, actualizados, anulados };
  });
}

// Cada hora (y al arrancar) se cargan los días que van entrando en las próximas semanas
function iniciarGastosRecurrentes(ms = 60 * 60 * 1000) {
  const vuelta = () => generar().catch(e => console.error('[gastos que se repiten]', e.message));
  setTimeout(vuelta, 5000).unref();
  setInterval(vuelta, ms).unref();
}

// Día extra (no fijo): vino otro día y se le paga ese día. Monto por defecto el del pago; se puede cambiar.
// Suma en la cuenta de ese día (gasto con esa fecha). Si ese día ya estaba cargado, avisa; si estaba anulado, vuelve.
async function sumarDia(id, body, usuarioId) {
  const fecha = String((body && body.fecha) || fechaLocal());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(fecha))) throw errorHttp(400, 'Fecha inválida');
  return transaccion(async () => {
    const r = await get('SELECT * FROM gastos_recurrentes WHERE id = ?', [id]);
    if (!r) throw errorHttp(404, 'No existe ese pago');
    const monto = body && body.monto !== undefined && body.monto !== '' ? r2(body.monto) : r2(r.monto);
    if (!(monto > 0) || monto > 100000000) throw errorHttp(400, 'Monto inválido');
    const dia = diaSemana(fecha);
    const descripcion = `${r.descripcion} ${NOMBRES[dia]}${diasDe(r.dias).includes(dia) ? '' : ' (día extra)'}`;
    const ya = await get('SELECT * FROM gastos WHERE recurrente_id = ? AND fecha = ?', [id, fecha]);
    let gastoId;
    if (ya && !ya.anulado) throw errorHttp(409, `Ese día ya está cargado (${ya.descripcion}, $${ya.total}). Si cambió el monto, editalo en Gastos.`);
    if (ya) {
      await run('UPDATE gastos SET anulado = 0, total = ?, neto = ?, descripcion = ?, categoria = ?, vencimiento = ? WHERE id = ?',
        [monto, monto, descripcion, r.categoria, fecha, ya.id]);
      gastoId = ya.id;
    } else {
      gastoId = (await run(`INSERT INTO gastos (fecha, categoria, descripcion, tipo_comprobante, neto, iva, otros_impuestos, total, vencimiento, recurrente_id, usuario_id)
        VALUES (?, ?, ?, 'sin_comprobante', ?, 0, 0, ?, ?, ?, ?)`, [fecha, r.categoria, descripcion, monto, monto, fecha, id, usuarioId])).id;
    }
    await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)', [usuarioId, 'crear_gasto',
      `Gasto #${gastoId}: ${descripcion} ${fecha} ${monto}`]);
    return { id: gastoId, fecha, monto, descripcion };
  });
}

module.exports = { listarConProximos, guardar, sumarDia, generar, iniciarGastosRecurrentes, NOMBRES };
