// Cierre del día: resumen de todo lo del día, cierre a mano y automático a la hora configurada.
// Si nadie contó el efectivo, la caja se cierra "pendiente de arqueo" (sin inventar lo contado) y el
// encargado carga después lo que había.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciarServidor } = require('./helpers');

let s, prod, cierre;
before(async () => {
  s = await iniciarServidor();
  [prod] = await s.q('SELECT id, precio_venta FROM productos WHERE activo = 1 AND precio_venta > 0 ORDER BY id LIMIT 1');
  // El servicio se carga en este proceso contra la misma base, para simular la hora del cierre automático
  process.env.GM_DATA_DIR = s.dataDir;
  cierre = require('../src/servicios/cierre-dia');
});
after(async () => {
  // Las conexiones de este proceso a la base de prueba (si no, Windows no deja borrarla)
  const { db, dbTx } = require('../src/db');
  await Promise.all([db, dbTx].map(c => new Promise(r => c.close(() => r()))));
  await s.cerrar();
});

const vender = async (cantidad, metodo, propina = 0) => {
  const [, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'mostrador', items: [{ producto_id: prod.id, cantidad }], propina }, s.tokenAdmin);
  const [st] = await s.llamar('POST', `/api/pedidos/${p.id}/cobro`, { pagos: [{ metodo, monto: p.total }] }, s.tokenAdmin);
  assert.equal(st, 200);
  return p;
};

test('el resumen del día junta ventas, propinas, gastos, caja y pendientes', async () => {
  assert.equal((await s.llamar('POST', '/api/caja/abrir', { monto_inicial: 10000 }, s.tokenAdmin))[0], 201);
  await vender(2, 'efectivo', 500);
  await vender(1, 'tarjeta');
  const [, abierto] = await s.llamar('POST', '/api/pedidos', { tipo: 'mostrador', items: [{ producto_id: prod.id, cantidad: 1 }] }, s.tokenAdmin);
  const [stG] = await s.llamar('POST', '/api/contabilidad/gastos', { fecha: cierre.ahoraLocal().fecha, categoria: 'mercaderia',
    descripcion: 'Verdulería', neto: 3000, tipo_comprobante: 'sin_comprobante' }, s.tokenAdmin);
  assert.ok([200, 201].includes(stG), 'gasto cargado');
  assert.equal((await s.llamar('POST', '/api/caja/movimiento', { tipo: 'egreso', monto: 700, concepto: 'Hielo' }, s.tokenAdmin))[0], 201);

  const [st, r] = await s.llamar('GET', '/api/cierre/hoy', undefined, s.tokenAdmin);
  assert.equal(st, 200);
  assert.equal(r.ventas.tickets, 2);
  assert.equal(r.ventas.total, prod.precio_venta * 3 + 500);
  assert.deepEqual(r.ventas.por_metodo.map(m => m.metodo).sort(), ['efectivo', 'tarjeta']);
  assert.equal(r.propinas.total, 500);
  assert.equal(r.gastos.total, 3000);
  assert.equal(r.cajas.length, 1);
  assert.equal(r.cajas[0].estado, 'abierta');
  assert.equal(r.cajas[0].efectivo_esperado, 10000 + prod.precio_venta * 2 + 500 - 700);
  // Todo lo de la caja: el desglose del esperado, cada movimiento y lo cobrado por cada medio de pago
  assert.equal(r.cajas[0].ventas_efectivo, prod.precio_venta * 2 + 500);
  assert.equal(r.cajas[0].egresos, 700);
  assert.deepEqual(r.cajas[0].movimientos.map(m => [m.tipo, m.concepto, m.monto]), [['egreso', 'Hielo', 700]]);
  assert.ok(r.cajas[0].movimientos[0].usuario, 'quién lo hizo');
  assert.deepEqual(r.cajas[0].por_metodo.map(m => m.metodo).sort(), ['efectivo', 'tarjeta']);
  // Cada cobro del día, con su pedido y su medio de pago
  assert.deepEqual(r.cobros.map(c => c.metodo).sort(), ['efectivo', 'tarjeta']);
  assert.equal(r.cobros.reduce((t, c) => t + c.monto, 0), r.ventas.total);
  assert.ok(r.cobros.every(c => c.numero_pedido && c.fecha && c.tipo === 'mostrador'));
  assert.ok(r.pendientes.pedidos_abiertos.some(p => p.numero_pedido === abierto.numero_pedido));
  assert.ok(r.ventas.mas_vendidos.length >= 1);
  // Un cajero no ve el resumen del día
  assert.equal((await s.llamar('GET', '/api/cierre/hoy', undefined, s.tokenVendedor))[0], 403);
});

