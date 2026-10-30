'use strict';
// Transferencias que entran a la cuenta de Mercado Pago del local (al alias o CVU, desde otra billetera o un banco).
// Mercado Pago no avisa a qué pedido corresponden: llegan "sueltas", sin número de pedido ni nombre de quien paga.
// Lo que sí se sabe es el monto exacto y la hora. Con eso:
// - Conciliación automática: mientras haya pedidos esperando una transferencia (el cliente de la barra tocó
//   "Ya transferí" o una mesa pidió la cuenta "Paga por transferencia"), cada 30 s se miran las transferencias
//   recibidas en la cuenta. Si entró una por el saldo exacto de UN solo pedido esperando, y no hay otra igual
//   que se pueda confundir, el pedido se cobra solo (referencia MP-<id>, la misma que usan los pagos con el botón).
//   Ante cualquier duda (dos pedidos por el mismo monto, dos transferencias iguales) no se cobra nada: queda
//   para el "Transferencia recibida" de siempre.
// - Reporte: las transferencias de un período, marcando cuáles quedaron registradas en un pedido y cuáles no
//   (para controlar contra la caja las que se cobraron a mano o nunca se cargaron).
const { all } = require('../db');
const { emitEvento, alEvento } = require('../realtime');
const { getIntCfg, mpRequest } = require('./integraciones');
const { centavos, saldoPedido } = require('./pedidos');

const INTERVALO_MS = Number(process.env.GM_TRANSFERENCIAS_INTERVALO_MS) || 30 * 1000;
// Una transferencia vieja no se asocia a un pedido de ahora
const HORAS_ATRAS = 6;
// Tolerancia por relojes: la transferencia puede figurar unos segundos antes de que se cree el pedido
const TOLERANCIA_MS = 2 * 60 * 1000;
// Entran a la cuenta: transferencias desde otra billetera (money_transfer) o desde un banco al CVU (account_fund)
const OPERACIONES = ['money_transfer', 'account_fund'];
const MAX_RESULTADOS = 1000;
const NOTA_MESA = 'Paga por transferencia';

const mpListo = cfg => !!(cfg && cfg.activa && cfg.access_token);
const fechaSql = s => Date.parse(String(s).replace(' ', 'T') + 'Z');
const sqlFecha = ms => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

// Id de la cuenta de Mercado Pago del local (para quedarse con lo que ENTRA, no con lo que el local pagó)
const cuentas = new Map();
async function idCuenta(cfg) {
  const clave = cfg.modo === 'produccion' ? cfg.access_token : (cfg.access_token_test || cfg.access_token);
  if (!cuentas.has(clave)) cuentas.set(clave, String((await mpRequest(cfg, 'GET', '/users/me')).id));
  return cuentas.get(clave);
}

// Transferencias aprobadas que entraron a la cuenta entre dos momentos (Date), de la más nueva a la más vieja
async function transferenciasRecibidas(cfg, desde, hasta = new Date()) {
  const yo = await idCuenta(cfg);
  const lista = [];
  for (let offset = 0; offset < MAX_RESULTADOS; offset += 100) {
    const q = new URLSearchParams({
      sort: 'date_created', criteria: 'desc', range: 'date_created',
      begin_date: desde.toISOString(), end_date: hasta.toISOString(), limit: '100', offset: String(offset)
    });
    const r = await mpRequest(cfg, 'GET', `/v1/payments/search?${q}`);
    const resultados = r.results || [];
    for (const p of resultados) {
      if (p.status !== 'approved' || !OPERACIONES.includes(p.operation_type)) continue;
      if (String(p.collector_id) !== yo || (p.payer && String(p.payer.id) === yo)) continue;
      lista.push({
        id: String(p.id), monto: centavos(Number(p.transaction_amount) || 0),
        fecha: p.date_approved || p.date_created, medio: p.payment_method_id || ''
      });
    }
    if (resultados.length < 100) break;
  }
  return lista;
}

