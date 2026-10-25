'use strict';
// Cierre del día: todo lo que pasó en el día en un solo resumen (ventas, caja, gastos, propinas, personal,
// stock y pendientes), guardado en cierres_dia. Se hace solo a la hora configurada (por defecto 22:00) los
// días que abre el local, o a mano con "Cerrar el día".
// El efectivo lo cuenta una persona: si a esa hora la caja sigue abierta, se cierra "pendiente de arqueo"
// (sin inventar lo contado) y el encargado carga después lo que había. Así un faltante nunca queda tapado.
const { run, get, all, transaccion } = require('../db');
const { emitEvento } = require('../realtime');
const { errorHttp } = require('../util');
const { LOCAL, ZONA_HORARIA, fechaLocal } = require('../tiempo');
const { redondear, resumenCaja, cerrarCajaTx } = require('./caja');
const { propinasDelPeriodo, repartirCentavos, horasPorPersona } = require('./personal');
const { listarBackups } = require('./backups');

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const AVISO_MINUTOS = 15; // antes de la hora del cierre se avisa en el sistema: "contá el efectivo"

const ids = texto => String(texto || '').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0);
// Días que abre: 0 = domingo ... 6 = sábado
const dias = texto => [...new Set(String(texto ?? '').split(',').filter(x => /^[0-6]$/.test(x)).map(Number))];

async function configCierre() {
  const c = await get('SELECT cierre_auto_activo, cierre_hora, cierre_dias, cierre_propinas_usuarios FROM configuracion WHERE id = 1') || {};
  return {
    activo: !!c.cierre_auto_activo,
    hora: HORA.test(c.cierre_hora || '') ? c.cierre_hora : '22:00',
    dias: c.cierre_dias === null || c.cierre_dias === undefined ? [0, 1, 2, 3, 4, 5, 6] : dias(c.cierre_dias),
    propinas_usuarios: ids(c.cierre_propinas_usuarios)
  };
}

// Valida lo que llega por PUT /api/config (configuracion.js)
function validarConfigCierre(b) {
  if (b.cierre_hora !== undefined && !HORA.test(String(b.cierre_hora))) throw errorHttp(400, 'Hora de cierre inválida (HH:MM)');
  if (b.cierre_dias !== undefined) {
    const lista = Array.isArray(b.cierre_dias) ? b.cierre_dias.map(String) : String(b.cierre_dias).split(',');
    if (lista.some(x => !/^[0-6]$/.test(x))) throw errorHttp(400, 'Días de cierre inválidos');
    b.cierre_dias = [...new Set(lista)].sort().join(',');
  }
  if (b.cierre_propinas_usuarios !== undefined) {
    const lista = Array.isArray(b.cierre_propinas_usuarios) ? b.cierre_propinas_usuarios : String(b.cierre_propinas_usuarios).split(',');
    b.cierre_propinas_usuarios = ids(lista.join(',')).join(',');
  }
  if (b.cierre_auto_activo !== undefined) b.cierre_auto_activo = b.cierre_auto_activo ? 1 : 0;
}

