// Caso CP-MOZ-01: el celular pierde el WiFi al mandar un pedido; queda guardado y llega una sola vez al volver
'use strict';
const { test, expect } = require('../fixtures');
const { PRODUCTOS } = require('../../datos');

test('CP-MOZ-01 · sin WiFi el pedido queda guardado en el celular y se envía solo al volver la conexión', { tag: '@regresion' }, async ({ page, login, pos, api }) => {
  const cliente = 'Sin WiFi ' + Date.now();
  await login.ingresarComo('cajero');
  await login.ir('pos');
  await pos.agregar(PRODUCTOS.ensalada.nombre);

  // Se corta la conexión con la PC del local justo al mandar el pedido
  await page.route('**/api/pedidos', r => r.abort('internetdisconnected'));
  await page.locator('#view-pos .pos-checkout-btn').click();
  await page.locator('#checkoutTipo').selectOption('takeaway');
  await page.locator('#checkoutPagaDespues').click();
  await page.locator('#checkoutCliente').fill(cliente);
  await page.locator('button[onclick="POS.confirmCheckout()"]').click();
  await expect(page.locator('#toastContainer .toast', { hasText: 'quedó guardado' })).toBeVisible();
  await expect(page.locator('#colaPedidos')).toContainText('1 pedido guardado');
  const antes = (await api.como('cajero').get('/api/pedidos')).body.filter(p => p.cliente === cliente);
  expect(antes, 'todavía no llegó').toHaveLength(0);

  // Vuelve el WiFi: se envía solo (aunque se toque "Reintentar" a la vez) y llega una sola vez
  await page.unroute('**/api/pedidos');
  await page.locator('#colaPedidos button', { hasText: 'Reintentar' }).click();
  await expect(page.locator('#colaPedidos')).toHaveCount(0);
  await expect(page.locator('#toastContainer .toast.success', { hasText: 'enviado' })).toBeVisible();
  await page.evaluate('ColaPedidos.enviarPendientes()');
  const despues = (await api.como('cajero').get('/api/pedidos')).body.filter(p => p.cliente === cliente);
  expect(despues).toHaveLength(1);
  expect(despues[0]).toMatchObject({ tipo: 'takeaway', total: PRODUCTOS.ensalada.precio });
});
