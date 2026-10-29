'use strict';
// Pedido desde la barra (QR del mostrador) y retiro por número, sin pasar por la caja:
// - El cliente escanea el QR de la barra, pide con su nombre y el pedido va directo a la cocina (comanda impresa).
//   Cada pedido es suyo (no se comparte como la cuenta de una mesa): recibe un código para seguirlo desde el celular.
// - Desde el celular paga con Mercado Pago (si está habilitado), avisa que transfirió al alias del local, o paga
//   en la caja al retirar. Pagado todo, el pedido se cierra solo.
// - Cuando la cocina lo marca listo, el celular avisa "retiralo" y aparece en la pantalla de retiro de la barra.
//   La caja marca "entregado" y sale de la pantalla.
const crypto = require('crypto');
const { run, get, all, transaccion } = require('../db');
const { emitEvento } = require('../realtime');
const { errorHttp } = require('../util');
const { generarNumeroPedido, resolverItems, insertarItemTx, recalcularTotales, saldoPedido, registrarCobroTx } = require('./pedidos');
const { controlarHorarios } = require('./venta-cruzada');
const { comandaAutomatica } = require('./impresion');
const { getIntCfg, urlPublica, mpRequest } = require('./integraciones');
const { pagoMesaDisponible, aplicarPagoMercadoPago } = require('./pago-mesa');
const { claveAviso, numeroAvisos, avisarRetiroWhatsApp } = require('./whatsapp');

const MAX_ITEMS = 30;
const MAX_CANTIDAD = 20;
// Un listo que nadie retiró sale de la pantalla a los 45 minutos (para que no quede para siempre)
const MINUTOS_EN_PANTALLA = 45;
const nuevoToken = () => crypto.randomBytes(12).toString('hex');
const esToken = t => /^[a-f0-9]{24}$/.test(String(t || ''));

// El QR de la barra tiene su propio token (como el de cada mesa); se crea la primera vez
async function tokenBarra({ nuevo = false } = {}) {
  const c = await get('SELECT qr_barra_token FROM configuracion WHERE id = 1');
  if (c && c.qr_barra_token && !nuevo) return c.qr_barra_token;
  const t = nuevoToken();
  await run('UPDATE configuracion SET qr_barra_token = ? WHERE id = 1', [t]);
  return t;
}

async function barraValida(token) {
  if (!esToken(token)) return false;
  const c = await get('SELECT qr_barra_token FROM configuracion WHERE id = 1');
  return !!(c && c.qr_barra_token && c.qr_barra_token === token);
}

async function datosTransferencia() {
  const c = await get('SELECT alias_transferencia, titular_transferencia FROM configuracion WHERE id = 1');
  return c && c.alias_transferencia ? { alias: c.alias_transferencia, titular: c.titular_transferencia || '' } : null;
}

// Nombre corto para la pantalla de retiro (sin el teléfono que a veces va entre paréntesis)
// Número para llamar al cliente: el del día sin ceros (P-20261028-00012 → 12)
const numeroCorto = numero => (String(numero || '').split('-').pop() || '').replace(/^0+(?=\d)/, '');
const nombreCorto = cliente => String(cliente || '').replace(/\(.*\)/, '').trim().split(/\s+/)[0].slice(0, 16);