// Fecha local AAAA-MM-DD, día de la semana y HH:MM del negocio para un instante
function ahoraLocal(instante = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: ZONA_HORARIA, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short'
  }).formatToParts(instante).map(x => [x.type, x.value]));
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}`,
    dia: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}
const minutos = hhmm => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const restarDias = (fecha, n) => new Date(Date.parse(fecha + 'T12:00:00Z') - n * 86400000).toISOString().slice(0, 10);

// ---- Resumen del día ----

async function ventasDelDia(fecha) {
  const L = LOCAL();
  const porMetodo = await all(`SELECT metodo, ROUND(SUM(monto), 2) AS total, COUNT(*) AS cobros FROM pagos
    WHERE date(fecha, ${L}) = ? GROUP BY metodo ORDER BY total DESC`, [fecha]);
  const pedidos = await get(`SELECT COUNT(*) AS tickets, COALESCE(SUM(total), 0) AS total, COALESCE(SUM(descuento), 0) AS descuentos,
      SUM(CASE WHEN descuento > 0 THEN 1 ELSE 0 END) AS con_descuento
    FROM pedidos WHERE estado = 'pagado' AND date(cerrado_en, ${L}) = ?`, [fecha]);
  const porTipo = await all(`SELECT tipo, COUNT(*) AS tickets, ROUND(SUM(total), 2) AS total FROM pedidos
    WHERE estado = 'pagado' AND date(cerrado_en, ${L}) = ? GROUP BY tipo ORDER BY total DESC`, [fecha]);
  const porMozo = await all(`SELECT COALESCE(u.nombre, 'Online / QR') AS nombre, COUNT(*) AS tickets, ROUND(SUM(p.total), 2) AS total
    FROM pedidos p LEFT JOIN usuarios u ON u.id = p.usuario_id
    WHERE p.estado = 'pagado' AND date(p.cerrado_en, ${L}) = ? GROUP BY p.usuario_id ORDER BY total DESC`, [fecha]);
  const cancelados = await get(`SELECT COUNT(*) AS cantidad, COALESCE(SUM(total), 0) AS total FROM pedidos
    WHERE estado = 'cancelado' AND date(cerrado_en, ${L}) = ?`, [fecha]);
  const masVendidos = await all(`SELECT i.nombre_producto AS nombre, SUM(i.cantidad) AS cantidad, ROUND(SUM(i.subtotal), 2) AS total
    FROM pedido_items i JOIN pedidos p ON p.id = i.pedido_id
    WHERE p.estado = 'pagado' AND date(p.cerrado_en, ${L}) = ?
    GROUP BY i.nombre_producto ORDER BY cantidad DESC, total DESC LIMIT 5`, [fecha]);
  const total = redondear(porMetodo.reduce((s, m) => s + m.total, 0));
  return {
    total, tickets: pedidos.tickets,
    ticket_promedio: pedidos.tickets ? redondear(pedidos.total / pedidos.tickets) : 0,
    por_metodo: porMetodo, por_tipo: porTipo, por_mozo: porMozo,
    descuentos: { total: redondear(pedidos.descuentos), pedidos: pedidos.con_descuento || 0 },
    cancelados: { cantidad: cancelados.cantidad, total: redondear(cancelados.total) },
    mas_vendidos: masVendidos
  };
}

// Las cajas del día (abiertas ese día) con su arqueo: esperado, contado o "falta contar"
async function cajasDelDia(fecha) {
  const cajas = await all(`SELECT c.*, u.nombre AS usuario_nombre FROM caja c LEFT JOIN usuarios u ON u.id = c.usuario_id
    WHERE date(c.fecha_apertura, ${LOCAL()}) = ? OR c.estado = 'abierta' ORDER BY c.fecha_apertura`, [fecha]);
  return Promise.all(cajas.map(async c => {
    let r = null;
    try { r = c.resumen ? JSON.parse(c.resumen) : null; } catch (e) {}
    if (!r) r = await resumenCaja(c);
    return {
      id: c.id, estado: c.estado, usuario: c.usuario_nombre, apertura: c.fecha_apertura, cierre: c.fecha_cierre,
      monto_inicial: r.monto_inicial, ingresos: r.ingresos, egresos: r.egresos, efectivo_esperado: r.efectivo_esperado,
      contado: c.estado === 'cerrada' && !c.pendiente_arqueo ? c.monto_final_real : null,
      diferencia: c.estado === 'cerrada' && !c.pendiente_arqueo ? c.diferencia : null,
      pendiente_arqueo: !!c.pendiente_arqueo, observaciones: c.observaciones_cierre || ''
    };
  }));
}

async function propinasDelDia(fecha, cfg) {
  const total = await propinasDelPeriodo(fecha, fecha);
  // Reparto sugerido en partes iguales: los elegidos en la configuración o, si no hay, los que ficharon ese día
  let personas = [];
  if (cfg.propinas_usuarios.length) {
    personas = await all(`SELECT id, nombre FROM usuarios WHERE id IN (${cfg.propinas_usuarios.map(() => '?').join(',')}) ORDER BY nombre`, cfg.propinas_usuarios);
  } else {
    personas = (await horasPorPersona(fecha, fecha)).map(h => ({ id: h.usuario_id, nombre: h.nombre }));
  }
  const montos = repartirCentavos(total, personas.map(() => 1));
  return { total, reparto: personas.map((p, i) => ({ usuario_id: p.id, nombre: p.nombre, monto: montos[i] })) };
}

async function resumenDelDia(fecha = fechaLocal()) {
  if (!FECHA.test(String(fecha))) throw errorHttp(400, 'Fecha inválida (AAAA-MM-DD)');
  const cfg = await configCierre();
  const L = LOCAL();
  const [ventas, semanaPasada, cajas, propinas, personal] = await Promise.all([
    ventasDelDia(fecha), ventasDelDia(restarDias(fecha, 7)), cajasDelDia(fecha), propinasDelDia(fecha, cfg), horasPorPersona(fecha, fecha)
  ]);
  const gastos = await all(`SELECT g.id, g.categoria, g.descripcion, g.total, g.estado, g.tipo_comprobante, g.numero_comprobante,
      pr.nombre AS proveedor FROM gastos g LEFT JOIN proveedores pr ON pr.id = g.proveedor_id
    WHERE g.fecha = ? AND g.anulado = 0 ORDER BY g.id`, [fecha]);
  const stockBajo = await all(`SELECT nombre, stock_actual, stock_minimo, unidad FROM productos
    WHERE activo = 1 AND tracking_stock = 1 AND stock_actual <= stock_minimo ORDER BY nombre LIMIT 30`);
  const abiertos = await all(`SELECT p.numero_pedido, p.tipo, m.nombre AS mesa, p.total FROM pedidos p LEFT JOIN mesas m ON m.id = p.mesa_id
    WHERE p.estado = 'abierto' ORDER BY p.creado_en`);
  const facturasEnEspera = (await get("SELECT COUNT(*) AS n FROM facturas_pendientes WHERE estado = 'pendiente'")).n;
  const sinSalida = await all(`SELECT u.nombre FROM fichajes f JOIN usuarios u ON u.id = f.usuario_id
    WHERE f.salida IS NULL AND date(f.entrada, ${L}) <= ?`, [fecha]);
  const copia = listarBackups().find(b => b.nombre.includes(fecha)) || null;
  return {
    fecha,
    ventas,
    comparacion: { fecha: restarDias(fecha, 7), total: semanaPasada.total, tickets: semanaPasada.tickets,
      variacion: semanaPasada.total > 0 ? Math.round((ventas.total - semanaPasada.total) / semanaPasada.total * 1000) / 10 : null },
    cajas,
    gastos: { items: gastos, total: redondear(gastos.reduce((s, g) => s + g.total, 0)) },
    propinas,
    personal: { horas: personal, sin_salida: sinSalida.map(x => x.nombre) },
    stock_bajo: stockBajo,
    pendientes: { pedidos_abiertos: abiertos, facturas_en_espera: facturasEnEspera,
      cajas_sin_contar: cajas.filter(c => c.pendiente_arqueo).map(c => c.id) },
    copia: copia && { nombre: copia.nombre, fecha: copia.fecha }
  };
}

// ---- Cierre ----

// Cierra el día: si la caja sigue abierta la cierra sin contar (pendiente de arqueo) y guarda el resumen.
// A mano se puede volver a cerrar (por ejemplo, si hubo ventas después): se actualiza el resumen del día.
async function cerrarDia({ fecha = fechaLocal(), automatico = false, usuarioId = null } = {}) {
  const r = await transaccion(async () => {
    if (automatico && await get('SELECT id FROM cierres_dia WHERE fecha = ?', [fecha])) return null;
    const caja = await get("SELECT * FROM caja WHERE estado = 'abierta'");
    if (caja) {
      await cerrarCajaTx(caja, { contado: null, usuarioId,
        observaciones: automatico ? 'Cierre automático del día: falta contar el efectivo' : 'Cierre del día: falta contar el efectivo' });
    }
    const resumen = await resumenDelDia(fecha);
    await run(`INSERT INTO cierres_dia (fecha, automatico, usuario_id, resumen) VALUES (?, ?, ?, ?)
      ON CONFLICT(fecha) DO UPDATE SET automatico = excluded.automatico, usuario_id = excluded.usuario_id,
        resumen = excluded.resumen, actualizado_en = CURRENT_TIMESTAMP`,
      [fecha, automatico ? 1 : 0, usuarioId, JSON.stringify(resumen)]);
    await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)', [usuarioId, 'cierre_dia',
      `Cierre ${automatico ? 'automático ' : ''}del día ${fecha}: ventas ${resumen.ventas.total} en ${resumen.ventas.tickets} tickets` +
      (caja ? `; caja #${caja.id} cerrada sin contar` : '')]);
    return { fecha, resumen, caja_cerrada: caja ? caja.id : null };
  });
  if (r) {
    emitEvento('cierre:hecho', { fecha: r.fecha, automatico, caja_cerrada: r.caja_cerrada });
    if (r.caja_cerrada) emitEvento('caja:actualizar', { caja_id: r.caja_cerrada });
  }
  return r;
}

