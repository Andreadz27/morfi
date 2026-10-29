// Resumen de cada noche por WhatsApp al dueño: al cerrar el día sale la plantilla resumen_diario con ventas,
// tickets, ganancia, lo más vendido y lo que hay que mirar. Sin número del dueño no se manda; un segundo cierre
// del mismo día no lo repite. API de Meta simulada.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { iniciarServidor, esperar } = require('./helpers');

const envios = [];
const meta = http.createServer((req, res) => {
  let c = '';
  req.on('data', d => { c += d; });
  req.on('end', () => {
    envios.push(JSON.parse(c || '{}'));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ messages: [{ id: 'wamid.' + envios.length }] }));
  });
});
const CONFIG = { activa: true, phone_number_id: '1', access_token: 'EAAG', app_secret: 's', verify_token: 'v' };
let s;
const esperarEnvios = async n => { for (let i = 0; i < 60 && envios.length < n; i++) await esperar(50); return envios; };

before(async () => {
  await new Promise(ok => meta.listen(0, '127.0.0.1', ok));
  s = await iniciarServidor({ GM_WA_API_URL: `http://127.0.0.1:${meta.address().port}` });
  await s.llamar('PUT', '/api/config', { nombre_negocio: 'NCASA' }, s.tokenAdmin);
  const [prod] = await s.q("SELECT id FROM productos WHERE activo = 1 AND precio_venta > 0 AND clase = 'venta' ORDER BY id LIMIT 1");
  await s.q('UPDATE productos SET precio_venta = 1500 WHERE id = ?', [prod.id]);
  const [, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'takeaway', items: [{ producto_id: prod.id, cantidad: 2 }] }, s.tokenVendedor);
  await s.llamar('POST', `/api/pedidos/${p.id}/pagar`, { metodo: 'efectivo', monto: 3000 }, s.tokenVendedor);
});
after(async () => {
  await s.cerrar();
  await new Promise(ok => meta.close(ok));
});

test('sin el WhatsApp del dueño no se manda nada al cerrar el día', async () => {
  await s.llamar('PUT', '/api/integraciones/config/whatsapp', CONFIG, s.tokenAdmin);
  assert.equal((await s.llamar('POST', '/api/cierres', {}, s.tokenAdmin))[0], 201);
  await esperar(600);
  assert.equal(envios.length, 0);
});

test('con el número del dueño: al cerrar el día le llega el resumen, una sola vez', async () => {
  await s.llamar('PUT', '/api/integraciones/config/whatsapp', { ...CONFIG, telefono_dueno: '11 2390-0155' }, s.tokenAdmin);
  assert.equal((await s.llamar('POST', '/api/cierres', {}, s.tokenAdmin))[0], 201);
  await esperarEnvios(1);
  assert.equal(envios.length, 1);
  const m = envios[0];
  assert.deepEqual([m.to, m.template.name], ['5491123900155', 'resumen_diario']);
  const p = m.template.components[0].parameters.map(x => x.text);
  assert.equal(p.length, 7);
  assert.equal(p[0], 'NCASA');
  assert.match(p[2], /^\$ 3\.000/, 'ventas del día');
  assert.equal(p[3], '1', 'tickets');
  assert.match(p[5], /\(2\)/, 'lo más vendido con cantidad');
  // Se vuelve a cerrar el día (hubo una venta tarde): no se repite el mensaje
  assert.equal((await s.llamar('POST', '/api/cierres', {}, s.tokenAdmin))[0], 201);
  await esperar(600);
  assert.equal(envios.length, 1);
});