// lugar: con el autoservicio desde la mesa (qr_mesa_modo = 'retiro') el pedido dice de qué mesa es
async function crearPedidoBarra({ items, cliente, notas, lugar = '' } = {}) {
  const nombre = String(cliente || '').trim().slice(0, 40);
  if (!nombre) throw errorHttp(400, 'Poné tu nombre: con él te llamamos cuando esté listo');
  if (!Array.isArray(items) || !items.length) throw errorHttp(400, 'Agregá algo al pedido');
  if (items.length > MAX_ITEMS) throw errorHttp(400, `Hasta ${MAX_ITEMS} productos por pedido`);
  const limpios = items.map(i => {
    const cantidad = Number(i && i.cantidad);
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > MAX_CANTIDAD) throw errorHttp(400, `Hasta ${MAX_CANTIDAD} de cada producto`);
    return { producto_id: Number(i.producto_id), cantidad, notas: String(i.notas || '').slice(0, 200), opciones: Array.isArray(i.opciones) ? i.opciones : [] };
  });
  const codigo = nuevoToken();
  const r = await transaccion(async () => {
    await controlarHorarios(limpios);
    // Precio y nombre salen de la base (nunca del celular); por acá no se venden insumos sin precio
    const resueltos = await resolverItems(limpios);
    if (resueltos.some(i => !(i.precio > 0))) throw errorHttp(400, 'Producto no disponible');
    const numero = await generarNumeroPedido();
    const { id } = await run(`INSERT INTO pedidos (numero_pedido, tipo, cliente, usuario_id, notas, descuento, propina, origen, codigo_cliente, lugar)
      VALUES (?, 'mostrador', ?, NULL, ?, 0, 0, 'barra', ?, ?)`,
      [numero, nombre, [lugar, String(notas || '').trim()].filter(Boolean).join(' · ').slice(0, 300), codigo, String(lugar).slice(0, 40)]);
    for (const item of resueltos) await insertarItemTx(id, item);
    const { total } = await recalcularTotales(id);
    emitEvento('pedido:nuevo', { id, numero_pedido: numero, numero_corto: numeroCorto(numero), tipo: 'mostrador', origen: 'barra',
      cliente: nombreCorto(nombre), lugar: String(lugar).slice(0, 40) });
    emitEvento('cocina:actualizar', { pedido_id: id, accion: 'creado' });
    emitEvento('dashboard:actualizar', { motivo: 'pedido_creado' });
    emitEvento('retiro:actualizar', { pedido_id: id });
    return { id, numero, total };
  });
  await comandaAutomatica(r.id).catch(() => false);
  return { codigo, numero_pedido: r.numero, total: r.total };
}

async function pedidoPorCodigo(codigo) {
  if (!esToken(codigo)) return null;
  return get('SELECT * FROM pedidos WHERE codigo_cliente = ?', [codigo]);
}

function etapa(p) {
  if (p.estado === 'cancelado') return 'cancelado';
  if (p.retirado_en) return 'retirado';
  if (p.listo_en) return 'listo';
  return 'preparando';
}

// Lo que ve el cliente en su celular
async function estadoParaCliente(codigo) {
  const p = await pedidoPorCodigo(codigo);
  if (!p) throw errorHttp(404, 'No encontramos ese pedido');
  const [items, { saldo }, c, numeroWA] = await Promise.all([
    all('SELECT nombre_producto, cantidad, subtotal FROM pedido_items WHERE pedido_id = ? ORDER BY id', [p.id]),
    saldoPedido(p.id),
    get('SELECT nombre_negocio FROM configuracion WHERE id = 1'),
    numeroAvisos().catch(() => '')
  ]);
  const corto = numeroCorto(p.numero_pedido);
  const enCurso = !['cancelado', 'retirado'].includes(etapa(p));
  return {
    numero_pedido: p.numero_pedido, numero_corto: corto, cliente: nombreCorto(p.cliente), negocio: (c && c.nombre_negocio) || '',
    etapa: etapa(p), lugar: p.lugar || '', llamado_en: p.llamado_en || '',
    // Aviso por WhatsApp: link que abre el WhatsApp del cliente con el mensaje escrito (lo contesta servicios/whatsapp.js)
    aviso_whatsapp: !enCurso || !numeroWA ? null : p.telefono_aviso ? { anotado: true } : {
      link: `https://wa.me/${numeroWA}?text=${encodeURIComponent(`Avisame cuando esté listo mi pedido #${corto} (clave ${claveAviso(p.codigo_cliente)})`)}`
    }, pagado: p.estado === 'pagado' || saldo <= 0, aviso_pago: p.aviso_pago || '',
    cuenta: { items, total: p.total, saldo: p.estado === 'pagado' ? 0 : saldo },
    pago: { mercadopago: await pagoMesaDisponible(), transferencia: await datosTransferencia() }
  };
}

