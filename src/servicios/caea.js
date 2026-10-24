'use strict';
// CAEA (Código de Autorización Electrónico Anticipado): facturas de contingencia cuando ARCA no responde.
// RG ARCA 5782/2025 y 5785/2025 (vigentes desde el 1/8/2026): ante una falla al pedir el CAE, la primera alternativa
// es el CAEA, en un punto de venta habilitado solo para eso (Integraciones → AFIP → "Punto de venta CAEA").
// - Con conexión se pide el CAEA de la quincena actual y el de la siguiente (desde 5 días antes de que empiece) y
//   el último número de cada tipo en el punto de venta CAEA.
// - Sin conexión, facturacion.emitirConCAEA emite con ese CAEA (servicios/sin-conexion.js lo usa antes de dejar la
//   factura en espera).
// - Al volver internet se informan los comprobantes (FECAEARegInformativo); hay plazo hasta 8 días corridos después
//   del fin de la quincena. Una quincena terminada sin comprobantes se informa "sin movimiento".
// - El uso tiene que ser excepcional: si en el mes pasa del 5 % de lo facturado, se avisa.
const { run, get, all } = require('../db');
const { emitEvento } = require('../realtime');
const { fechaLocal } = require('../tiempo');
const { getIntCfg } = require('./integraciones');
const { crearAfip, quincena, modoDe, fechaDeArca, FACTURAS } = require('./facturacion');

const LIMITE_PORCENTAJE = 5;

// Inicio y fin (AAAA-MM-DD) de una quincena, y la siguiente
function limites({ periodo, orden }) {
  const a = Math.floor(periodo / 100), m = periodo % 100;
  const ultimoDia = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return orden === 1 ? { desde: `${a}-${mm}-01`, hasta: `${a}-${mm}-15` } : { desde: `${a}-${mm}-16`, hasta: `${a}-${mm}-${ultimoDia}` };
}
function siguiente({ periodo, orden }) {
  if (orden === 1) return { periodo, orden: 2 };
  const a = Math.floor(periodo / 100), m = periodo % 100;
  return m === 12 ? { periodo: (a + 1) * 100 + 1, orden: 1 } : { periodo: periodo + 1, orden: 1 };
}
const diasEntre = (desde, hasta) => Math.round((Date.parse(hasta + 'T12:00:00Z') - Date.parse(desde + 'T12:00:00Z')) / 86400000);

async function configCaea() {
  const cfg = await getIntCfg('afip');
  const pto = parseInt(cfg.pto_venta_caea, 10);
  return cfg.activa && cfg.cuit && cfg.access_token && pto ? { cfg, pto, modo: modoDe(cfg) } : null;
}