test('cerrar el día con la caja abierta la cierra "falta contar"; el encargado carga lo contado después', async () => {
  const [st, r] = await s.llamar('POST', '/api/cierres', {}, s.tokenAdmin);
  assert.equal(st, 201);
  assert.ok(r.caja_cerrada);
  const [caja] = await s.q('SELECT * FROM caja WHERE id = ?', [r.caja_cerrada]);
  assert.equal(caja.estado, 'cerrada');
  assert.equal(caja.pendiente_arqueo, 1);
  assert.equal(caja.monto_final_real, null, 'no se inventa lo contado');
  assert.equal(caja.diferencia, null);
  const [, lista] = await s.llamar('GET', '/api/cierres', undefined, s.tokenAdmin);
  assert.equal(lista[0].fecha, r.fecha);
  assert.equal(lista[0].falta_contar, true);

  // El encargado contó $500 menos de lo esperado
  const [stA, a] = await s.llamar('POST', `/api/caja/${caja.id}/arqueo`, { monto_final_real: caja.monto_esperado - 500 }, s.tokenAdmin);
  assert.equal(stA, 200);
  assert.equal(a.diferencia, -500);
  const [despues] = await s.q('SELECT pendiente_arqueo, monto_final_real, arqueo_por FROM caja WHERE id = ?', [caja.id]);
  assert.equal(despues.pendiente_arqueo, 0);
  assert.equal(despues.arqueo_por !== null, true);
  const [, guardado] = await s.llamar('GET', `/api/cierres/${r.fecha}`, undefined, s.tokenAdmin);
  assert.equal(guardado.resumen.cajas[0].diferencia, -500, 'el resumen del día se actualiza con el arqueo');
  assert.deepEqual(guardado.resumen.pendientes.cajas_sin_contar, []);
  // No se puede cargar dos veces ni con un monto inválido
  assert.equal((await s.llamar('POST', `/api/caja/${caja.id}/arqueo`, { monto_final_real: 1 }, s.tokenAdmin))[0], 400);
  assert.equal((await s.llamar('POST', `/api/caja/${caja.id}/arqueo`, { monto_final_real: -1 }, s.tokenAdmin))[0], 400);
});

test('el cierre normal de caja (con lo contado) sigue igual', async () => {
  await s.llamar('POST', '/api/caja/abrir', { monto_inicial: 2000 }, s.tokenAdmin);
  const [, estado] = await s.llamar('GET', '/api/caja/estado', undefined, s.tokenAdmin);
  const [st, r] = await s.llamar('POST', '/api/caja/cerrar', { monto_final_real: estado.resumen.efectivo_esperado }, s.tokenAdmin);
  assert.equal(st, 200);
  assert.equal(r.diferencia, 0);
  const [c] = await s.q("SELECT pendiente_arqueo FROM caja ORDER BY id DESC LIMIT 1");
  assert.equal(c.pendiente_arqueo, 0);
});

test('automático: avisa 15 minutos antes y cierra a la hora, una sola vez y solo los días que abre', async () => {
  const hoy = cierre.ahoraLocal();
  await s.q('DELETE FROM cierres_dia');
  await s.llamar('POST', '/api/caja/abrir', { monto_inicial: 1000 }, s.tokenAdmin);
  // Hora del cierre: 22:00 locales. Se arma un instante a las 21:50 y otro a las 22:01 del día de hoy
  const enHora = hhmm => {
    for (let h = 0; h < 48; h++) {
      const t = new Date(Date.now() + (h - 24) * 3600000);
      const l = cierre.ahoraLocal(t);
      if (l.fecha === hoy.fecha) {
        const [hh, mm] = hhmm.split(':').map(Number);
        return new Date(t.getTime() + ((hh - Number(l.hora.slice(0, 2))) * 60 + (mm - Number(l.hora.slice(3)))) * 60000);
      }
    }
  };
  // Apagado: no hace nada
  assert.equal(await cierre.revisarCierre(enHora('22:01')), null);
  assert.equal((await s.llamar('PUT', '/api/config', { cierre_auto_activo: 1, cierre_hora: '22:00', cierre_dias: [0, 1, 2, 3, 4, 5, 6] }, s.tokenAdmin))[0], 200);
  assert.equal(await cierre.revisarCierre(enHora('21:30')), null, 'temprano: nada');
  assert.equal(await cierre.revisarCierre(enHora('21:50')), 'aviso');
  assert.equal(await cierre.revisarCierre(enHora('21:51')), null, 'el aviso sale una vez');
  assert.equal(await cierre.revisarCierre(enHora('22:01')), 'cerrado');
  assert.equal(await cierre.revisarCierre(enHora('22:02')), null, 'una sola vez por día');
  const [c] = await s.q("SELECT automatico FROM cierres_dia WHERE fecha = ?", [hoy.fecha]);
  assert.equal(c.automatico, 1);
  assert.equal((await s.q("SELECT COUNT(*) AS n FROM caja WHERE estado = 'abierta'"))[0].n, 0);
  // Un día que no abre: no cierra
  await s.q('DELETE FROM cierres_dia');
  const otros = [0, 1, 2, 3, 4, 5, 6].filter(d => d !== hoy.dia);
  await s.llamar('PUT', '/api/config', { cierre_dias: otros }, s.tokenAdmin);
  assert.equal(await cierre.revisarCierre(enHora('22:30')), null);
});

test('la configuración del cierre se valida', async () => {
  const put = b => s.llamar('PUT', '/api/config', b, s.tokenAdmin).then(r => r[0]);
  assert.equal(await put({ cierre_hora: '25:00' }), 400);
  assert.equal(await put({ cierre_hora: '22' }), 400);
  assert.equal(await put({ cierre_dias: [7] }), 400);
  assert.equal(await put({ cierre_hora: '23:30', cierre_dias: '1,2,2,3' }), 200);
  const [c] = await s.q('SELECT cierre_hora, cierre_dias FROM configuracion WHERE id = 1');
  assert.deepEqual(c, { cierre_hora: '23:30', cierre_dias: '1,2,3' });
  // Solo el administrador cambia la configuración
  assert.equal((await s.llamar('PUT', '/api/config', { cierre_hora: '21:00' }, s.tokenVendedor))[0], 403);
});
