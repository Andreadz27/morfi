// Facturas de compra adjuntas a los gastos y su lectura con una API de Claude simulada (GM_ANTHROPIC_URL).
// Lo que se prueba no depende del modelo: el formato se decide por los bytes, los archivos quedan con su gasto,
// y lo que devuelve la lectura pasa por reglas fijas (el CUIT del local nunca es el proveedor, sin IVA salvo factura A).
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { iniciarServidor } = require('./helpers');

const claude = { pedidos: [], guion: [] };
const json = (res, obj, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const servidorClaude = http.createServer((req, res) => {
  let cuerpo = '';
  req.on('data', d => { cuerpo += d; });
  req.on('end', () => {
    const body = JSON.parse(cuerpo);
    claude.pedidos.push({ url: req.url, body });
    const paso = claude.guion.shift();
    if (!paso) return json(res, { type: 'error', error: { type: 'api_error', message: 'sin guion' } }, 500);
    json(res, { id: 'msg_' + claude.pedidos.length, type: 'message', role: 'assistant', model: body.model, stop_sequence: null,
      usage: { input_tokens: 1500, output_tokens: 120 }, ...paso });
  });
});
const lectura = datos => ({ content: [{ type: 'thinking', thinking: '', signature: 'firma' }, { type: 'text', text: JSON.stringify(datos) }], stop_reason: 'end_turn' });

// Archivos mínimos con la firma de cada formato
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 7)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(60, 1)]);
const CUIT_LOCAL = '30711111111';

let s, hoy, prov;
const subir = (datos, { nombre = 'factura.jpg', gastoId, token = s.tokenAdmin, tipo = 'image/jpeg' } = {}) =>
  fetch(`${s.base}/api/contabilidad/adjuntos${gastoId ? '?gasto_id=' + gastoId : ''}`, {
    method: 'POST', body: datos,
    headers: { 'Content-Type': tipo, 'X-Nombre-Archivo': encodeURIComponent(nombre), ...(token ? { Authorization: 'Bearer ' + token } : {}) }
  }).then(async r => [r.status, await r.json()]);
const gasto = body => s.llamar('POST', '/api/contabilidad/gastos',
  { fecha: hoy, categoria: 'mercaderia', descripcion: 'Verdura', tipo_comprobante: 'factura_b', neto: 1000, ...body }, s.tokenAdmin);
const leer = id => s.llamar('POST', `/api/contabilidad/adjuntos/${id}/leer`, undefined, s.tokenAdmin);

before(async () => {
  await new Promise(ok => servidorClaude.listen(0, '127.0.0.1', ok));
  s = await iniciarServidor({ GM_ANTHROPIC_URL: `http://127.0.0.1:${servidorClaude.address().port}` });
  hoy = (await s.llamar('GET', '/api/contabilidad/opciones', undefined, s.tokenAdmin))[1].hoy;
  await s.q("INSERT INTO proveedores (nombre, cuit) VALUES ('Verdulería Don Pepe', '20-12345678-6')");
  [prov] = await s.q("SELECT id FROM proveedores WHERE nombre = 'Verdulería Don Pepe'");
  assert.equal((await s.llamar('PUT', '/api/integraciones/config/afip', { cuit: '30-71111111-1' }, s.tokenAdmin))[0], 200);
});
after(async () => {
  await s.cerrar();
  await new Promise(ok => servidorClaude.close(ok));
});
beforeEach(() => { claude.pedidos = []; claude.guion = []; });