async function iniciarPagoCliente(codigo) {
  const p = await pedidoPorCodigo(codigo);
  if (!p) throw errorHttp(404, 'No encontramos ese pedido');
  if (!(await pagoMesaDisponible())) throw errorHttp(400, 'El pago con Mercado Pago no está habilitado: pagá en la caja al retirar');
  if (p.estado !== 'abierto') throw errorHttp(400, 'El pedido ya está pago');
  const { saldo } = await saldoPedido(p.id);
  if (!(saldo > 0)) throw errorHttp(400, 'El pedido ya está pago');
  const cfg = await getIntCfg('mercadopago');
  const base = urlPublica();
  const vuelta = `${base}/seguimiento.html?p=${codigo}`;
  // external_reference = id del pedido (como el link del cajero): la notificación lo cobra y lo cierra solo
  const preferencia = await mpRequest(cfg, 'POST', '/checkout/preferences', {
    items: [{ title: `Pedido ${p.numero_pedido}`, quantity: 1, unit_price: saldo, currency_id: 'ARS' }],
    external_reference: String(p.id),
    notification_url: `${base}/api/mp/notificacion`,
    back_urls: { success: vuelta, failure: vuelta, pending: vuelta },
    auto_return: 'approved'
  });
  return { total: saldo, link: cfg.modo === 'produccion' ? preferencia.init_point : (preferencia.sandbox_init_point || preferencia.init_point) };
}

// Al volver de Mercado Pago: se consulta el pago a Mercado Pago (nunca se cree lo que dice el celular)
async function verificarPagoCliente(codigo, paymentId) {
  const p = await pedidoPorCodigo(codigo);
  if (!p) throw errorHttp(404, 'No encontramos ese pedido');
  if (paymentId && p.estado === 'abierto') {
    if (!/^\d{1,20}$/.test(String(paymentId))) throw errorHttp(400, 'Pago inválido');
    const pago = await mpRequest(await getIntCfg('mercadopago'), 'GET', `/v1/payments/${encodeURIComponent(paymentId)}`);
    if (String(pago.external_reference) !== String(p.id)) throw errorHttp(400, 'Ese pago no corresponde a este pedido');
    await aplicarPagoMercadoPago(pago);
    emitEvento('retiro:actualizar', { pedido_id: p.id });
  }
  return estadoParaCliente(codigo);
}

// El cliente avisa que transfirió: la caja lo ve y lo confirma con un toque (no se cobra solo: hay que ver la plata)
async function avisarTransferencia(codigo) {
  const p = await pedidoPorCodigo(codigo);
  if (!p) throw errorHttp(404, 'No encontramos ese pedido');
  if (p.estado !== 'abierto') throw errorHttp(400, 'El pedido ya está pago');
  if (!(await datosTransferencia())) throw errorHttp(400, 'El local no tiene alias para transferir: pagá en la caja');
  await run("UPDATE pedidos SET aviso_pago = 'transferencia' WHERE id = ?", [p.id]);
  emitEvento('retiro:actualizar', { pedido_id: p.id, aviso: 'transferencia' });
  return estadoParaCliente(codigo);
}

// ----- Pantalla de retiro (TV de la barra) y panel de la caja -----
// Pedidos de mostrador y para llevar de las últimas horas que todavía no se entregaron
async function tableroRetiro() {
  const filas = await all(`SELECT id, numero_pedido, cliente, origen, estado, total, aviso_pago, listo_en, creado_en, lugar, llamado_en, telefono_aviso,
      CAST((julianday('now') - julianday(listo_en)) * 24 * 60 AS INTEGER) AS minutos_listo
    FROM pedidos
    WHERE tipo IN ('mostrador', 'takeaway') AND estado IN ('abierto', 'pagado') AND retirado_en IS NULL
      AND creado_en >= datetime('now', '-12 hours')
    ORDER BY id`);
  const saldos = {};
  for (const f of filas.filter(x => x.estado === 'abierto')) saldos[f.id] = (await saldoPedido(f.id)).saldo;
  // Qué lleva cada pedido: con una sola computadora, "Para retirar" es también la cocina
  const items = {};
  if (filas.length) {
    for (const i of await all(`SELECT pedido_id, nombre_producto, cantidad, notas FROM pedido_items
      WHERE pedido_id IN (${filas.map(() => '?').join(',')}) ORDER BY id`, filas.map(f => f.id))) {
      (items[i.pedido_id] = items[i.pedido_id] || []).push({ nombre_producto: i.nombre_producto, cantidad: i.cantidad, notas: i.notas || '' });
    }
  }
  const fila = f => ({ id: f.id, items: items[f.id] || [], numero_pedido: f.numero_pedido, numero_corto: numeroCorto(f.numero_pedido), nombre: nombreCorto(f.cliente), origen: f.origen || '',
    lugar: f.lugar || '', llamado_en: f.llamado_en || '', whatsapp: !!f.telefono_aviso,
    pagado: f.estado === 'pagado' || saldos[f.id] <= 0, saldo: f.estado === 'pagado' ? 0 : saldos[f.id], aviso_pago: f.aviso_pago || '' });
  return {
    preparando: filas.filter(f => !f.listo_en).map(fila),
    listos: filas.filter(f => f.listo_en && f.minutos_listo < MINUTOS_EN_PANTALLA).map(fila)
  };
}