// El encargado carga lo que contó de una caja que cerró sola; el resumen del día se actualiza
async function completarArqueo(cajaId, { contado, observaciones = '', usuarioId }) {
  const r = await transaccion(async () => {
    const caja = await get('SELECT * FROM caja WHERE id = ?', [cajaId]);
    if (!caja) throw errorHttp(404, 'Caja no encontrada');
    if (!caja.pendiente_arqueo) throw errorHttp(400, 'Esa caja ya tiene el arqueo hecho');
    const diferencia = redondear(contado - caja.monto_esperado);
    const obs = [caja.observaciones_cierre, String(observaciones || '').trim()].filter(Boolean).join(' — ');
    await run(`UPDATE caja SET monto_final_real = ?, diferencia = ?, pendiente_arqueo = 0, arqueo_por = ?, arqueo_en = CURRENT_TIMESTAMP,
      observaciones_cierre = ? WHERE id = ?`, [redondear(contado), diferencia, usuarioId, obs, caja.id]);
    await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)', [usuarioId, 'arqueo_pendiente',
      `Caja #${caja.id}: arqueo cargado después del cierre. Esperado ${caja.monto_esperado}, contado ${redondear(contado)}, diferencia ${diferencia}`]);
    const { fecha } = await get(`SELECT date(?, ${LOCAL()}) AS fecha`, [caja.fecha_apertura]);
    if (await get('SELECT id FROM cierres_dia WHERE fecha = ?', [fecha]))
      await run('UPDATE cierres_dia SET resumen = ?, actualizado_en = CURRENT_TIMESTAMP WHERE fecha = ?', [JSON.stringify(await resumenDelDia(fecha)), fecha]);
    return { caja_id: caja.id, efectivo_esperado: caja.monto_esperado, efectivo_contado: redondear(contado), diferencia };
  });
  emitEvento('caja:actualizar', { caja_id: cajaId });
  return r;
}

