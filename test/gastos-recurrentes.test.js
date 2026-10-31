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
