// Transferencias al alias que entran a Mercado Pago (simulado): el pedido que avisó que transfirió se cobra solo
// cuando entra una transferencia por su saldo exacto; ante la duda (dos pedidos o dos transferencias iguales) no se
// cobra nada. Y el reporte de ventas con el detalle completo: productos, cobros, resumen por medio de pago y
// las transferencias del período marcadas con la venta en que quedaron registradas.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { iniciarServidor, esperar } = require('./helpers');

const YO = 3284717330;
// Mercado Pago simulado: /users/me y /v1/payments/search (filtra por fecha como el real)
const externo = { pagos: [], busquedas: [] };
const servidorExterno = http.createServer((req, res) => {
  const responder = (obj, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/users/me') return responder({ id: YO });
  if (url.pathname === '/v1/payments/search') {
    externo.busquedas.push(Object.fromEntries(url.searchParams));
    const desde = Date.parse(url.searchParams.get('begin_date'));
    const hasta = Date.parse(url.searchParams.get('end_date'));
    const offset = Number(url.searchParams.get('offset') || 0);
    const todos = externo.pagos.filter(p => Date.parse(p.date_created) >= desde && Date.parse(p.date_created) <= hasta)
      .sort((a, b) => Date.parse(b.date_created) - Date.parse(a.date_created));
    return responder({ paging: { total: todos.length }, results: todos.slice(offset, offset + 100) });
  }
  responder({ message: 'no encontrado' }, 404);
});

let ultimoId = 9000;
// Una transferencia que entra a la cuenta (o que sale, o una venta con el botón), hace `segundos` segundos
function transferencia(monto, { segundos = 5, entra = true, operacion = 'money_transfer', estado = 'approved' } = {}) {
  const fecha = new Date(Date.now() - segundos * 1000).toISOString();
  const p = {
    id: ++ultimoId, status: estado, operation_type: operacion, transaction_amount: monto,
    date_created: fecha, date_approved: fecha, payment_method_id: 'account_money',
    collector_id: entra ? YO : 111, payer: { id: String(entra ? 222 : YO) }
  };
  externo.pagos.push(p);
  return p;
}

let s, token, prod;
const pedirBarra = async (cantidad = 1) => {
  const [st, r] = await s.llamar('POST', `/api/publico/barra/${token}/pedido`, { cliente: 'Cliente Test', items: [{ producto_id: prod.id, cantidad }] });
  assert.equal(st, 201, JSON.stringify(r));
  return r;
};
const avisar = codigo => s.llamar('POST', `/api/publico/pedido-barra/${codigo}/transferi`);
const estado = async codigo => (await s.q('SELECT id, estado, aviso_pago FROM pedidos WHERE codigo_cliente = ?', [codigo]))[0];
async function hasta(condicion, ms = 5000) {
  for (let t = 0; t < ms; t += 100) {
    if (await condicion()) return true;
    await esperar(100);
  }
  return false;
}

before(async () => {
  await new Promise(ok => servidorExterno.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${servidorExterno.address().port}`;
  s = await iniciarServidor({ BASE_URL: 'https://local.test', GM_MP_API_URL: url, GM_TRANSFERENCIAS_INTERVALO_MS: '300' });
  [prod] = await s.q("SELECT id FROM productos WHERE activo = 1 AND clase = 'venta' ORDER BY id LIMIT 1");
  await s.q('UPDATE productos SET precio_venta = 1000 WHERE id = ?', [prod.id]);
  const [, qr] = await s.llamar('GET', '/api/barra/qr', undefined, s.tokenAdmin);
  token = qr.url.split('barra=')[1];
  await s.llamar('PUT', '/api/config', { alias_transferencia: 'castillo.694' }, s.tokenAdmin);
});
after(async () => {
  await s.cerrar();
  await new Promise(ok => servidorExterno.close(ok));
});

test('sin Mercado Pago no se consulta nada: el aviso queda para la caja', async () => {
  const r = await pedirBarra();
  await avisar(r.codigo);
  transferencia(1000);
  await esperar(1000);
  assert.equal(externo.busquedas.length, 0, 'no se llamó a Mercado Pago');
  assert.equal((await estado(r.codigo)).estado, 'abierto');
  // La caja lo cobra a mano y esa transferencia queda libre (no se asoció a nada)
  const ped = await estado(r.codigo);
  assert.equal((await s.llamar('POST', `/api/pedidos/${ped.id}/cobrar-transferencia`, {}, s.tokenAdmin))[0], 200);
  const [, rep] = await s.llamar('GET', '/api/reportes/transferencias-mp', undefined, s.tokenAdmin);
  assert.deepEqual(rep, { disponible: false, transferencias: [] });
});

test('el cliente de la barra avisa que transfirió y la transferencia por el saldo exacto lo cobra solo', async () => {
  await s.llamar('PUT', '/api/integraciones/config/mercadopago', { access_token: 'TEST-token', activa: true }, s.tokenAdmin);
  externo.pagos = [];
  const r = await pedirBarra(2);
  // Ruido: una que salió de la cuenta por el mismo monto, una vieja, una rechazada y un pago con el botón
  transferencia(2000, { entra: false });
  transferencia(2000, { segundos: 3600 });
  transferencia(2000, { estado: 'rejected' });
  transferencia(2000, { operacion: 'regular_payment' });
  const buena = transferencia(2000, { segundos: 0 });
  await avisar(r.codigo);
  assert.ok(await hasta(async () => (await estado(r.codigo)).estado === 'pagado'), 'se cobró solo');
  const ped = await estado(r.codigo);
  assert.equal(ped.aviso_pago, '');
  const pagos = await s.q('SELECT metodo, monto, referencia FROM pagos WHERE pedido_id = ?', [ped.id]);
  assert.deepEqual(pagos, [{ metodo: 'transferencia', monto: 2000, referencia: `MP-${buena.id}` }]);
  const [aud] = await s.q("SELECT detalle FROM auditoria WHERE accion = 'cobro_transferencia' ORDER BY id DESC LIMIT 1");
  assert.match(aud.detalle, /detectada sola en Mercado Pago/);
  assert.ok(externo.busquedas.every(b => b.begin_date && b.end_date && b.range === 'date_created'));
});

test('ante la duda no se cobra nada: dos pedidos por el mismo monto, o dos transferencias iguales', async () => {
  externo.pagos = [];
  const a = await pedirBarra(3);
  const b = await pedirBarra(3);
  await avisar(a.codigo);
  await avisar(b.codigo);
  transferencia(3000, { segundos: 0 });
  await esperar(1200);
  assert.equal((await estado(a.codigo)).estado, 'abierto', 'dos pedidos de $3000: no se sabe cuál');
  assert.equal((await estado(b.codigo)).estado, 'abierto');
  // La caja confirma uno a mano: queda uno solo esperando y una sola transferencia libre → se cobra solo
  assert.equal((await s.llamar('POST', `/api/pedidos/${(await estado(a.codigo)).id}/cobrar-transferencia`, {}, s.tokenAdmin))[0], 200);
  assert.ok(await hasta(async () => (await estado(b.codigo)).estado === 'pagado'), 'el otro se cobró con la transferencia');

  externo.pagos = [];
  const c = await pedirBarra(4);
  await avisar(c.codigo);
  transferencia(4000, { segundos: 0 });
  transferencia(4000, { segundos: 0 });
  await esperar(1200);
  assert.equal((await estado(c.codigo)).estado, 'abierto', 'dos transferencias de $4000: no se sabe cuál es');
});

test('una transferencia anterior al pedido o ya usada no lo cobra', async () => {
  externo.pagos = [];
  const usada = transferencia(5000, { segundos: 600 });
  const r1 = await pedirBarra(5);
  await avisar(r1.codigo);
  await esperar(1200);
  assert.equal((await estado(r1.codigo)).estado, 'abierto', 'entró 10 minutos antes de pedir: es de otra cosa');
  // La misma transferencia no sirve para cobrar dos veces (ni desde la conciliación)
  const nueva = transferencia(5000, { segundos: 0 });
  assert.ok(await hasta(async () => (await estado(r1.codigo)).estado === 'pagado'));
  const [pago] = await s.q('SELECT referencia FROM pagos WHERE pedido_id = ?', [(await estado(r1.codigo)).id]);
  assert.equal(pago.referencia, `MP-${nueva.id}`);
  assert.notEqual(pago.referencia, `MP-${usada.id}`);
  const r2 = await pedirBarra(5);
  await avisar(r2.codigo);
  await esperar(1200);
  assert.equal((await estado(r2.codigo)).estado, 'abierto', 'la de $5000 ya se usó');
  await s.llamar('POST', `/api/pedidos/${(await estado(r2.codigo)).id}/cobrar-transferencia`, {}, s.tokenAdmin);
});

test('mesa que pide la cuenta "paga por transferencia": se cobra sola, la mesa se libera y el aviso se atiende', async () => {
  externo.pagos = [];
  const [mesa] = await s.q("SELECT id, qr_token FROM mesas WHERE estado = 'libre' ORDER BY id LIMIT 1");
  const [, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'salon', mesa_id: mesa.id, items: [{ producto_id: prod.id, cantidad: 7 }] }, s.tokenAdmin);
  assert.ok(p.id, JSON.stringify(p));
  const [, sol] = await s.llamar('POST', `/api/publico/mesa/${mesa.qr_token}/llamar`, { tipo: 'cuenta', forma: 'transferencia' });
  transferencia(7000, { segundos: 0 });
  assert.ok(await hasta(async () => (await s.q('SELECT estado FROM pedidos WHERE id = ?', [p.id]))[0].estado === 'pagado'));
  assert.equal((await s.q('SELECT estado FROM mesas WHERE id = ?', [mesa.id]))[0].estado, 'libre');
  assert.ok(await hasta(async () => (await s.q('SELECT estado FROM solicitudes_mesa WHERE id = ?', [sol.id]))[0].estado === 'atendida'));
});

test('reporte de ventas: detalle completo, resumen por medio de pago y filtro por medio', async () => {
  // Una venta mixta: parte efectivo, parte tarjeta, con propina
  const [, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'takeaway', items: [{ producto_id: prod.id, cantidad: 3 }] }, s.tokenAdmin);
  const [stC, c] = await s.llamar('POST', `/api/pedidos/${p.id}/cobro`, { propina: 300, pagos: [{ metodo: 'efectivo', monto: 1300 }, { metodo: 'tarjeta', monto: 2000 }] }, s.tokenAdmin);
  assert.equal(stC, 200, JSON.stringify(c));

  const [st, rep] = await s.llamar('GET', '/api/reportes/ventas', undefined, s.tokenAdmin);
  assert.equal(st, 200, JSON.stringify(rep));
  const venta = rep.pedidos.find(x => x.id === p.id);
  assert.deepEqual(venta.items.map(i => [i.cantidad, i.subtotal]), [[3, 3000]]);
  assert.deepEqual(venta.pagos.map(pg => [pg.metodo, pg.monto]), [['efectivo', 1300], ['tarjeta', 2000]]);
  assert.equal(venta.propina, 300);
  const r = rep.resumen;
  const total = rep.pedidos.reduce((s2, x) => s2 + x.total, 0);
  assert.equal(r.total, total);
  assert.equal(r.cobrado, total, 'lo cobrado por medio de pago suma el total vendido');
  const tr = r.por_metodo.find(m => m.metodo === 'transferencia');
  assert.equal(tr.cantidad, 7, 'las 7 ventas por transferencia');
  assert.equal(r.por_metodo.find(m => m.metodo === 'tarjeta').total, 2000);
  assert.equal(Math.round(r.por_metodo.reduce((s2, m) => s2 + m.porcentaje, 0)), 100);
  assert.ok(r.productos.length >= 1 && r.por_tipo.some(t => t.tipo === 'takeaway') && r.propinas === 300);

  const [, soloTarjeta] = await s.llamar('GET', '/api/reportes/ventas?metodo=tarjeta', undefined, s.tokenAdmin);
  assert.deepEqual(soloTarjeta.pedidos.map(x => x.id), [p.id], 'solo la venta que tuvo tarjeta');
  assert.equal(soloTarjeta.metodo, 'tarjeta');
  const [, cualquiera] = await s.llamar('GET', '/api/reportes/ventas?metodo=bitcoin', undefined, s.tokenAdmin);
  assert.equal(cualquiera.cantidad, rep.cantidad, 'un medio desconocido no filtra');
});

test('reporte de transferencias recibidas: cada una con la venta en que quedó registrada', async () => {
  externo.pagos = [];
  const r = await pedirBarra(8);
  await avisar(r.codigo);
  const asociada = transferencia(8000, { segundos: 0 });
  const suelta = transferencia(1234, { segundos: 30 });
  transferencia(999, { entra: false });
  assert.ok(await hasta(async () => (await estado(r.codigo)).estado === 'pagado'));
  const [st, rep] = await s.llamar('GET', '/api/reportes/transferencias-mp', undefined, s.tokenAdmin);
  assert.equal(st, 200, JSON.stringify(rep));
  assert.equal(rep.disponible, true);
  assert.deepEqual(rep.transferencias.map(t => t.id).sort(), [String(asociada.id), String(suelta.id)].sort(), 'solo lo que entró');
  const a = rep.transferencias.find(t => t.id === String(asociada.id));
  assert.equal(a.pedido.numero_pedido, r.numero_pedido);
  assert.equal(rep.transferencias.find(t => t.id === String(suelta.id)).pedido, null);
  assert.equal((await s.llamar('GET', '/api/reportes/transferencias-mp?desde=2026-01-01&hasta=2026-12-31', undefined, s.tokenAdmin))[0], 400, 'más de 3 meses');
  // El vendedor con permiso de reportes lo ve; sin sesión no
  assert.equal((await s.llamar('GET', '/api/reportes/transferencias-mp'))[0], 401);
});

test('reporte de transferencias: las ventas cobradas a mano como "Transferencia" se asocian por monto y hora', async () => {
  externo.pagos = [];
  const r3 = await pedirBarra(13);
  const r4 = await pedirBarra(17);
  const antes = transferencia(13000, { segundos: 600 }); // anterior al pedido: no es de esa venta
  const de3 = transferencia(13000, { segundos: 0 });
  const de4 = transferencia(17000, { segundos: 0 });
  const otra = transferencia(5555, { segundos: 0 });
  // La caja vio las transferencias y cobró a mano (sin número de operación)
  for (const r of [r3, r4]) {
    const { id } = await estado(r.codigo);
    const [st, c] = await s.llamar('POST', `/api/pedidos/${id}/cobrar-transferencia`, undefined, s.tokenAdmin);
    assert.equal(st, 200, JSON.stringify(c));
  }
  const [, rep] = await s.llamar('GET', '/api/reportes/transferencias-mp', undefined, s.tokenAdmin);
  const de = t => rep.transferencias.find(x => x.id === String(t.id));
  assert.equal(de(de3).pedido.numero_pedido, r3.numero_pedido);
  assert.equal(de(de3).pedido.a_mano, true);
  assert.equal(de(de4).pedido.numero_pedido, r4.numero_pedido);
  assert.equal(de(otra).pedido, null, 'ninguna venta cobrada por ese monto');
  assert.equal(de(antes).pedido, null, 'entró antes de hacer el pedido');
});
