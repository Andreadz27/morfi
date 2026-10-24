// CAEA (contingencia, RG ARCA 5782/2025 y 5785/2025): si ARCA no responde, la factura sale con el CAEA de la quincena
// en el punto de venta CAEA y se informa sola al volver internet. Contra el AfipSDK simulado (test/afip-simulado.js).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciarServidor } = require('./helpers');
const { iniciarArcaSimulado } = require('./afip-simulado');
const { urlQrArca } = require('../src/servicios/ticket-fiscal');

let arca, s, prod;
const PTO = 3, PTO_CAEA = 9;
const informes = () => arca.pedidos.filter(p => p.method === 'FECAEARegInformativo');

before(async () => {
  arca = await iniciarArcaSimulado();
  arca.ptoCaea = PTO_CAEA;
  arca.ultimoCaea[6] = 4; // el punto de venta CAEA ya tenía 4 facturas B
  s = await iniciarServidor({ GM_AFIP_API_URL: arca.url });
  [prod] = await s.q('SELECT id FROM productos WHERE activo = 1 ORDER BY id LIMIT 1');
  await s.q('UPDATE productos SET precio_venta = 1210 WHERE id = ?', [prod.id]);
  const [st] = await s.llamar('PUT', '/api/integraciones/config/afip',
    { cuit: '20-11111111-2', access_token: 'x', activa: true, iva_tipo: 5, pto_venta: PTO, pto_venta_caea: PTO_CAEA }, s.tokenAdmin);
  assert.equal(st, 200);
});
after(async () => { await s.cerrar(); await arca.cerrar(); });

async function pedidoCobrado() {
  const [, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'takeaway', items: [{ producto_id: prod.id, cantidad: 1 }] }, s.tokenVendedor);
  assert.equal((await s.llamar('POST', `/api/pedidos/${p.id}/pagar`, { metodo: 'tarjeta', monto: 1210 }, s.tokenVendedor))[0], 200);
  return p;
}
const facturarB = async () => s.llamar('POST', '/api/integraciones/afip/facturar', { pedido_id: (await pedidoCobrado()).id, tipo_comprobante: 6 }, s.tokenVendedor);
const actualizar = async () => {
  const [st, r] = await s.llamar('POST', '/api/integraciones/afip/caea/actualizar', null, s.tokenAdmin);
  assert.equal(st, 200, JSON.stringify(r));
  return r;
};

test('sin CAEA todavía y ARCA caído: la factura queda en espera, como antes', async () => {
  arca.caido = true;
  const [st, r] = await facturarB();
  arca.caido = false;
  assert.equal(st, 202, JSON.stringify(r));
  assert.equal(r.pendiente, true);
  await s.q("UPDATE facturas_pendientes SET estado = 'descartada'");
});

test('con conexión se piden el CAEA de la quincena y la numeración del punto de venta CAEA', async () => {
  const r = await actualizar();
  assert.equal(r.estado.configurado, true);
  assert.ok(r.estado.vigente && /^\d{14}$/.test(r.estado.vigente.caea), JSON.stringify(r.estado));
  assert.ok(arca.pedidos.some(p => p.method === 'FECAEASolicitar'));
  // Pedirlo de nuevo no falla: ya está guardado (y si no, ARCA dice "ya otorgado" y se consulta)
  await actualizar();
  assert.equal((await s.q('SELECT COUNT(*) n FROM caea'))[0].n >= 1, true);
  const [{ ultimo }] = await s.q('SELECT ultimo FROM caea_numeracion WHERE pto_venta = ? AND tipo = 6', [PTO_CAEA]);
  assert.equal(ultimo, 4);
  // El usuario sin permiso de administrador no lo ve
  assert.equal((await s.llamar('GET', '/api/integraciones/afip/caea', null, s.tokenVendedor))[0], 403);
});

