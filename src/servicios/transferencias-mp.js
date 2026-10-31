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
// - Aviso en la caja: cada transferencia nueva que entra a la cuenta suena una vez ("Llegó una transferencia de...")
//   aunque nadie la esté esperando (el cajero cargó la venta y el cliente transfirió). Las que ya estaban al
//   arrancar el sistema no se anuncian.
// - Reporte: las transferencias y los cobros del Point de un período, marcando cuáles quedaron registrados en un pedido y cuáles no
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

// Pagos aprobados cobrados por la cuenta entre dos momentos (Date), del más nuevo al más viejo.
// Sin filtrar por collector.id, la búsqueda de Mercado Pago a veces trae los cobros del Point y a veces no
// (misma consulta, distinta respuesta); con el filtro los trae siempre.
async function cobrosAprobados(cfg, desde, hasta = new Date()) {
  const yo = await idCuenta(cfg);
  const lista = [];
  for (let offset = 0; offset < MAX_RESULTADOS; offset += 100) {
    const q = new URLSearchParams({
      'collector.id': yo, sort: 'date_approved', criteria: 'desc', range: 'date_approved',
      begin_date: desde.toISOString(), end_date: hasta.toISOString(), limit: '100', offset: String(offset)
    });
    const r = await mpRequest(cfg, 'GET', `/v1/payments/search?${q}`);
    const resultados = r.results || [];
    lista.push(...resultados.filter(p => p.status === 'approved' && String(p.collector_id) === yo));
    if (resultados.length < 100) break;
  }
  return { yo, pagos: lista };
}

// Transferencias que entraron a la cuenta. Las que llegan de un banco al CVU (account_fund) figuran con la
// propia cuenta como pagador, así que solo se descartan las money_transfer que el local se mandó a sí mismo.
function soloTransferencias({ yo, pagos }) {
  return pagos
    .filter(p => OPERACIONES.includes(p.operation_type))
    .filter(p => p.operation_type === 'account_fund' || !(p.payer && String(p.payer.id) === yo))
    .map(p => ({
      id: String(p.id), monto: centavos(Number(p.transaction_amount) || 0),
      fecha: p.date_approved || p.date_created, medio: p.payment_method_id || ''
    }));
}

// Cobros con tarjeta en el Point: bruto, comisión de Mercado Pago, retenciones y lo que queda en la cuenta
function soloPoint({ pagos }) {
  return pagos.filter(p => p.operation_type === 'pos_payment').map(p => {
    const monto = centavos(Number(p.transaction_amount) || 0);
    const comision = centavos((p.fee_details || []).reduce((s, f) => s + (Number(f.amount) || 0), 0));
    const neto = centavos(Number(p.transaction_details && p.transaction_details.net_received_amount) || 0);
    return {
      id: String(p.id), monto, fecha: p.date_approved || p.date_created,
      medio: p.payment_method_id || '', tipo: p.payment_type_id || '', cuotas: Number(p.installments) || 1,
      ultimos: (p.card && p.card.last_four_digits) || '',
      comision, retenciones: neto ? centavos(Math.max(0, monto - comision - neto)) : 0, neto,
      devuelto: centavos(Number(p.transaction_amount_refunded) || 0)
    };
  });
}

async function transferenciasRecibidas(cfg, desde, hasta = new Date()) {
  return soloTransferencias(await cobrosAprobados(cfg, desde, hasta));
}