// La pantalla de la TV muestra solo número y nombre
async function tableroPublico() {
  const t = await tableroRetiro();
  const corto = f => ({ numero_pedido: f.numero_pedido, numero_corto: f.numero_corto, nombre: f.nombre, lugar: f.lugar, llamado_en: f.llamado_en });
  return { preparando: t.preparando.map(corto), listos: t.listos.map(corto) };
}

async function marcarRetirado(id) {
  const p = await get("SELECT id, estado FROM pedidos WHERE id = ? AND estado IN ('abierto', 'pagado')", [id]);
  if (!p) throw errorHttp(404, 'Pedido no encontrado');
  await run('UPDATE pedidos SET retirado_en = CURRENT_TIMESTAMP, listo_en = COALESCE(listo_en, CURRENT_TIMESTAMP) WHERE id = ?', [p.id]);
  emitEvento('retiro:actualizar', { pedido_id: p.id });
  emitEvento('cocina:actualizar', { pedido_id: p.id, accion: 'listo' });
}

// La caja vuelve a llamar a un cliente que no viene a retirar: su celular, la TV y su WhatsApp (si lo pidió) avisan otra vez
async function llamarDeNuevo(id) {
  const p = await get("SELECT id, listo_en FROM pedidos WHERE id = ? AND estado IN ('abierto', 'pagado') AND retirado_en IS NULL", [id]);
  if (!p) throw errorHttp(404, 'Pedido no encontrado o ya entregado');
  if (!p.listo_en) throw errorHttp(400, 'Todavía no está listo');
  await run('UPDATE pedidos SET llamado_en = CURRENT_TIMESTAMP WHERE id = ?', [p.id]);
  emitEvento('retiro:actualizar', { pedido_id: p.id });
  avisarRetiroWhatsApp(p.id, { otraVez: true });
}

// La caja vio la transferencia: se cobra lo que falta por transferencia y el pedido se cierra
async function cobrarTransferencia(pedidoId, usuarioId) {
  const r = await transaccion(async () => {
    const p = await get("SELECT id, numero_pedido FROM pedidos WHERE id = ? AND estado = 'abierto'", [pedidoId]);
    if (!p) throw errorHttp(400, 'El pedido ya está pago o cerrado');
    const { saldo } = await saldoPedido(p.id);
    if (!(saldo > 0)) throw errorHttp(400, 'El pedido no tiene saldo');
    const cobro = await registrarCobroTx(p.id, { pagos: [{ metodo: 'transferencia', monto: saldo }], usuarioId });
    await run("UPDATE pedidos SET aviso_pago = '' WHERE id = ?", [p.id]);
    await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)',
      [usuarioId, 'cobro_transferencia', `Pedido ${p.numero_pedido}: transferencia recibida $${saldo}`]);
    return { ...cobro, pedido_id: p.id, numero_pedido: p.numero_pedido, monto: saldo };
  });
  emitEvento('retiro:actualizar', { pedido_id: pedidoId });
  emitEvento('dashboard:actualizar', { motivo: 'pedido_pagado' });
  return r;
}

module.exports = {
  tokenBarra, barraValida, crearPedidoBarra, estadoParaCliente, iniciarPagoCliente, verificarPagoCliente,
  avisarTransferencia, tableroRetiro, tableroPublico, marcarRetirado, cobrarTransferencia, llamarDeNuevo
};
