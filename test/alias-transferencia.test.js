// Cobro por transferencia: el alias (o CBU/CVU) del local se carga en Configuración, se valida, y el cliente lo ve
// en el QR de la mesa; al avisar que transfirió, el mozo recibe "Paga por transferencia".
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciarServidor } = require('./helpers');

let s, mesa;
const publico = (metodo, ruta, body) => s.llamar(metodo, `/api/publico/mesa/${mesa.qr_token}${ruta}`, body);
before(async () => {
  s = await iniciarServidor();
  [mesa] = await s.q("SELECT id, qr_token FROM mesas WHERE estado = 'libre' ORDER BY id LIMIT 1");
});
after(() => s.cerrar());

const guardar = datos => s.llamar('PUT', '/api/config', datos, s.tokenAdmin);

test('sin alias cargado, la mesa no ofrece transferencia', async () => {
  const [, est] = await publico('GET', '');
  assert.equal(est.pago.transferencia, null);
});

test('alias: se valida y se guarda en minúsculas; CBU de 22 números también vale', async () => {
  assert.equal((await guardar({ alias_transferencia: 'abc' }))[0], 400, 'muy corto');
  assert.equal((await guardar({ alias_transferencia: 'con espacio raro!' }))[0], 400);
  assert.equal((await guardar({ alias_transferencia: '123' }))[0], 400);
  const [st] = await guardar({ alias_transferencia: ' Castillo.694 ', titular_transferencia: 'Castillo SRL' });
  assert.equal(st, 200);
  const [c] = await s.q('SELECT alias_transferencia, titular_transferencia FROM configuracion WHERE id = 1');
  assert.deepEqual([c.alias_transferencia, c.titular_transferencia], ['castillo.694', 'Castillo SRL']);
  assert.equal((await guardar({ alias_transferencia: '0000003100012345678901' }))[0], 200);
  assert.equal((await s.q('SELECT alias_transferencia FROM configuracion WHERE id = 1'))[0].alias_transferencia, '0000003100012345678901');
  // Vacío: se borra
  assert.equal((await guardar({ alias_transferencia: '' }))[0], 200);
  assert.equal((await s.q('SELECT alias_transferencia FROM configuracion WHERE id = 1'))[0].alias_transferencia, '');
  // Solo el administrador
  assert.equal((await s.llamar('PUT', '/api/config', { alias_transferencia: 'otro.alias' }, s.tokenVendedor))[0], 403);
});

test('el QR de la mesa muestra el alias y avisa al mozo que paga por transferencia', async () => {
  await guardar({ alias_transferencia: 'castillo.694', titular_transferencia: 'Castillo SRL' });
  const [, est] = await publico('GET', '');
  assert.deepEqual(est.pago.transferencia, { alias: 'castillo.694', titular: 'Castillo SRL' });
  const [st] = await publico('POST', '/llamar', { tipo: 'cuenta', forma: 'transferencia' });
  assert.equal(st, 201);
  const [sol] = await s.q("SELECT notas FROM solicitudes_mesa WHERE mesa_id = ? AND tipo = 'cuenta' ORDER BY id DESC LIMIT 1", [mesa.id]);
  assert.equal(sol.notas, 'Paga por transferencia');
});
