// Caso CP-COB-01: cuenta dividida por plato en la mesa (cada uno paga lo suyo)
'use strict';
const { test, expect } = require('../fixtures');
const { PRODUCTOS } = require('../../datos');

test('CP-COB-01 · cuenta por plato: cada persona paga lo suyo y el último cierra la mesa', { tag: '@regresion' }, async ({ page, login, api }) => {
  const cajero = api.como('cajero');
  const caja = await cajero.get('/api/caja/estado');
  if (caja.body.estado !== 'abierta') await cajero.post('/api/caja/abrir', { monto_inicial: 0 });
  const mesa = (await cajero.get('/api/mesas')).body.find(m => m.estado === 'libre');
  const { status, body: pedido } = await cajero.post('/api/pedidos', { tipo: 'salon', mesa_id: mesa.id,
    items: [{ producto_id: PRODUCTOS.ensalada.id, cantidad: 2 }] });
  expect(status).toBe(201);

  await login.ingresarComo('cajero');
  await page.evaluate(`Cobro.abrir(${pedido.id})`);
  await page.getByRole('button', { name: 'Por plato' }).click();
  const masEnsalada = page.getByRole('button', { name: `Uno más de ${PRODUCTOS.ensalada.nombre}` });

  // Primera persona: una ensalada
  await masEnsalada.click();
  await expect(page.locator('#cobroBtn')).toContainText('4.500');
  await page.locator('#cobroBtn').click();
  await expect(page.locator('.cobro-ok')).toContainText('Falta cobrar');

  // Segunda persona: solo queda una ensalada
  await page.getByRole('button', { name: /Cobrar al siguiente/ }).click();
  await expect(page.locator('.cobro-platos')).toContainText('faltan 1');
  await masEnsalada.click();
  await expect(masEnsalada, 'no se puede elegir más de lo que falta').toBeDisabled();
  await page.locator('#cobroBtn').click();
  await expect(page.locator('.cobro-ok')).toContainText('Cuenta cerrada');

  const { body: final } = await cajero.get(`/api/pedidos/${pedido.id}`);
  expect(final).toMatchObject({ estado: 'pagado' });
  expect(final.pagos.map(p => p.monto)).toEqual([PRODUCTOS.ensalada.precio, PRODUCTOS.ensalada.precio]);
});