// Referencias MP-<id> ya usadas en un cobro (una transferencia no se usa dos veces)
async function referenciasUsadas(ids) {
  if (!ids.length) return new Map();
  const filas = await all(`SELECT pg.referencia, p.id AS pedido_id, p.numero_pedido FROM pagos pg JOIN pedidos p ON p.id = pg.pedido_id
    WHERE pg.referencia IN (${ids.map(() => '?').join(',')})`, ids.map(id => `MP-${id}`));
  return new Map(filas.map(f => [f.referencia.slice(3), { pedido_id: f.pedido_id, numero_pedido: f.numero_pedido }]));
}

// Pedidos abiertos cuyo cliente avisó que paga (o pagó) por transferencia, con lo que falta pagar
async function pedidosEsperando() {
  const barra = await all("SELECT id, numero_pedido, creado_en, NULL AS solicitud_id FROM pedidos WHERE estado = 'abierto' AND aviso_pago = 'transferencia'");
  const mesas = await all(`SELECT p.id, p.numero_pedido, p.creado_en, s.id AS solicitud_id FROM solicitudes_mesa s
    JOIN pedidos p ON p.mesa_id = s.mesa_id AND p.estado = 'abierto'
    WHERE s.tipo = 'cuenta' AND s.estado = 'pendiente' AND s.notas = ?`, [NOTA_MESA]);
  const lista = [];
  for (const p of [...barra, ...mesas]) {
    if (lista.some(x => x.id === p.id)) continue;
    const { saldo } = await saldoPedido(p.id);
    if (saldo > 0) lista.push({ ...p, saldo: centavos(saldo) });
  }
  return lista;
}

// Qué transferencia va con qué pedido: solo parejas sin ambigüedad (mismo monto exacto, uno a uno)
function emparejar(pedidos, transferencias) {
  const parejas = [];
  for (const p of pedidos) {
    const mismoMonto = pedidos.filter(x => x.saldo === p.saldo);
    const candidatas = transferencias.filter(t => t.monto === p.saldo && Date.parse(t.fecha) >= fechaSql(p.creado_en) - TOLERANCIA_MS);
    if (mismoMonto.length === 1 && candidatas.length === 1) parejas.push({ pedido: p, transferencia: candidatas[0] });
  }
  return parejas;
}

let enCurso = false;
async function conciliar() {
  if (enCurso) return { cobrados: [] };
  enCurso = true;
  try {
    const cfg = await getIntCfg('mercadopago');
    if (!mpListo(cfg)) return { cobrados: [] };
    const pedidos = await pedidosEsperando();
    if (!pedidos.length) return { cobrados: [] };
    const recibidas = await transferenciasRecibidas(cfg, new Date(Date.now() - HORAS_ATRAS * 3600e3));
    const usadas = await referenciasUsadas(recibidas.map(t => t.id));
    const libres = recibidas.filter(t => !usadas.has(t.id));
    const cobrados = [];
    // require diferido: barra.js y mesa-qr.js cargan medio sistema
    const { cobrarTransferencia } = require('./barra');
    const { atenderSolicitud } = require('./mesa-qr');
    for (const { pedido, transferencia } of emparejar(pedidos, libres)) {
      try {
        const r = await cobrarTransferencia(pedido.id, null, { referencia: `MP-${transferencia.id}` });
        if (pedido.solicitud_id) await atenderSolicitud(pedido.solicitud_id, null).catch(() => null);
        cobrados.push({ pedido_id: pedido.id, numero_pedido: pedido.numero_pedido, monto: r.monto, transferencia: transferencia.id });
        emitEvento('retiro:actualizar', { pedido_id: pedido.id, transferencia_detectada: { numero_pedido: pedido.numero_pedido, monto: r.monto } });
        emitEvento('mesas:actualizar', { pedido_id: pedido.id });
      } catch (err) {
        // Otro lo cobró en el medio (la caja tocó "Transferencia recibida"): no es un error
        if (err.status !== 400) console.error('[transferencias] No se pudo cobrar', pedido.numero_pedido, err.message);
      }
    }
    return { cobrados };
  } catch (err) {
    console.error('[transferencias] No se pudo consultar Mercado Pago:', err.message);
    return { cobrados: [], error: err.message };
  } finally {
    enCurso = false;
  }
}