// Pide (o, si ya se había pedido, consulta) el CAEA de una quincena y lo guarda
async function obtenerCAEA(afip, modo, q) {
  if (await get('SELECT 1 AS x FROM caea WHERE modo = ? AND periodo = ? AND orden = ?', [modo, q.periodo, q.orden])) return false;
  let r;
  try {
    r = await afip.ElectronicBilling.createCAEA(q.periodo, q.orden);
  } catch (e) {
    // Ya otorgado antes (otra PC o un intento cuya respuesta no llegó): se consulta
    r = await afip.ElectronicBilling.getCAEA(q.periodo, q.orden);
  }
  if (!r || !r.CAEA) return false;
  await run(`INSERT OR IGNORE INTO caea (modo, periodo, orden, caea, vig_desde, vig_hasta, tope_informar) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [modo, q.periodo, q.orden, String(r.CAEA), fechaDeArca(r.FchVigDesde), fechaDeArca(r.FchVigHasta), fechaDeArca(r.FchTopeInf)]);
  console.log(`[CAEA] ${q.periodo}/${q.orden}: ${r.CAEA}`);
  return true;
}

// Con conexión: CAEA de esta quincena y de la siguiente, y el último número de cada factura en el punto de venta CAEA.
// No se pisa un número local más alto (facturas emitidas sin conexión todavía sin informar).
async function prepararCAEA(hoy = fechaLocal()) {
  const c = await configCaea();
  if (!c) return { configurado: false };
  const afip = crearAfip(c.cfg);
  const actual = quincena(hoy);
  const prox = siguiente(actual);
  await obtenerCAEA(afip, c.modo, actual);
  if (diasEntre(hoy, limites(prox).desde) <= 5) await obtenerCAEA(afip, c.modo, prox);
  for (const tipo of FACTURAS) {
    const ultimo = Number(await afip.ElectronicBilling.getLastVoucher(c.pto, tipo)) || 0;
    await run(`INSERT INTO caea_numeracion (modo, pto_venta, tipo, ultimo) VALUES (?, ?, ?, ?)
      ON CONFLICT (modo, pto_venta, tipo) DO UPDATE SET ultimo = MAX(ultimo, excluded.ultimo)`, [c.modo, c.pto, tipo, ultimo]);
  }
  return { configurado: true };
}

// Informa a ARCA los comprobantes emitidos con CAEA, en orden. Si se corta, sigue la próxima vez.
async function informarCAEA() {
  const c = await configCaea();
  if (!c) return { informados: 0, rechazados: 0 };
  const afip = crearAfip(c.cfg);
  const resultado = { informados: 0, rechazados: 0 };
  const pendientes = await all(`SELECT id, caea_datos, tipo_comprobante_nombre, punto_venta, numero_comprobante FROM comprobantes_afip
    WHERE autorizacion = 'CAEA' AND caea_informado = 0 AND modo = ? ORDER BY tipo_comprobante, numero_comprobante`, [c.modo]);
  for (const comp of pendientes) {
    const { PtoVta, CbteTipo, ...detalle } = JSON.parse(comp.caea_datos);
    let det;
    try {
      const r = await afip.ElectronicBilling.executeRequest('FECAEARegInformativo', {
        FeCAEARegInfReq: { FeCabReq: { CantReg: 1, PtoVta, CbteTipo }, FeDetReq: { FECAEADetRequest: [detalle] } }
      });
      det = [].concat((r && r.FeDetResp && r.FeDetResp.FECAEADetResponse) || [])[0] || {};
    } catch (e) {
      // Error de ARCA con código (rechazo del pedido entero): se marca. Sin código es la conexión: sigue la próxima vez
      if (!/^\d+$/.test(String(e.code || ''))) throw e;
      det = { Resultado: 'R', Observaciones: { Obs: { Code: e.code, Msg: e.message } } };
    }
    if (det.Resultado === 'A') {
      await run('UPDATE comprobantes_afip SET caea_informado = 1, caea_error = NULL WHERE id = ?', [comp.id]);
      resultado.informados++;
      continue;
    }
    const obs = [].concat((det.Observaciones && det.Observaciones.Obs) || []).map(o => `(${o.Code}) ${o.Msg}`).join('; ') || 'rechazado';
    await run('UPDATE comprobantes_afip SET caea_informado = -1, caea_error = ? WHERE id = ?', [obs.slice(0, 300), comp.id]);
    const dato = `${comp.tipo_comprobante_nombre} ${comp.punto_venta}-${comp.numero_comprobante}`;
    await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (NULL, ?, ?)', ['alerta_afip', `ARCA rechazó informar ${dato} (CAEA): ${obs}`]);
    emitEvento('afip:caea_rechazado', { comprobante: dato, error: obs });
    resultado.rechazados++;
  }
  return resultado;
}

// Quincenas terminadas sin ningún comprobante con su CAEA: se informan "sin movimiento" en el punto de venta CAEA
async function informarSinMovimiento(hoy = fechaLocal()) {
  const c = await configCaea();
  if (!c) return 0;
  const afip = crearAfip(c.cfg);
  let informadas = 0;
  for (const q of await all('SELECT * FROM caea WHERE modo = ? AND sin_movimiento = 0 AND vig_hasta < ?', [c.modo, hoy])) {
    const usado = await get('SELECT 1 AS x FROM comprobantes_afip WHERE autorizacion = ? AND cae = ? LIMIT 1', ['CAEA', q.caea]);
    if (!usado) {
      await afip.ElectronicBilling.executeRequest('FECAEASinMovimientoInformar', { PtoVta: c.pto, CAEA: q.caea });
      informadas++;
    }
    // 1: informada sin movimiento; 2: tuvo comprobantes (se informaron uno por uno)
    await run('UPDATE caea SET sin_movimiento = ? WHERE id = ?', [usado ? 2 : 1, q.id]);
  }
  return informadas;
}

// Todo junto, con conexión (al volver internet y cada 6 horas). Un error no frena lo demás.
async function mantenerCAEA() {
  const r = {};
  for (const [nombre, fn] of [['preparar', prepararCAEA], ['informar', informarCAEA], ['sin_movimiento', informarSinMovimiento]]) {
    try { r[nombre] = await fn(); } catch (e) { r[nombre] = { error: e.message }; console.error(`[CAEA] ${nombre}:`, e.message); }
  }
  return r;
}

// Para Integraciones → AFIP: CAEA vigente, lo que falta informar y cuánto se facturó con CAEA en el mes
async function estadoCAEA(hoy = fechaLocal()) {
  const c = await configCaea();
  if (!c) return { configurado: false };
  const q = quincena(hoy);
  const vigente = await get('SELECT caea, vig_desde, vig_hasta, tope_informar FROM caea WHERE modo = ? AND periodo = ? AND orden = ?', [c.modo, q.periodo, q.orden]);
  const n = await get(`SELECT SUM(caea_informado = 0) AS sin_informar, SUM(caea_informado = -1) AS rechazados
    FROM comprobantes_afip WHERE autorizacion = 'CAEA' AND modo = ?`, [c.modo]);
  const mes = await get(`SELECT COALESCE(SUM(total), 0) AS total, COALESCE(SUM(CASE WHEN autorizacion = 'CAEA' THEN total END), 0) AS con_caea
    FROM comprobantes_afip WHERE modo = ? AND tipo_comprobante IN (1, 6, 11) AND fecha_comprobante LIKE ?`, [c.modo, hoy.slice(0, 7) + '%']);
  const porcentaje = mes.total ? Math.round(mes.con_caea / mes.total * 1000) / 10 : 0;
  return {
    configurado: true, punto_venta: c.pto, vigente: vigente || null,
    sin_informar: Number(n.sin_informar) || 0, rechazados: Number(n.rechazados) || 0,
    porcentaje_mes: porcentaje, limite: LIMITE_PORCENTAJE, excedido: porcentaje > LIMITE_PORCENTAJE
  };
}

module.exports = { prepararCAEA, informarCAEA, informarSinMovimiento, mantenerCAEA, estadoCAEA, limites, siguiente };