const listarCierres = async () => (await all(`SELECT c.fecha, c.automatico, c.creado_en, c.actualizado_en, c.resumen, u.nombre AS usuario_nombre
    FROM cierres_dia c LEFT JOIN usuarios u ON u.id = c.usuario_id ORDER BY c.fecha DESC LIMIT 90`)).map(c => {
  let r = {};
  try { r = JSON.parse(c.resumen || '{}'); } catch (e) {}
  return { fecha: c.fecha, automatico: !!c.automatico, creado_en: c.creado_en, actualizado_en: c.actualizado_en, usuario_nombre: c.usuario_nombre,
    ventas: r.ventas ? r.ventas.total : 0, tickets: r.ventas ? r.ventas.tickets : 0,
    falta_contar: !!(r.pendientes && r.pendientes.cajas_sin_contar && r.pendientes.cajas_sin_contar.length) };
});

async function cierreGuardado(fecha) {
  if (!FECHA.test(String(fecha))) throw errorHttp(400, 'Fecha inválida (AAAA-MM-DD)');
  const c = await get('SELECT c.*, u.nombre AS usuario_nombre FROM cierres_dia c LEFT JOIN usuarios u ON u.id = c.usuario_id WHERE c.fecha = ?', [fecha]);
  if (!c) throw errorHttp(404, 'Ese día no tiene cierre');
  return { fecha: c.fecha, automatico: !!c.automatico, creado_en: c.creado_en, actualizado_en: c.actualizado_en,
    usuario_nombre: c.usuario_nombre, resumen: JSON.parse(c.resumen) };
}

// ---- Cierre automático ----
// Se revisa cada 30 s: a falta de AVISO_MINUTOS se avisa en el sistema; a la hora, se cierra el día (una vez).
// Si la PC estaba apagada a esa hora, cierra apenas arranca (si todavía es el mismo día).
const avisados = new Set();
async function revisarCierre(instante = new Date()) {
  const cfg = await configCierre();
  if (!cfg.activo) return null;
  const ahora = ahoraLocal(instante);
  if (!cfg.dias.includes(ahora.dia)) return null;
  const faltan = minutos(cfg.hora) - minutos(ahora.hora);
  if (faltan > 0 && faltan <= AVISO_MINUTOS && !avisados.has(ahora.fecha)) {
    avisados.add(ahora.fecha);
    const caja = await get("SELECT id FROM caja WHERE estado = 'abierta'");
    emitEvento('cierre:aviso', { hora: cfg.hora, minutos: faltan, caja_abierta: !!caja });
    return 'aviso';
  }
  if (faltan <= 0) return (await cerrarDia({ fecha: ahora.fecha, automatico: true })) ? 'cerrado' : null;
  return null;
}

function iniciarCierreAutomatico(ms = 30000) {
  const vuelta = () => revisarCierre().catch(e => console.error('[cierre del día]', e.message));
  vuelta();
  setInterval(vuelta, ms).unref();
}

module.exports = {
  configCierre, validarConfigCierre, resumenDelDia, cerrarDia, completarArqueo, listarCierres, cierreGuardado,
  revisarCierre, iniciarCierreAutomatico, ahoraLocal
};
