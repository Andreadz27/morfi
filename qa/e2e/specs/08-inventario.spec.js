// Casos CP-INV: inventario sin cargar dos veces (docs/qa/CASOS-DE-PRUEBA.md)
'use strict';
const { test, expect } = require('../fixtures');

const nuevoInsumo = async (api, nombre) => {
  const { status, body } = await api.como('admin').post('/api/productos', { nombre, clase: 'insumo', unidad: 'g', precio_venta: 0 });
  expect(status).toBe(201);
  return body.id;
};
const producto = async (api, id) => (await api.como('admin').get('/api/productos')).body.find(p => p.id === id);

test.describe('Inventario', () => {
  test('CP-INV-01 · la compra de mercadería con artículos suma al stock y actualiza el costo', { tag: '@regresion' }, async ({ page, login, api }) => {
    const id = await nuevoInsumo(api, 'Harina QA');
    await login.ingresarComo('admin');
    await login.ir('contabilidad');
    await page.evaluate("Contabilidad.setTab('gastos')");
    await page.locator('#view-contabilidad button', { hasText: 'Cargar gasto' }).first().click();

    await page.locator('#gasCategoria').selectOption('mercaderia');
    await page.locator('#gasDescripcion').fill('Compra de harina');
    await page.locator('#gasTipo').selectOption('factura_b');
    await page.locator('#gasNeto').fill('12000');
    await page.locator('#gasArticulosGrupo button', { hasText: 'Agregar artículo' }).click();
    const fila = page.locator('#gasArticulos .cont-articulo').first();
    await fila.locator('select').first().selectOption(String(id));
    await fila.locator('input[placeholder="Cantidad"]').fill('3');
    await expect(fila.locator('select').nth(1)).toHaveValue('1000');   // en kg
    await fila.locator('input[placeholder="Importe $"]').fill('12000');
    await page.locator('#formGasto button[type=submit]').click();
    await expect(page.locator('.toast').last()).toContainText('se sumó al stock');

    const p = await producto(api, id);
    expect(p.tracking_stock).toBe(1);
    expect(p.stock_actual).toBe(3000);
    expect(p.costo).toBe(4);          // $12.000 / 3000 g
  });

  test('CP-INV-02 · el conteo deja el stock en lo contado y muestra la diferencia', { tag: '@regresion' }, async ({ page, login, api }) => {
    const id = await nuevoInsumo(api, 'Azúcar QA');
    expect((await api.como('admin').post('/api/stock/movimiento', { producto_id: id, tipo: 'entrada', cantidad: 1000, motivo: 'QA' })).status).toBe(200);
    // El movimiento solo vale con control de stock: se prende antes
    expect((await api.como('admin').put(`/api/productos/${id}`, { tracking_stock: 1 })).status).toBe(200);

    await login.ingresarComo('admin');
    await login.ir('stock');
    await page.locator('#view-stock button', { hasText: 'Contar inventario' }).click();
    const input = page.locator(`.conteo-input[data-id="${id}"]`);
    const sistema = Number(await input.getAttribute('data-sistema'));
    await input.fill(String(sistema - 200));
    await expect(page.locator(`#conteoDif${id}`)).toHaveText('-200');
    await page.locator('#conteoNotas').fill('Conteo QA');
    await page.locator('.modal button[type=submit]', { hasText: 'Guardar conteo' }).click();
    await expect(page.locator('.toast').last()).toContainText('Conteo guardado');

    expect((await producto(api, id)).stock_actual).toBe(sistema - 200);
    await expect(page.locator('#view-stock')).toContainText('Conteos de inventario');
    await expect(page.locator('#view-stock')).toContainText('Conteo QA');
  });
});