test('subir y ver una factura: solo contabilidad, y vuelve tal cual', async () => {
  assert.equal((await subir(JPG, { token: s.tokenVendedor }))[0], 403);
  assert.equal((await subir(JPG, { token: null }))[0], 401);
  const [st, a] = await subir(JPG, { nombre: 'Factura Don Pepe.jpg' });
  assert.equal(st, 201);
  assert.deepEqual({ tipo: a.tipo, tamano: a.tamano, nombre: a.nombre }, { tipo: 'image/jpeg', tamano: JPG.length, nombre: 'Factura Don Pepe.jpg' });

  const r = await fetch(`${s.base}/api/contabilidad/adjuntos/${a.id}`, { headers: { Authorization: 'Bearer ' + s.tokenAdmin } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/jpeg');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(Buffer.from(await r.arrayBuffer()).equals(JPG));
  const otro = await fetch(`${s.base}/api/contabilidad/adjuntos/${a.id}`, { headers: { Authorization: 'Bearer ' + s.tokenVendedor } });
  assert.equal(otro.status, 403);
});

test('el formato sale de los bytes, no de lo que dice el navegador; tope de 4 MB', async () => {
  const html = Buffer.from('<html><script>alert(1)</script></html>');
  const [st, r] = await subir(html, { nombre: 'factura.jpg', tipo: 'image/jpeg' });
  assert.equal(st, 400);
  assert.match(r.error, /Formato no admitido/);
  assert.equal((await subir(Buffer.alloc(0)))[0], 400);
  assert.equal((await subir(Buffer.concat([JPG, Buffer.alloc(4 * 1024 * 1024)])))[0], 413);
  const [stPdf, pdf] = await subir(PDF, { nombre: 'factura.pdf', tipo: 'application/pdf' });
  assert.equal(stPdf, 201);
  assert.equal(pdf.tipo, 'application/pdf');
});

test('la factura subida desde el formulario queda con el gasto al guardarlo, y no se puede usar en dos', async () => {
  const [, a] = await subir(JPG);
  const [st, g] = await gasto({ adjuntos: [a.id] });
  assert.equal(st, 201);
  const [, lista] = await s.llamar('GET', `/api/contabilidad/gastos?desde=${hoy}&hasta=${hoy}`, undefined, s.tokenAdmin);
  const guardado = lista.find(x => x.id === g.id);
  assert.deepEqual(guardado.adjuntos.map(x => x.id), [a.id]);
  assert.equal(guardado.adjuntos[0].datos, undefined, 'la lista no trae los archivos');

  const antes = (await s.q('SELECT COUNT(*) c FROM gastos'))[0].c;
  const [st2, r2] = await gasto({ adjuntos: [a.id] });
  assert.equal(st2, 400);
  assert.match(r2.error, /ya no está/);
  assert.equal((await s.q('SELECT COUNT(*) c FROM gastos'))[0].c, antes, 'el gasto rechazado no queda guardado');

  // Al editar se suman las nuevas
  const [, b] = await subir(PDF, { tipo: 'application/pdf' });
  assert.equal((await s.llamar('PUT', `/api/contabilidad/gastos/${g.id}`, { adjuntos: [b.id] }, s.tokenAdmin))[0], 200);
  assert.equal((await s.q('SELECT COUNT(*) c FROM gasto_adjuntos WHERE gasto_id = ?', [g.id]))[0].c, 2);
});

test('adjuntar a un gasto guardado: hasta 6, no a un anulado, y quitar deja registro', async () => {
  const [, g] = await gasto({});
  for (let i = 0; i < 6; i++) assert.equal((await subir(JPG, { gastoId: g.id }))[0], 201);
  const [st, r] = await subir(JPG, { gastoId: g.id });
  assert.equal(st, 400);
  assert.match(r.error, /Hasta 6/);
  assert.equal((await subir(JPG, { gastoId: 999999 }))[0], 404);

  const [{ id }] = await s.q('SELECT id FROM gasto_adjuntos WHERE gasto_id = ? LIMIT 1', [g.id]);
  assert.equal((await s.llamar('DELETE', `/api/contabilidad/adjuntos/${id}`, undefined, s.tokenAdmin))[0], 200);
  assert.equal((await s.q("SELECT COUNT(*) c FROM auditoria WHERE accion = 'quitar_factura'"))[0].c, 1);

  assert.equal((await s.llamar('DELETE', `/api/contabilidad/gastos/${g.id}`, undefined, s.tokenAdmin))[0], 200);
  assert.equal((await subir(JPG, { gastoId: g.id }))[0], 400, 'a un gasto anulado no se le adjunta');
  const [{ id: otra }] = await s.q('SELECT id FROM gasto_adjuntos WHERE gasto_id = ? LIMIT 1', [g.id]);
  assert.equal((await s.llamar('DELETE', `/api/contabilidad/adjuntos/${otra}`, undefined, s.tokenAdmin))[0], 400, 'la factura de un anulado queda');
});

test('las facturas sueltas (formulario cancelado) se borran a los 2 días', async () => {
  const [, vieja] = await subir(JPG);
  await s.q("UPDATE gasto_adjuntos SET creado_en = datetime('now', '-3 days') WHERE id = ?", [vieja.id]);
  const [, nueva] = await subir(JPG);
  const ids = (await s.q('SELECT id FROM gasto_adjuntos WHERE id IN (?, ?)', [vieja.id, nueva.id])).map(x => x.id);
  assert.deepEqual(ids, [nueva.id]);
});

test('leer sin la clave de Claude: avisa dónde cargarla y no llama a nadie', async () => {
  const [, a] = await subir(JPG);
  const [st, r] = await leer(a.id);
  assert.equal(st, 400);
  assert.match(r.error, /Integraciones/);
  assert.equal(claude.pedidos.length, 0);
  assert.equal((await s.llamar('GET', '/api/contabilidad/opciones', undefined, s.tokenAdmin))[1].lectura_facturas, false);
});

test('lectura de una factura A: modelo, esquema, imagen y proveedor encontrado por CUIT', async () => {
  assert.equal((await s.llamar('PUT', '/api/integraciones/config/asistente', { activa: false, api_key: 'sk-ant-prueba-1234' }, s.tokenAdmin))[0], 200);
  assert.equal((await s.llamar('GET', '/api/contabilidad/opciones', undefined, s.tokenAdmin))[1].lectura_facturas, true);
  const [, a] = await subir(JPG);
  claude.guion.push(lectura({
    es_comprobante: true, fecha: hoy, proveedor_nombre: 'DON PEPE S.R.L.', proveedor_cuit: '20-12345678-6',
    tipo_comprobante: 'factura_a', numero_comprobante: '00003-00001234', neto: 10000, iva: 2100, otros_impuestos: 300,
    total: 12400, descripcion: 'Verdura y fruta', categoria: 'mercaderia'
  }));
  const [st, d] = await leer(a.id);
  assert.equal(st, 200);
  assert.deepEqual({ ...d, avisos: undefined }, {
    fecha: hoy, tipo_comprobante: 'factura_a', numero_comprobante: '00003-00001234', neto: 10000, iva: 2100,
    otros_impuestos: 300, total: 12400, descripcion: 'Verdura y fruta', categoria: 'mercaderia',
    proveedor_id: prov.id, proveedor_nuevo: null, avisos: undefined
  });
  assert.deepEqual(d.avisos, []);

  const { body } = claude.pedidos[0];
  assert.equal(body.model, 'claude-opus-5-5');
  assert.equal(body.fallbacks, 'default');
  assert.equal(body.output_config.format.type, 'json_schema');
  assert.equal(body.output_config.format.schema.additionalProperties, false);
  const [imagen, texto] = body.messages[0].content;
  assert.deepEqual({ type: imagen.type, media: imagen.source.media_type }, { type: 'image', media: 'image/jpeg' });
  assert.ok(Buffer.from(imagen.source.data, 'base64').equals(JPG));
  assert.match(texto.text, /mercaderia: Mercadería e insumos/);
  assert.equal((await s.q('SELECT COUNT(*) c FROM gastos WHERE descripcion = ?', ['Verdura y fruta']))[0].c, 0, 'leer no guarda nada');
});

test('lectura: el CUIT del local nunca es el proveedor, sin IVA si no es factura A, fecha futura descartada', async () => {
  const [, a] = await subir(PDF, { tipo: 'application/pdf', nombre: 'carniceria.pdf' });
  claude.guion.push(lectura({
    es_comprobante: true, fecha: '2999-01-01', proveedor_nombre: 'Carnicería El Toro', proveedor_cuit: CUIT_LOCAL,
    tipo_comprobante: 'factura_b', numero_comprobante: '0001-00000077', neto: 9999, iva: 1500, otros_impuestos: 0,
    total: 15000, descripcion: 'Carne vacuna', categoria: 'inventada'
  }));
  const [st, d] = await leer(a.id);
  assert.equal(st, 200);
  assert.equal(claude.pedidos[0].body.messages[0].content[0].type, 'document');
  assert.equal(d.fecha, '');
  assert.ok(d.avisos.some(x => /posterior a hoy/.test(x)));
  assert.deepEqual({ neto: d.neto, iva: d.iva, total: d.total }, { neto: 15000, iva: 0, total: 15000 });
  assert.equal(d.categoria, 'mercaderia');
  assert.equal(d.proveedor_id, null);
  assert.deepEqual(d.proveedor_nuevo, { nombre: 'Carnicería El Toro', cuit: '' });

  // Proveedor nuevo con CUIT válido: se sugiere con guiones; importes que no cierran: aviso
  claude.guion.push(lectura({
    es_comprobante: true, fecha: hoy, proveedor_nombre: 'Distribuidora Sur', proveedor_cuit: '27123456780',
    tipo_comprobante: 'factura_a', numero_comprobante: '', neto: 1000, iva: 210, otros_impuestos: 0, total: 5000,
    descripcion: 'Descartables', categoria: 'mercaderia'
  }));
  const [, d2] = await leer(a.id);
  assert.deepEqual(d2.proveedor_nuevo, { nombre: 'Distribuidora Sur', cuit: '27-12345678-0' });
  assert.ok(d2.avisos.some(x => /no suman/.test(x)));
});

test('lectura: lo que no es comprobante o lo que el modelo rechaza no completa nada', async () => {
  const [, a] = await subir(JPG);
  claude.guion.push(lectura({
    es_comprobante: false, fecha: '', proveedor_nombre: '', proveedor_cuit: '', tipo_comprobante: 'sin_comprobante',
    numero_comprobante: '', neto: 0, iva: 0, otros_impuestos: 0, total: 0, descripcion: '', categoria: 'otros'
  }));
  let [st, r] = await leer(a.id);
  assert.equal(st, 422);
  assert.match(r.error, /No parece un comprobante/);

  claude.guion.push({ content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: null, explanation: '' } });
  [st, r] = await leer(a.id);
  assert.equal(st, 422);

  claude.guion.push({ content: [{ type: 'text', text: 'no es json' }], stop_reason: 'end_turn' });
  assert.equal((await leer(a.id))[0], 422);
  assert.equal((await leer(999999))[0], 404);
});
