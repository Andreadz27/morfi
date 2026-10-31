// Pagos que se repiten (el ayudante de los sábados): la administradora elige los días y el monto; cada día elegido
// queda como gasto pendiente. Cambiar los días acomoda los próximos sin tocar lo pagado.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciarServidor } = require('./helpers');

let s;
before(async () => { s = await iniciarServidor(); });
after(() => s.cerrar());

const diaSemana = f => new Date(f + 'T12:00:00Z').getUTCDay();
const gastosDe = id => s.q('SELECT fecha, total, estado, anulado, descripcion FROM gastos WHERE recurrente_id = ? ORDER BY fecha', [id]);

test('ayudante los sábados: se cargan solos 4 sábados; sumar el domingo y cambiar el monto acomoda los próximos', async () => {
  assert.equal((await s.llamar('POST', '/api/contabilidad/recurrentes', { descripcion: 'Ayudante', monto: 40000, dias: [6] }, s.tokenVendedor))[0], 403);
  assert.equal((await s.llamar('POST', '/api/contabilidad/recurrentes', { descripcion: 'Ayudante', monto: 40000, dias: [] , activo: true, }, s.tokenAdmin))[0], 201,
    'sin días se guarda (queda sin cargar nada)');
  const [st, r] = await s.llamar('POST', '/api/contabilidad/recurrentes', { descripcion: 'Ayudante', monto: 40000, dias: [6] }, s.tokenAdmin);
  assert.equal(st, 201, JSON.stringify(r));
  let g = await gastosDe(r.id);
  assert.equal(g.length, 4, '4 sábados');
  assert.ok(g.every(x => diaSemana(x.fecha) === 6 && x.total === 40000 && x.estado === 'pendiente' && /Ayudante sábado/.test(x.descripcion)));

  // Uno ya pagado (el más lejano, para que caiga después de hoy) no se toca
  const ultimo = g[g.length - 1];
  await s.q("UPDATE gastos SET estado = 'pagado', fecha_pago = fecha WHERE recurrente_id = ? AND fecha = ?", [r.id, ultimo.fecha]);

  // Ahora viene sábados y domingos, por 45.000
  const [st2, r2] = await s.llamar('PUT', `/api/contabilidad/recurrentes/${r.id}`, { descripcion: 'Ayudante', monto: 45000, dias: [6, 0] }, s.tokenAdmin);
  assert.equal(st2, 200, JSON.stringify(r2));
  g = (await gastosDe(r.id)).filter(x => !x.anulado);
  assert.ok(g.some(x => diaSemana(x.fecha) === 0), 'aparecen los domingos');
  assert.equal(g.find(x => x.fecha === ultimo.fecha).total, 40000, 'el pagado sigue igual');
  const hoy = (await s.llamar('GET', '/api/contabilidad/opciones', undefined, s.tokenAdmin))[1].hoy;
  assert.ok(g.filter(x => x.fecha > hoy && x.estado === 'pendiente').every(x => x.total === 45000), 'los pendientes que vienen toman el monto nuevo');

  // Vuelve a solo sábados: los domingos pendientes se quitan
  await s.llamar('PUT', `/api/contabilidad/recurrentes/${r.id}`, { descripcion: 'Ayudante', monto: 45000, dias: [6] }, s.tokenAdmin);
  g = (await gastosDe(r.id)).filter(x => !x.anulado && x.fecha > hoy);
  assert.ok(g.every(x => diaSemana(x.fecha) === 6), 'quedan solo sábados');

  const [, lista] = await s.llamar('GET', '/api/contabilidad/recurrentes', undefined, s.tokenAdmin);
  const a = lista.find(x => x.id === r.id);
  assert.deepEqual(a.dias, [6]);
  assert.ok(a.proximos.length >= 1);
});

test('datos inválidos se rechazan', async () => {
  assert.equal((await s.llamar('POST', '/api/contabilidad/recurrentes', { descripcion: '', monto: 1000, dias: [1] }, s.tokenAdmin))[0], 400);
  assert.equal((await s.llamar('POST', '/api/contabilidad/recurrentes', { descripcion: 'X', monto: 0, dias: [1] }, s.tokenAdmin))[0], 400);
});