// Cobros "Transferencia" cargados a mano (sin número de operación): se asocian a la transferencia del mismo monto
// más cercana en el tiempo, que haya entrado después de hacer el pedido y antes del cobro (con tolerancia por relojes)
async function asociarCobrosAMano(sueltas, inicio, fin) {
  if (!sueltas.length) return new Map();
  const cobros = await all(`SELECT pg.monto, pg.fecha, p.id AS pedido_id, p.creado_en, p.numero_pedido FROM pagos pg JOIN pedidos p ON p.id = pg.pedido_id
    WHERE pg.metodo = 'transferencia' AND COALESCE(pg.referencia, '') = '' AND p.estado = 'pagado' AND pg.fecha BETWEEN ? AND ?`,
  [sqlFecha(inicio.getTime() - TOLERANCIA_MS), sqlFecha(fin.getTime() + HORAS_ATRAS * 3600e3)]);
  const posibles = [];
  for (const c of cobros) {
    const cobrado = fechaSql(c.fecha);
    for (const t of sueltas) {
      const dif = cobrado - Date.parse(t.fecha);
      const despuesDelPedido = Date.parse(t.fecha) >= fechaSql(c.creado_en) - TOLERANCIA_MS;
      if (centavos(c.monto) === t.monto && despuesDelPedido && dif >= -TOLERANCIA_MS && dif <= HORAS_ATRAS * 3600e3) posibles.push({ c, t, dif: Math.abs(dif) });
    }
  }
  // Las parejas más cercanas primero; cada cobro y cada transferencia se usan una sola vez
  posibles.sort((a, b) => a.dif - b.dif);
  const asociadas = new Map();
  const cobrosUsados = new Set();
  for (const { c, t } of posibles) {
    if (asociadas.has(t.id) || cobrosUsados.has(c)) continue;
    cobrosUsados.add(c);
    asociadas.set(t.id, { pedido_id: c.pedido_id, numero_pedido: c.numero_pedido, a_mano: true });
  }
  return asociadas;
}

// Para el reporte: transferencias de un período (fechas locales AAAA-MM-DD) con el pedido en que se registraron
async function transferenciasDelPeriodo(desde, hasta, offsetMin) {
  const cfg = await getIntCfg('mercadopago');
  if (!mpListo(cfg)) return { disponible: false, transferencias: [] };
  const inicio = new Date(Date.parse(`${desde}T00:00:00Z`) - offsetMin * 60000);
  const fin = new Date(Math.min(Date.now(), Date.parse(`${hasta}T23:59:59Z`) - offsetMin * 60000));
  const recibidas = await transferenciasRecibidas(cfg, inicio, fin);
  const usadas = await referenciasUsadas(recibidas.map(t => t.id));
  const aMano = await asociarCobrosAMano(recibidas.filter(t => !usadas.has(t.id)), inicio, fin);
  return {
    disponible: true,
    transferencias: recibidas.map(t => ({ ...t, pedido: usadas.get(t.id) || aMano.get(t.id) || null }))
  };
}

function iniciarConciliacionTransferencias() {
  setInterval(conciliar, INTERVALO_MS).unref();
  // Apenas el cliente avisa, se mira enseguida (la transferencia casi siempre ya entró)
  const pronto = () => setTimeout(conciliar, 3000).unref();
  alEvento('retiro:actualizar', d => d && d.aviso === 'transferencia' && pronto());
  alEvento('mesa:solicitud', d => d && d.tipo === 'cuenta' && pronto());
}

module.exports = { iniciarConciliacionTransferencias, conciliar, transferenciasDelPeriodo, emparejar, transferenciasRecibidas };
