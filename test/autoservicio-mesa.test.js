// Autoservicio desde la mesa (qr_mesa_modo = 'retiro'): cada cliente pide y paga su pedido desde el QR de su mesa,
// va a cocina sin mozo y lo retira en el mostrador. Aviso de "listo": en su celular, en la TV de retiro y, si lo pidió,
// por WhatsApp (escribe él primero con un mensaje ya armado; Fadido le contesta). La caja puede llamarlo de nuevo.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const http = require('http');
const { iniciarServidor, esperar } = require('./helpers');

// ---- API de Meta simulada ----
const meta = { envios: [] };
const servidorMeta = http.createServer((req, res) => {
  let cuerpo = '';
  req.on('data', d => { cuerpo += d; });
  req.on('end', () => {
    meta.envios.push(JSON.parse(cuerpo || '{}'));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ messaging_product: 'whatsapp', messages: [{ id: `wamid.${meta.envios.length}` }] }));
  });
});
const APP_SECRET = 'secreto-autoservicio';
const esperarEnvios = async n => {
  for (let t = 0; t < 80 && meta.envios.length < n; t++) await esperar(50);
  return meta.envios;
};
const textoUltimo = () => meta.envios[meta.envios.length - 1].text.body;

let s, mesa, prod, tokenBarra;
const publico = (metodo, ruta, body) => s.llamar(metodo, `/api/publico/mesa/${mesa.qr_token}${ruta}`, body);
const cliente = (codigo, ruta = '', metodo = 'GET', body) => s.llamar(metodo, `/api/publico/pedido-barra/${codigo}${ruta}`, body);
const escribirAlLocal = (from, texto) => {
  const crudo = JSON.stringify({ entry: [{ changes: [{ value: {
    contacts: [{ wa_id: from, profile: { name: 'Ana' } }],
    messages: [{ id: 'wamid.in.' + crypto.randomBytes(4).toString('hex'), from, type: 'text', text: { body: texto } }]
  } }] }] });
  return fetch(`${s.base}/api/whatsapp/webhook`, { method: 'POST', body: crudo, headers: { 'Content-Type': 'application/json',
    'X-Hub-Signature-256': 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(crudo).digest('hex') } });
};

before(async () => {
  await new Promise(ok => servidorMeta.listen(0, '127.0.0.1', ok));
  s = await iniciarServidor({ BASE_URL: 'http://127.0.0.1', GM_WA_API_URL: `http://127.0.0.1:${servidorMeta.address().port}` });
  [mesa] = await s.q("SELECT id, nombre, qr_token FROM mesas WHERE estado = 'libre' ORDER BY id LIMIT 1");
  [prod] = await s.q("SELECT id, precio_venta FROM productos WHERE activo = 1 AND precio_venta > 0 AND clase = 'venta' ORDER BY id LIMIT 1");
  const [st] = await s.llamar('PUT', '/api/config', { qr_mesa_modo: 'retiro', nombre_negocio: 'NCASA' }, s.tokenAdmin);
  assert.equal(st, 200);
  const [, qr] = await s.llamar('GET', '/api/barra/qr', undefined, s.tokenAdmin);
  tokenBarra = qr.url.split('barra=')[1];
});
after(async () => {
  await s.cerrar();
  await new Promise(ok => servidorMeta.close(ok));
});

test('modo inválido rechazado; la mesa informa el modo autoservicio', async () => {
  assert.equal((await s.llamar('PUT', '/api/config', { qr_mesa_modo: 'otro' }, s.tokenAdmin))[0], 400);
  const [, est] = await publico('GET', '');
  assert.equal(est.modo, 'retiro');
});

test('cada cliente hace su pedido: va a cocina sin mozo, dice la mesa y no ocupa la mesa', async () => {
  assert.equal((await publico('POST', '/pedido', { items: [{ producto_id: prod.id, cantidad: 1 }] }))[0], 400, 'sin nombre no lo pueden llamar');
  const [st, r] = await publico('POST', '/pedido', { cliente: 'Ana López', notas: 'sin hielo', items: [{ producto_id: prod.id, cantidad: 2, precio: 1 }] });
  assert.equal(st, 201, JSON.stringify(r));
  assert.match(r.codigo, /^[a-f0-9]{24}$/);
  assert.equal(r.total, prod.precio_venta * 2, 'el precio sale de la base');
  const [ped] = await s.q('SELECT id, tipo, origen, lugar, mesa_id, notas FROM pedidos WHERE codigo_cliente = ?', [r.codigo]);
  assert.deepEqual([ped.tipo, ped.origen, ped.lugar, ped.mesa_id], ['mostrador', 'barra', mesa.nombre, null]);
  assert.equal(ped.notas, `${mesa.nombre} · sin hielo`, 'la comanda dice de qué mesa es');
  assert.equal((await s.q('SELECT estado FROM mesas WHERE id = ?', [mesa.id]))[0].estado, 'libre');
  assert.equal((await s.q('SELECT COUNT(*) n FROM solicitudes_mesa WHERE mesa_id = ?', [mesa.id]))[0].n, 0, 'no espera al mozo');

  // Dos personas de la misma mesa: cada una con su pedido y su cuenta
  const [, r2] = await publico('POST', '/pedido', { cliente: 'Beto', items: [{ producto_id: prod.id, cantidad: 1 }] });
  assert.notEqual(r2.codigo, r.codigo);

  const [, e] = await cliente(r.codigo);
  assert.deepEqual([e.etapa, e.lugar, e.cliente, e.llamado_en, e.aviso_whatsapp], ['preparando', mesa.nombre, 'Ana', '', null]);
  const [, tv] = await s.llamar('GET', `/api/publico/retiro/${tokenBarra}`);
  assert.ok(tv.preparando.some(p => p.nombre === 'Ana' && p.lugar === mesa.nombre));
  assert.ok(tv.preparando.every(p => p.items === undefined), 'la TV no muestra qué pidió cada uno');
  // Con una sola computadora "Para retirar" es la cocina: muestra qué lleva cada pedido
  const [, panel] = await s.llamar('GET', '/api/retiro', undefined, s.tokenAdmin);
  assert.deepEqual(panel.preparando.find(p => p.id === ped.id).items.map(i => i.cantidad), [2]);
});