test('ARCA caído: la factura sale con CAEA en el punto de venta CAEA, con el número siguiente', async () => {
  arca.caido = true;
  const [st1, f1] = await facturarB();
  const [st2, f2] = await facturarB();
  arca.caido = false;
  assert.deepEqual([st1, st2], [200, 200], JSON.stringify([f1, f2]));
  assert.equal(f1.autorizacion, 'CAEA');
  assert.deepEqual([f1.punto_venta, f1.numero_comprobante, f2.numero_comprobante], [PTO_CAEA, 5, 6]);
  const [c] = await s.q('SELECT * FROM comprobantes_afip WHERE id = ?', [f1.id]);
  assert.deepEqual([c.autorizacion, c.caea_informado, c.punto_venta], ['CAEA', 0, PTO_CAEA]);
  const datos = JSON.parse(c.caea_datos);
  assert.equal(datos.CAEA, c.cae);
  assert.match(String(datos.CbteFchHsGen), /^\d{14}$/);
  assert.deepEqual([datos.ImpTotal, datos.ImpNeto, datos.ImpIVA], [1210, 1000, 210]);
  // El QR de ARCA marca el código como CAEA (tipoCodAut "A")
  const qr = JSON.parse(Buffer.from(urlQrArca({ cuit: '20111111112' }, c).split('?p=')[1], 'base64').toString());
  assert.deepEqual([qr.tipoCodAut, qr.ptoVta, qr.nroCmp], ['A', PTO_CAEA, 5]);
  // La misma factura no se emite dos veces
  assert.equal((await s.llamar('POST', '/api/integraciones/afip/facturar', { pedido_id: c.pedido_id, tipo_comprobante: 6 }, s.tokenVendedor))[0], 409);
});

test('vuelve internet: se informan a ARCA en orden y no se informan dos veces', async () => {
  const r = await actualizar();
  assert.equal(r.resultado.informar.informados, 2);
  assert.deepEqual(informes().map(p => p.params.FeCAEARegInfReq.FeDetReq.FECAEADetRequest[0].CbteDesde), [5, 6]);
  assert.deepEqual(informes().map(p => p.params.FeCAEARegInfReq.FeCabReq.PtoVta), [PTO_CAEA, PTO_CAEA]);
  assert.equal(r.estado.sin_informar, 0);
  await actualizar();
  assert.equal(informes().length, 2);
  assert.equal(arca.ultimoCaea[6], 6, 'ARCA ya conoce esos números');
});

test('si ARCA rechaza el informe, queda marcado y con alerta', async () => {
  arca.caido = true;
  const [, f] = await facturarB();
  arca.caido = false;
  assert.equal(f.numero_comprobante, 7);
  arca.rechazarInforme = 'Fecha fuera de rango';
  const r = await actualizar();
  arca.rechazarInforme = null;
  assert.equal(r.resultado.informar.rechazados, 1);
  assert.equal(r.estado.rechazados, 1);
  const [c] = await s.q('SELECT caea_informado, caea_error FROM comprobantes_afip WHERE id = ?', [f.id]);
  assert.equal(c.caea_informado, -1);
  assert.match(c.caea_error, /Fecha fuera de rango/);
  assert.ok((await s.q("SELECT 1 FROM auditoria WHERE accion = 'alerta_afip' AND detalle LIKE '%CAEA%'")).length);
});

test('una quincena terminada sin facturas con su CAEA se informa sin movimiento', async () => {
  await s.q("INSERT INTO caea (modo, periodo, orden, caea, vig_desde, vig_hasta, tope_informar) VALUES ('homologacion', 202601, 1, '30999999999999', '2026-01-01', '2026-01-15', '2026-01-23')");
  await actualizar();
  const sinMov = arca.pedidos.filter(p => p.method === 'FECAEASinMovimientoInformar');
  assert.deepEqual(sinMov.map(p => [p.params.CAEA, p.params.PtoVta]), [['30999999999999', PTO_CAEA]]);
  assert.equal((await s.q("SELECT sin_movimiento FROM caea WHERE caea = '30999999999999'"))[0].sin_movimiento, 1);
  await actualizar();
  assert.equal(arca.pedidos.filter(p => p.method === 'FECAEASinMovimientoInformar').length, 1, 'una sola vez');
});

test('el uso del mes se controla contra el 5 % y una factura en línea sigue saliendo con CAE', async () => {
  const [st, f] = await facturarB();
  assert.equal(st, 200);
  assert.equal(f.autorizacion || 'CAE', 'CAE');
  assert.equal(f.punto_venta, PTO);
  const [, e] = await s.llamar('GET', '/api/integraciones/afip/caea', null, s.tokenAdmin);
  assert.equal(e.porcentaje_mes, 75); // 3 de 4 facturas del mes con CAEA
  assert.equal(e.excedido, true);
});

test('si se cortó después de pedir el CAE (puede estar emitido), no se usa CAEA: queda en espera', async () => {
  arca.cortarDespuesDeEmitir = true;
  const [st, r] = await facturarB();
  assert.equal(st, 202, JSON.stringify(r));
  assert.equal(r.pendiente, true);
});
