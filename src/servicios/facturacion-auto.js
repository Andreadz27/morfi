'use strict';
// Factura automática: cada pedido que queda pagado (caja, mozo, Mercado Pago desde la mesa, transferencia
// confirmada...) se factura solo a Consumidor Final: Factura B si el local es Responsable Inscripto, C si es
// monotributista o exento. Se activa en Integraciones → AFIP ("Facturar automáticamente cada venta").
// - Si en la caja se eligió una factura (A con CUIT, o B/C con datos), esa manda: el cobro avisa antes de cerrar
//   (marcarFacturaManual) y la automática no se hace.
// - Sin conexión con ARCA va por CAEA o queda en espera y sale sola (facturarOEncolar).
// - Si ARCA la rechaza, queda en el pedido para reintentar y se avisa en el sistema.
const { get } = require('../db');
const { alEvento, emitEvento } = require('../realtime');
const { getIntCfg } = require('./integraciones');

const manuales = new Set();
// Cobro con factura elegida a mano: se marca antes de cerrar el pedido (el aviso de pagado llega antes que la factura)
function marcarFacturaManual(pedidoId) {
  manuales.add(Number(pedidoId));
  setTimeout(() => manuales.delete(Number(pedidoId)), 60000).unref();
}

// Responsable Inscripto: B; monotributo y exento: C. Sin la condición cargada no se adivina: no se factura sola.
const tipoAutomatico = cfg => ({ ri: 6, monotributo: 11, exento: 11 })[cfg.condicion_iva] || null;

async function facturarAutomatico(pedidoId) {
  const id = Number(pedidoId);
  if (manuales.has(id)) return null;
  const cfg = await getIntCfg('afip');
  if (!cfg.activa || !cfg.factura_auto) return null;
  const p = await get("SELECT id, numero_pedido, estado, total, propina FROM pedidos WHERE id = ?", [id]);
  if (!p || p.estado !== 'pagado') return null;
  if (!(Number(p.total) - Number(p.propina || 0) > 0)) return null;
  // Ya facturado (o en espera) por otro camino: nada que hacer
  const ya = await get(`SELECT 1 AS x FROM comprobantes_afip WHERE pedido_id = ? AND tipo_comprobante IN (1, 6, 11) LIMIT 1`, [id])
    || await get("SELECT 1 AS x FROM facturas_pendientes WHERE pedido_id = ? AND estado IN ('pendiente', 'error') LIMIT 1", [id]);
  if (ya) return null;
  const tipo = tipoAutomatico(cfg);
  if (!tipo) {
    emitEvento('afip:factura_auto', { pedido_id: id, numero_pedido: p.numero_pedido, ok: false,
      error: 'Falta la condición frente al IVA del local (Integraciones → AFIP)' });
    return null;
  }
  const { facturarOEncolar } = require('./sin-conexion');
  try {
    const r = await facturarOEncolar(id, { tipo, cuit: '', condicion: 5 });
    emitEvento('afip:factura_auto', { pedido_id: id, numero_pedido: p.numero_pedido, ok: true, pendiente: !!(r && r.pendiente) });
    return r;
  } catch (e) {
    // Ya facturado a mano mientras tanto (409): está bien. Otro error: se avisa para reintentarlo desde el pedido
    if (e.status === 409) return null;
    console.error('[Factura automática]', p.numero_pedido, e.message);
    emitEvento('afip:factura_auto', { pedido_id: id, numero_pedido: p.numero_pedido, ok: false, error: e.message });
    return null;
  }
}

function iniciarFacturaAutomatica() {
  alEvento('pedido:pagado', d => facturarAutomatico(d && d.id));
}

module.exports = { iniciarFacturaAutomatica, facturarAutomatico, marcarFacturaManual, tipoAutomatico };