test('aviso por WhatsApp: el cliente escribe con su clave, Fadido le contesta al estar listo y al volver a llamarlo', async () => {
  await s.llamar('PUT', '/api/integraciones/config/whatsapp', {
    activa: true, phone_number_id: '111', access_token: 'EAAG-x', app_secret: APP_SECRET, verify_token: 'v', numero: '11 2390-0155'
  }, s.tokenAdmin);
  const [, r] = await publico('POST', '/pedido', { cliente: 'Caro', items: [{ producto_id: prod.id, cantidad: 1 }] });
  const [{ id }] = await s.q('SELECT id FROM pedidos WHERE codigo_cliente = ?', [r.codigo]);
  let [, e] = await cliente(r.codigo);
  assert.ok(e.aviso_whatsapp && e.aviso_whatsapp.link.startsWith('https://wa.me/5491123900155?text='), JSON.stringify(e.aviso_whatsapp));
  const mensaje = decodeURIComponent(e.aviso_whatsapp.link.split('text=')[1]);
  assert.equal(mensaje, `Avisame cuando esté listo mi pedido #${e.numero_corto} (clave ${r.codigo.slice(-4)})`);

  // Sin la clave correcta no se anota (no alcanza con adivinar el número)
  const otraClave = r.codigo.slice(-4) === 'ffff' ? '0000' : 'ffff';
  await escribirAlLocal('5491155550000', `Avisame cuando esté listo mi pedido #${e.numero_corto} (clave ${otraClave})`);
  await esperarEnvios(1);
  assert.match(textoUltimo(), /No encontramos ese pedido/);
  assert.equal((await s.q('SELECT telefono_aviso FROM pedidos WHERE id = ?', [id]))[0].telefono_aviso, '');

  await escribirAlLocal('5491112345678', mensaje);
  await esperarEnvios(2);
  assert.match(textoUltimo(), new RegExp(`te avisamos por acá cuando tu pedido #${e.numero_corto}`, 'i'));
  assert.equal(meta.envios[1].to, '5491112345678');
  [, e] = await cliente(r.codigo);
  assert.deepEqual(e.aviso_whatsapp, { anotado: true });
  assert.equal((await s.q('SELECT COUNT(*) n FROM whatsapp_entrantes'))[0].n, 2, 'los mensajes quedan registrados');

  // Llamar de nuevo antes de que esté listo no tiene sentido
  assert.equal((await s.llamar('POST', `/api/pedidos/${id}/llamar`, {}, s.tokenAdmin))[0], 400);

  // Cocina lo marca listo → WhatsApp (texto libre, sin plantilla)
  assert.equal((await s.llamar('PUT', `/api/cocina/${id}/listo`, {}, s.tokenAdmin))[0], 200);
  await esperarEnvios(3);
  assert.equal(meta.envios[2].type, 'text');
  assert.match(textoUltimo(), new RegExp(`#${e.numero_corto} está listo.*mostrador de NCASA`));
  [, e] = await cliente(r.codigo);
  assert.equal(e.etapa, 'listo');

  // No viene: la caja lo llama de nuevo (celular y TV ven llamado_en nuevo; WhatsApp otra vez)
  assert.equal((await s.llamar('POST', `/api/pedidos/${id}/llamar`, {}, s.tokenAdmin))[0], 200);
  await esperarEnvios(4);
  assert.match(textoUltimo(), /Te estamos esperando/);
  [, e] = await cliente(r.codigo);
  assert.ok(e.llamado_en, 'el celular ve que lo llamaron');
  const [, tv] = await s.llamar('GET', `/api/publico/retiro/${tokenBarra}`);
  assert.ok(tv.listos.some(p => p.nombre === 'Caro' && p.llamado_en && p.lugar === mesa.nombre));
  const [, panel] = await s.llamar('GET', '/api/retiro', undefined, s.tokenAdmin);
  assert.equal(panel.listos.find(p => p.id === id).whatsapp, true);

  // Entregado: ya no se puede llamar ni anotarse
  assert.equal((await s.llamar('POST', `/api/pedidos/${id}/retirado`, {}, s.tokenAdmin))[0], 200);
  assert.equal((await s.llamar('POST', `/api/pedidos/${id}/llamar`, {}, s.tokenAdmin))[0], 404);
  [, e] = await cliente(r.codigo);
  assert.equal(e.aviso_whatsapp, null);
});

test('si se anota cuando ya está listo, se le avisa en el momento', async () => {
  const [, r] = await publico('POST', '/pedido', { cliente: 'Dani', items: [{ producto_id: prod.id, cantidad: 1 }] });
  const [{ id }] = await s.q('SELECT id FROM pedidos WHERE codigo_cliente = ?', [r.codigo]);
  await s.llamar('PUT', `/api/cocina/${id}/listo`, {}, s.tokenAdmin);
  const [, e] = await cliente(r.codigo);
  const antes = meta.envios.length;
  await escribirAlLocal('5491199998888', decodeURIComponent(e.aviso_whatsapp.link.split('text=')[1]));
  await esperarEnvios(antes + 1);
  assert.match(textoUltimo(), /ya está listo/);
});