test('día extra (no fijo): se suma en ese día con el monto de siempre o uno distinto; editar los sábados no lo toca', async () => {
  const [, r] = await s.llamar('POST', '/api/contabilidad/recurrentes', { descripcion: 'Ayudante extra', monto: 40000, dias: [6] }, s.tokenAdmin);
  const hoy = (await s.llamar('GET', '/api/contabilidad/opciones', undefined, s.tokenAdmin))[1].hoy;
  // El próximo martes después de mañana
  let martes = hoy;
  do { martes = new Date(Date.parse(martes + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10); } while (diaSemana(martes) !== 2 || martes <= hoy);

  assert.equal((await s.llamar('POST', `/api/contabilidad/recurrentes/${r.id}/dia`, { fecha: martes }, s.tokenVendedor))[0], 403);
  let [st, d] = await s.llamar('POST', `/api/contabilidad/recurrentes/${r.id}/dia`, { fecha: martes }, s.tokenAdmin);
  assert.equal(st, 201, JSON.stringify(d));
  assert.equal(d.monto, 40000, 'por defecto, el monto de siempre');
  assert.match(d.descripcion, /martes \(día extra\)/);
  assert.equal((await s.llamar('POST', `/api/contabilidad/recurrentes/${r.id}/dia`, { fecha: martes }, s.tokenAdmin))[0], 409, 'no se carga dos veces');

  // Hoy, con otro monto
  [st, d] = await s.llamar('POST', `/api/contabilidad/recurrentes/${r.id}/dia`, { fecha: hoy, monto: 25000 }, s.tokenAdmin);
  if (diaSemana(hoy) === 6) assert.equal(st, 409, 'hoy sábado ya estaba');
  else { assert.equal(st, 201, JSON.stringify(d)); assert.equal(d.monto, 25000); }

  // Editar los días fijos (sábado + domingo) no anula el martes extra
  await s.llamar('PUT', `/api/contabilidad/recurrentes/${r.id}`, { descripcion: 'Ayudante extra', monto: 40000, dias: [6, 0] }, s.tokenAdmin);
  await s.llamar('PUT', `/api/contabilidad/recurrentes/${r.id}`, { descripcion: 'Ayudante extra', monto: 40000, dias: [6] }, s.tokenAdmin);
  const [extra] = await s.q('SELECT anulado, total FROM gastos WHERE recurrente_id = ? AND fecha = ?', [r.id, martes]);
  assert.deepEqual(extra, { anulado: 0, total: 40000 });
  assert.equal((await s.q('SELECT COUNT(*) n FROM gastos WHERE recurrente_id = ? AND anulado = 0 AND fecha > ?', [r.id, hoy]))
    .map(x => x.n)[0] >= 4, true);
});

test('un sábado anulado a mano (no vino) no vuelve al editar el monto', async () => {
  const [, r] = await s.llamar('POST', '/api/contabilidad/recurrentes', { descripcion: 'Ayudante pausa', monto: 30000, dias: [6] }, s.tokenAdmin);
  const hoy = (await s.llamar('GET', '/api/contabilidad/opciones', undefined, s.tokenAdmin))[1].hoy;
  const [sab] = await s.q('SELECT id FROM gastos WHERE recurrente_id = ? AND fecha > ? ORDER BY fecha LIMIT 1', [r.id, hoy]);
  assert.equal((await s.llamar('DELETE', `/api/contabilidad/gastos/${sab.id}`, undefined, s.tokenAdmin))[0], 200);
  await s.llamar('PUT', `/api/contabilidad/recurrentes/${r.id}`, { descripcion: 'Ayudante pausa', monto: 32000, dias: [6] }, s.tokenAdmin);
  assert.equal((await s.q('SELECT anulado FROM gastos WHERE id = ?', [sab.id]))[0].anulado, 1);
  // Pausar y reactivar sí lo recupera
  await s.llamar('PUT', `/api/contabilidad/recurrentes/${r.id}`, { descripcion: 'Ayudante pausa', monto: 32000, dias: [6], activo: false }, s.tokenAdmin);
  await s.llamar('PUT', `/api/contabilidad/recurrentes/${r.id}`, { descripcion: 'Ayudante pausa', monto: 32000, dias: [6], activo: true }, s.tokenAdmin);
  assert.equal((await s.q("SELECT COUNT(*) n FROM gastos WHERE recurrente_id = ? AND anulado = 0 AND fecha > ?", [r.id, hoy]))[0].n >= 3, true);
});
