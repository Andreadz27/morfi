'use strict';
const {
  run, get, all, transaccion, errorHttp, errorInterno, autenticar, importe, requiere, autorizar, controlCaja, esSupervisor,
  redondear, resumenCaja, cerrarCajaTx, completarArqueo
} = require('../contexto');

module.exports = function registrarRutas(app) {

// ============ CAJA ============

app.post('/api/caja/abrir', autenticar, requiere('caja.operar'), async (req, res) => {
  try {
    const { monto_inicial, observaciones } = req.body;
    // En una transacción: dos aperturas simultáneas no pueden crear dos cajas abiertas
    const id = await transaccion(async () => {
      const cajaAbierta = await get("SELECT id FROM caja WHERE estado = 'abierta'");
      if (cajaAbierta) throw errorHttp(400, 'Ya hay una caja abierta');
      const result = await run(
        `INSERT INTO caja (monto_inicial, usuario_id, observaciones) VALUES (?, ?, ?)`,
        [importe(monto_inicial), req.usuario.id, observaciones || '']
      );
      return result.id;
    });
    res.status(201).json({ id, message: 'Caja abierta' });
  } catch (err) {
    errorInterno(res, err);
  }
});

// El arqueo (resumenCaja) y el cierre (cerrarCajaTx) están en servicios/caja.js: también los usa el cierre del día

// Arqueo ciego: quien no es encargado no ve lo que "debería" haber; cuenta y declara.
// Ve sus movimientos, pero no las ventas por medio de pago, el efectivo esperado ni la diferencia.
function resumenParaUsuario(resumen, usuario, ciego) {
  if (!ciego || esSupervisor(usuario)) return resumen;
  const { monto_inicial, ingresos, egresos, movimientos, cobros } = resumen;
  return { monto_inicial, ingresos, egresos, movimientos, cobros, ciego: true };
}

// Ingreso o egreso de efectivo en la caja abierta (cambio, retiro, pago a proveedor...)
app.post('/api/caja/movimiento', autenticar, requiere('caja.operar'), async (req, res) => {
  try {
    const { tipo } = req.body || {};
    const monto = Number(req.body && req.body.monto);
    const concepto = String((req.body && req.body.concepto) || '').trim();
    if (!['ingreso', 'egreso'].includes(tipo)) return res.status(400).json({ error: 'Tipo de movimiento inválido' });
    if (!Number.isFinite(monto) || monto <= 0) return res.status(400).json({ error: 'El monto debe ser mayor a cero' });
    if (!concepto) return res.status(400).json({ error: 'Indicá el concepto del movimiento' });
    // Sacar plata de la caja: con el PIN de autorización activado, lo autoriza un encargado
    if (tipo === 'egreso') {
      const a = await autorizar(req, 'caja.operar', 'Egreso de caja');
      if (!a.ok) return res.status(a.status).json({ error: a.error, ...(a.requiere_pin ? { requiere_pin: true } : {}) });
    }
    const id = await transaccion(async () => {
      const caja = await get("SELECT id FROM caja WHERE estado = 'abierta'");
      if (!caja) throw errorHttp(400, 'No hay caja abierta');
      const r = await run('INSERT INTO movimientos_caja (caja_id, tipo, concepto, monto, usuario_id) VALUES (?, ?, ?, ?, ?)',
        [caja.id, tipo, concepto, redondear(monto), req.usuario.id]);
      await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)',
        [req.usuario.id, `caja_${tipo}`, `${tipo === 'ingreso' ? 'Ingreso' : 'Egreso'} de caja: ${concepto} (${redondear(monto)})`]);
      return r.id;
    });
    res.status(201).json({ id, message: 'Movimiento registrado' });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.post('/api/caja/cerrar', autenticar, requiere('caja.operar'), async (req, res) => {
  try {
    const contado = Number(req.body && req.body.monto_final_real);
    if (!Number.isFinite(contado) || contado < 0)
      return res.status(400).json({ error: 'Ingresá el efectivo contado en caja' });
    const resultado = await transaccion(async () => {
      const caja = await get("SELECT * FROM caja WHERE estado = 'abierta'");
      if (!caja) throw errorHttp(400, 'No hay caja abierta');
      return cerrarCajaTx(caja, { contado, observaciones: req.body && req.body.observaciones, usuarioId: req.usuario.id });
    });
    const { ciego } = await controlCaja();
    if (ciego && !esSupervisor(req.usuario))
      return res.json({ message: 'Caja cerrada. El encargado revisa el arqueo.', ciego: true, efectivo_contado: redondear(contado) });
    res.json({
      message: 'Caja cerrada',
      total_ventas: resultado.resumen.total_ventas,
      efectivo_esperado: resultado.resumen.efectivo_esperado,
      efectivo_contado: redondear(contado),
      diferencia: resultado.diferencia,
      resumen: resultado.resumen
    });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.get('/api/caja/estado', autenticar, requiere('caja.operar'), async (req, res) => {
  try {
    const caja = await get(`SELECT c.*, u.nombre as usuario_nombre FROM caja c LEFT JOIN usuarios u ON c.usuario_id = u.id WHERE c.estado = 'abierta'`);
    if (!caja) return res.json(null);
    const { ciego } = await controlCaja();
    res.json({ ...caja, resumen: resumenParaUsuario(await resumenCaja(caja), req.usuario, ciego) });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.get('/api/caja/historial', autenticar, requiere('caja.historial'), async (req, res) => {
  try {
    const cajas = await all(`
      SELECT c.id, c.fecha_apertura, c.fecha_cierre, c.monto_inicial, c.monto_final_real, c.estado,
        c.monto_esperado, c.diferencia, c.observaciones, c.observaciones_cierre, c.pendiente_arqueo, u.nombre as usuario_nombre,
        (SELECT COALESCE(SUM(pg.monto), 0) FROM pagos pg
          WHERE pg.fecha >= c.fecha_apertura AND pg.fecha <= COALESCE(c.fecha_cierre, '9999-12-31')) as ventas
      FROM caja c
      LEFT JOIN usuarios u ON c.usuario_id = u.id
      ORDER BY c.fecha_apertura DESC
      LIMIT 200
    `);
    res.json(cajas);
  } catch (err) {
    errorInterno(res, err);
  }
});

// Caja que cerró sola en el cierre del día (nadie había contado): el encargado carga el efectivo contado
app.post('/api/caja/:id/arqueo', autenticar, requiere('caja.historial'), async (req, res) => {
  try {
    const contado = Number(req.body && req.body.monto_final_real);
    if (!Number.isFinite(contado) || contado < 0) return res.status(400).json({ error: 'Ingresá el efectivo contado en caja' });
    res.json(await completarArqueo(Number(req.params.id), { contado, observaciones: req.body.observaciones, usuarioId: req.usuario.id }));
  } catch (err) {
    errorInterno(res, err);
  }
});

// Detalle del arqueo de una caja (cerrada: el guardado al cerrar; abierta: en vivo)
app.get('/api/caja/:id/arqueo', autenticar, requiere('caja.historial'), async (req, res) => {
  try {
    const caja = await get(`SELECT c.*, u.nombre as usuario_nombre FROM caja c LEFT JOIN usuarios u ON c.usuario_id = u.id WHERE c.id = ?`, [req.params.id]);
    if (!caja) return res.status(404).json({ error: 'Caja no encontrada' });
    let resumen = null;
    try { resumen = caja.resumen ? JSON.parse(caja.resumen) : null; } catch (e) {}
    res.json({ ...caja, resumen: resumen || await resumenCaja(caja) });
  } catch (err) {
    errorInterno(res, err);
  }
});

};