// Referencias MP-<id> ya usadas en un cobro (una transferencia no se usa dos veces). en_fadido = lo cobrado en Fadido
// con esa operación (si Mercado Pago cobró más, la diferencia puede ser propina); varios = una operación pagó varios pedidos
async function referenciasUsadas(ids) {
  if (!ids.length) return new Map();
  const filas = await all(`SELECT pg.referencia, pg.id AS pago_id, pg.monto, p.id AS pedido_id, p.numero_pedido FROM pagos pg JOIN pedidos p ON p.id = pg.pedido_id
    WHERE pg.referencia IN (${ids.map(() => '?').join(',')}) ORDER BY pg.id`, ids.map(id => `MP-${id}`));
  const usadas = new Map();
  for (const f of filas) {
    const id = f.referencia.slice(3);
    const u = usadas.get(id);
    if (u) { u.en_fadido = centavos(u.en_fadido + f.monto); u.varios = u.varios || u.pedido_id !== f.pedido_id; continue; }
    usadas.set(id, { pedido_id: f.pedido_id, numero_pedido: f.numero_pedido, pago_id: f.pago_id, en_fadido: centavos(f.monto), varios: false });
  }
  return usadas;
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

// Transferencias ya anunciadas en la caja (id -> cuándo entró), para que cada una suene una sola vez
const VENTANA_AVISO_MS = 30 * 60 * 1000;
const avisadas = new Map();
const arranque = Date.now();

// Las que entraron después de arrancar, en la última media hora, y todavía no sonaron
function nuevasParaAvisar(transferencias, ahora = Date.now()) {
  for (const [id, ms] of avisadas) if (ms < ahora - VENTANA_AVISO_MS) avisadas.delete(id);
  const nuevas = transferencias.filter(t => {
    const ms = Date.parse(t.fecha);
    return !avisadas.has(t.id) && ms >= arranque && ms >= ahora - VENTANA_AVISO_MS;
  });
  for (const t of nuevas) avisadas.set(t.id, Date.parse(t.fecha));
  return nuevas;
}

let enCurso = false;
async function conciliar() {
  if (enCurso) return { cobrados: [] };
  enCurso = true;
  try {
    const cfg = await getIntCfg('mercadopago');
    if (!mpListo(cfg)) return { cobrados: [] };
    const pedidos = await pedidosEsperando();
    // Sin pedidos esperando alcanza con la última media hora (solo para avisar las nuevas)
    const recibidas = await transferenciasRecibidas(cfg, new Date(Date.now() - (pedidos.length ? HORAS_ATRAS * 3600e3 : VENTANA_AVISO_MS)));
    const usadas = await referenciasUsadas(recibidas.map(t => t.id));
    const libres = recibidas.filter(t => !usadas.has(t.id));
    const nuevas = nuevasParaAvisar(libres);
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
    // Las que se cobraron solas ya sonaron con su pedido (retiro:actualizar); el resto suena como "llegó una transferencia"
    const avisos = nuevas.filter(t => !cobrados.some(c => c.transferencia === t.id));
    for (const t of avisos) emitEvento('transferencia:recibida', { id: t.id, monto: t.monto, fecha: t.fecha });
    return { cobrados, avisos };
  } catch (err) {
    console.error('[transferencias] No se pudo consultar Mercado Pago:', err.message);
    return { cobrados: [], error: err.message };
  } finally {
    enCurso = false;
  }
}

// Cobros cargados a mano (sin número de operación) como "Transferencia" o "Tarjeta": se asocian al movimiento de
// Mercado Pago del mismo monto más cercano en el tiempo, que haya entrado después de hacer el pedido y antes del
// cobro (con tolerancia por relojes)
async function asociarCobrosAMano(sueltas, inicio, fin, metodo = 'transferencia') {
  if (!sueltas.length) return new Map();
  const cobros = await all(`SELECT pg.monto, pg.fecha, p.id AS pedido_id, p.creado_en, p.numero_pedido FROM pagos pg JOIN pedidos p ON p.id = pg.pedido_id
    WHERE pg.metodo = ? AND COALESCE(pg.referencia, '') = '' AND p.estado = 'pagado' AND pg.fecha BETWEEN ? AND ?`,
  [metodo, sqlFecha(inicio.getTime() - TOLERANCIA_MS), sqlFecha(fin.getTime() + HORAS_ATRAS * 3600e3)]);
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

// Cada movimiento con la venta en que quedó registrado: por número de operación (MP-<id>) o, si se cobró a mano,
// por monto y hora contra los cobros de ese medio
async function conSuVenta(movimientos, inicio, fin, metodo) {
  const usadas = await referenciasUsadas(movimientos.map(m => m.id));
  const aMano = await asociarCobrosAMano(movimientos.filter(m => !usadas.has(m.id)), inicio, fin, metodo);
  return movimientos.map(m => ({ ...m, pedido: usadas.get(m.id) || aMano.get(m.id) || null }));
}

// Para el reporte: transferencias y cobros del Point de un período (fechas locales AAAA-MM-DD) con la venta en que
// se registró cada uno
async function transferenciasDelPeriodo(desde, hasta, offsetMin) {
  const cfg = await getIntCfg('mercadopago');
  if (!mpListo(cfg)) return { disponible: false, transferencias: [], point: [] };
  const inicio = new Date(Date.parse(`${desde}T00:00:00Z`) - offsetMin * 60000);
  const fin = new Date(Math.min(Date.now(), Date.parse(`${hasta}T23:59:59Z`) - offsetMin * 60000));
  const cobros = await cobrosAprobados(cfg, inicio, fin);
  return {
    disponible: true,
    transferencias: await conSuVenta(soloTransferencias(cobros), inicio, fin, 'transferencia'),
    point: await conSuVenta(soloPoint(cobros), inicio, fin, 'tarjeta')
  };
}

function iniciarConciliacionTransferencias() {
  setInterval(conciliar, INTERVALO_MS).unref();
  // Apenas el cliente avisa, se mira enseguida (la transferencia casi siempre ya entró)
  const pronto = () => setTimeout(conciliar, 3000).unref();
  alEvento('retiro:actualizar', d => d && d.aviso === 'transferencia' && pronto());
  alEvento('mesa:solicitud', d => d && d.tipo === 'cuenta' && pronto());
}

module.exports = { iniciarConciliacionTransferencias, conciliar, transferenciasDelPeriodo, emparejar, transferenciasRecibidas, nuevasParaAvisar };
