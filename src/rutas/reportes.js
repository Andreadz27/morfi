'use strict';
const {
  get, all, LOCAL, fechaLocal, offsetZonaMin, errorInterno, autenticar, esAdmin, requiere, tienePermiso, centavos, METODOS_PAGO
} = require('../contexto');
const { transferenciasDelPeriodo } = require('../servicios/transferencias-mp');
const { ticketPromedio } = require('../servicios/ticket-promedio');
const { estadoSalud } = require('../servicios/monitoreo');

module.exports = function registrarRutas(app) {

// ============ REPORTES / ANALITICAS ============

app.get('/api/reportes/dashboard', autenticar, requiere('reportes'), async (req, res) => {
  try {
    const hoy = fechaLocal();
    
    const ventasHoy = await get(`
      SELECT COALESCE(SUM(total), 0) as total, COUNT(*) as pedidos
      FROM pedidos WHERE estado = 'pagado' AND date(cerrado_en, ${LOCAL()}) = ?
    `, [hoy]);
    
    const ayer = fechaLocal(1);
    const ventasAyer = await get(`
      SELECT COALESCE(SUM(total), 0) as total
      FROM pedidos WHERE estado = 'pagado' AND date(cerrado_en, ${LOCAL()}) = ?
    `, [ayer]);
    
    const mesActual = hoy.substring(0, 7);
    const ventasMes = await get(`
      SELECT COALESCE(SUM(total), 0) as total
      FROM pedidos WHERE estado = 'pagado' AND substr(date(cerrado_en, ${LOCAL()}), 1, 7) = ?
    `, [mesActual]);
    
    const topProductos = await all(`
      SELECT pi.nombre_producto, SUM(pi.cantidad) as cantidad, SUM(pi.subtotal) as total
      FROM pedido_items pi
      JOIN pedidos p ON pi.pedido_id = p.id
      WHERE p.estado = 'pagado' AND date(p.cerrado_en, ${LOCAL()}) = ?
      GROUP BY pi.nombre_producto
      ORDER BY cantidad DESC
      LIMIT 5
    `, [hoy]);
    
    const metodosPago = await all(`
      SELECT metodo, SUM(monto) as total, COUNT(*) as cantidad
      FROM pagos p
      JOIN pedidos ped ON p.pedido_id = ped.id
      WHERE date(ped.cerrado_en, ${LOCAL()}) = ?
      GROUP BY metodo
      ORDER BY total DESC
    `, [hoy]);
    
    const pedidosRecientes = await all(`
      SELECT p.*, m.nombre as mesa FROM pedidos p
      LEFT JOIN mesas m ON p.mesa_id = m.id
      ORDER BY p.creado_en DESC LIMIT 5
    `);
    
    const stockBajo = await all(`
      SELECT nombre, stock_actual, stock_minimo, unidad
      FROM productos
      WHERE tracking_stock = 1 AND activo = 1 AND stock_actual <= stock_minimo
      ORDER BY (stock_actual - stock_minimo) ASC
      LIMIT 5
    `);
    
    const ventas7Dias = await all(`
      SELECT date(cerrado_en, ${LOCAL()}) as fecha,
             COALESCE(SUM(total), 0) as total,
             COUNT(*) as pedidos
      FROM pedidos
      WHERE estado = 'pagado'
        AND date(cerrado_en, ${LOCAL()}) >= date('now', ${LOCAL()}, '-6 days')
      GROUP BY date(cerrado_en, ${LOCAL()})
      ORDER BY fecha ASC
    `);
    // Rellenar días sin ventas para tener siempre 7 entradas
    const dias7 = [];
    for (let i = 6; i >= 0; i--) {
      const fecha = fechaLocal(i);
      const found = ventas7Dias.find(v => v.fecha === fecha);
      dias7.push(found || { fecha, total: 0, pedidos: 0 });
    }
    
    const ticketPromedio = await get(`
      SELECT COALESCE(AVG(total), 0) as promedio
      FROM pedidos WHERE estado = 'pagado' AND date(cerrado_en, ${LOCAL()}) = ?
    `, [hoy]);
    
    res.json({
      ventas_hoy: ventasHoy.total,
      pedidos_hoy: ventasHoy.pedidos,
      ventas_ayer: ventasAyer.total,
      cambio_dia: ventasAyer.total > 0 ? ((ventasHoy.total - ventasAyer.total) / ventasAyer.total * 100) : 0,
      ventas_mes: ventasMes.total,
      ticket_promedio: ticketPromedio.promedio,
      top_productos: topProductos,
      metodos_pago: metodosPago,
      pedidos_recientes: pedidosRecientes,
      stock_bajo: stockBajo,
      ventas_7dias: dias7
    });
  } catch (err) {
    errorInterno(res, err);
  }
});

// Ventas de un período con el detalle completo: cada venta con sus productos y cobros, y los resúmenes por medio
// de pago, tipo de pedido, persona y producto. ?metodo= deja solo las ventas cobradas (en todo o en parte) con ese medio.
app.get('/api/reportes/ventas', autenticar, requiere('reportes'), async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    const metodo = METODOS_PAGO.includes(req.query.metodo) ? req.query.metodo : '';
    let filtro = '';
    const params = [];
    if (desde) {
      filtro += ` AND date(p.cerrado_en, ${LOCAL()}) >= ?`;
      params.push(desde);
    }
    if (hasta) {
      filtro += ` AND date(p.cerrado_en, ${LOCAL()}) <= ?`;
      params.push(hasta);
    }

    const todos = await all(`SELECT p.*, m.nombre as mesa_nombre, u.nombre as usuario_nombre
               FROM pedidos p
               LEFT JOIN mesas m ON p.mesa_id = m.id
               LEFT JOIN usuarios u ON p.usuario_id = u.id
               WHERE p.estado = 'pagado'${filtro}
               ORDER BY p.cerrado_en DESC`, params);
    const pagosDe = {};
    const itemsDe = {};
    const ids = todos.map(p => p.id);
    // De a tandas: SQLite tiene un tope de parámetros por consulta
    for (let i = 0; i < ids.length; i += 500) {
      const tanda = ids.slice(i, i + 500);
      const marcas = tanda.map(() => '?').join(',');
      for (const pg of await all(`SELECT pedido_id, metodo, monto, fecha, referencia FROM pagos WHERE pedido_id IN (${marcas}) ORDER BY id`, tanda))
        (pagosDe[pg.pedido_id] = pagosDe[pg.pedido_id] || []).push({ metodo: pg.metodo, monto: pg.monto, fecha: pg.fecha, referencia: pg.referencia || '' });
      for (const it of await all(`SELECT pedido_id, nombre_producto, cantidad, precio_unitario, subtotal, opciones, notas FROM pedido_items
          WHERE pedido_id IN (${marcas}) ORDER BY id`, tanda))
        (itemsDe[it.pedido_id] = itemsDe[it.pedido_id] || []).push({
          nombre_producto: it.nombre_producto, cantidad: it.cantidad, precio_unitario: it.precio_unitario,
          subtotal: it.subtotal, opciones: it.opciones || '', notas: it.notas || ''
        });
    }
    for (const p of todos) {
      p.pagos = pagosDe[p.id] || [];
      p.items = itemsDe[p.id] || [];
    }
    const pedidos = metodo ? todos.filter(p => p.pagos.some(pg => pg.metodo === metodo)) : todos;
    const total = centavos(pedidos.reduce((sum, p) => sum + p.total, 0));

    // Resúmenes (sobre las ventas que quedan después del filtro por medio de pago)
    const sumar = (mapa, clave, monto, extra = {}) => {
      const x = mapa.get(clave) || { ...extra, cantidad: 0, total: 0 };
      x.cantidad += 1;
      x.total = centavos(x.total + monto);
      mapa.set(clave, x);
    };
    const porMetodo = new Map();
    const porTipo = new Map();
    const porUsuario = new Map();
    const productos = new Map();
    for (const p of pedidos) {
      for (const pg of p.pagos) sumar(porMetodo, pg.metodo, pg.monto, { metodo: pg.metodo });
      sumar(porTipo, p.tipo || 'salon', p.total, { tipo: p.tipo || 'salon' });
      sumar(porUsuario, p.usuario_nombre || (p.origen ? 'Online / QR' : 'Sin asignar'), p.total, { nombre: p.usuario_nombre || (p.origen ? 'Online / QR' : 'Sin asignar') });
      for (const it of p.items) {
        const x = productos.get(it.nombre_producto) || { nombre_producto: it.nombre_producto, cantidad: 0, total: 0 };
        x.cantidad += it.cantidad;
        x.total = centavos(x.total + it.subtotal);
        productos.set(it.nombre_producto, x);
      }
    }
    const ordenar = mapa => [...mapa.values()].sort((a, b) => b.total - a.total);
    const cobrado = centavos([...porMetodo.values()].reduce((s, m) => s + m.total, 0));
    const suma = campo => centavos(pedidos.reduce((s, p) => s + (Number(p[campo]) || 0), 0));
    const descuentos = centavos(pedidos.reduce((s, p) => s + (Number(p.descuento) || 0) + (Number(p.descuento_puntos) || 0) + (Number(p.descuento_cupon) || 0), 0));
    const cancelados = await get(`SELECT COUNT(*) AS cantidad, COALESCE(SUM(p.total), 0) AS total FROM pedidos p
      WHERE p.estado = 'cancelado'${filtro.replace(/p\.cerrado_en/g, 'COALESCE(p.cerrado_en, p.creado_en)')}`, params);

    res.json({
      pedidos, total, cantidad: pedidos.length, metodo,
      resumen: {
        subtotal: suma('subtotal'),
        descuentos,
        propinas: suma('propina'),
        total,
        ticket_promedio: pedidos.length ? centavos(total / pedidos.length) : 0,
        cobrado,
        por_metodo: ordenar(porMetodo).map(m => ({ ...m, porcentaje: cobrado > 0 ? Math.round(m.total / cobrado * 1000) / 10 : 0 })),
        por_tipo: ordenar(porTipo),
        por_usuario: ordenar(porUsuario),
        productos: ordenar(productos),
        cancelados: { cantidad: cancelados.cantidad, total: centavos(cancelados.total) }
      }
    });
  } catch (err) {
    errorInterno(res, err);
  }
});

// Transferencias que entraron a la cuenta de Mercado Pago del local en el período, y en qué venta quedó registrada
// cada una (las detectadas solas o cobradas con el botón llevan la referencia MP-<id>), y los cobros con tarjeta del Point.
// Sin MP activo: disponible = false.
app.get('/api/reportes/transferencias-mp', autenticar, requiere('reportes'), async (req, res) => {
  try {
    const fecha = /^\d{4}-\d{2}-\d{2}$/;
    const hoy = fechaLocal();
    const desde = fecha.test(req.query.desde || '') ? req.query.desde : hoy;
    const hasta = fecha.test(req.query.hasta || '') ? req.query.hasta : hoy;
    if (Date.parse(hasta) - Date.parse(desde) > 92 * 86400000) return res.status(400).json({ error: 'Elegí un período de hasta 3 meses' });
    res.json(await transferenciasDelPeriodo(desde, hasta, offsetZonaMin()));
  } catch (err) {
    res.status(502).json({ error: `No se pudo consultar Mercado Pago: ${err.message}` });
  }
});

// Ticket promedio por ticket y por persona (las personas se calculan solas con lo pedido: servicios/ticket-promedio.js),
// salón / para llevar, por día de la semana y contra el período anterior del mismo largo
app.get('/api/reportes/ticket', autenticar, requiere('reportes'), async (req, res) => {
  try {
    const fecha = /^\d{4}-\d{2}-\d{2}$/;
    const hoy = fechaLocal();
    const desde = fecha.test(req.query.desde || '') ? req.query.desde : hoy;
    const hasta = fecha.test(req.query.hasta || '') ? req.query.hasta : hoy;
    if (hasta < desde || Date.parse(hasta) - Date.parse(desde) > 370 * 86400000) return res.status(400).json({ error: 'Elegí un período de hasta un año' });
    res.json(await ticketPromedio(desde, hasta));
  } catch (err) {
    errorInterno(res, err);
  }
});

app.get('/api/reportes/rentabilidad', autenticar, requiere('reportes.costos'), async (req, res) => {
  try {
    const rentabilidad = await all(`
      SELECT p.nombre, p.precio_venta, p.costo,
        (p.precio_venta - p.costo) as ganancia,
        CASE WHEN p.precio_venta > 0 THEN ((p.precio_venta - p.costo) / p.precio_venta * 100) ELSE 0 END as margen,
        (SELECT COALESCE(SUM(pi.cantidad), 0) FROM pedido_items pi JOIN pedidos pd ON pi.pedido_id = pd.id 
         WHERE pi.producto_id = p.id AND pd.estado = 'pagado') as vendidos
      FROM productos p
      WHERE p.activo = 1 AND p.clase = 'venta'
      ORDER BY margen DESC
    `);
    res.json(rentabilidad);
  } catch (err) {
    errorInterno(res, err);
  }
});

// ============ AUDITORIA ============

app.get('/api/auditoria', autenticar, esAdmin, async (req, res) => {
  try {
    const logs = await all(`
      SELECT a.*, u.nombre as usuario_nombre
      FROM auditoria a
      LEFT JOIN usuarios u ON a.usuario_id = u.id
      ORDER BY a.fecha DESC
      LIMIT 100
    `);
    res.json(logs);
  } catch (err) {
    errorInterno(res, err);
  }
});

// ============ INSIGHTS / INTELIGENCIA DE NEGOCIO ============

app.get('/api/insights', autenticar, requiere('reportes'), async (req, res) => {
  try {
    const hoy = fechaLocal();

    // --- Alerta de stock bajo (crítico y preventivo) ---
    const stockBajo = await all(`
      SELECT nombre, stock_actual, stock_minimo, unidad, tracking_stock
      FROM productos
      WHERE activo = 1 AND tracking_stock = 1
        AND stock_actual <= stock_minimo
      ORDER BY (stock_actual - stock_minimo) ASC
    `);

    const stockCritico = stockBajo.filter(p => p.stock_actual === 0 || p.stock_actual <= (p.stock_minimo / 2));
    const stockPreventivo = stockBajo.filter(p => !stockCritico.includes(p));

    // --- Rentabilidad: productos más vendidos vs margen ---
    const topRentabilidad = await all(`
      SELECT p.nombre, p.precio_venta, p.costo,
        (p.precio_venta - p.costo) as ganancia,
        CASE WHEN p.precio_venta > 0 THEN ROUND((p.precio_venta - p.costo) / p.precio_venta * 100, 1) ELSE 0 END as margen,
        (SELECT COALESCE(SUM(pi.cantidad), 0) FROM pedido_items pi JOIN pedidos pd ON pi.pedido_id = pd.id
         WHERE pi.producto_id = p.id AND pd.estado = 'pagado') as vendidos
      FROM productos p
      WHERE p.activo = 1 AND p.clase = 'venta'
      ORDER BY vendidos DESC, margen DESC
      LIMIT 10
    `);

    // --- Horas pico (últimos 7 días) para sugerir personal ---
    const horasPico = await all(`
      SELECT CAST(strftime('%H', pd.cerrado_en, ${LOCAL()}) AS INTEGER) as hora, COUNT(*) as pedidos
      FROM pedidos pd
      WHERE pd.estado = 'pagado' AND date(pd.cerrado_en, ${LOCAL()}) >= date('now', ${LOCAL()}, '-7 days')
      GROUP BY hora
      ORDER BY pedidos DESC
      LIMIT 3
    `);

    // --- Comparativa: hoy vs promedio diario de la semana pasada ---
    const ventasHoy = await get(`
      SELECT COALESCE(SUM(total), 0) as total, COUNT(*) as pedidos
      FROM pedidos WHERE estado = 'pagado' AND date(cerrado_en, ${LOCAL()}) = ?
    `, [hoy]);

    const ventasSemana = await get(`
      SELECT COALESCE(AVG(diario), 0) as promedio
      FROM (
        SELECT date(cerrado_en, ${LOCAL()}) as dia, SUM(total) as diario
        FROM pedidos WHERE estado = 'pagado' AND date(cerrado_en, ${LOCAL()}) >= date('now', ${LOCAL()}, '-7 days')
        GROUP BY date(cerrado_en, ${LOCAL()})
      )
    `);

    const diferencia = ventasSemana.promedio > 0
      ? Math.round(((ventasHoy.total - ventasSemana.promedio) / ventasSemana.promedio) * 100)
      : 0;

    // --- Construcción de alertas inteligentes ---
    const alertas = [];

    // Al administrador: lo mismo que ve el monitoreo (base, copias, copia fuera del local)
    if (tienePermiso(req.usuario, 'admin')) {
      for (const problema of (await estadoSalud()).problemas) {
        alertas.push({
          tipo: 'critico', icono: 'shield-alt', titulo: 'Copias de seguridad: revisar',
          detalle: problema.charAt(0).toUpperCase() + problema.slice(1) + '. Avisá a soporte.',
          accion: 'Ver copias', enlace: 'config'
        });
      }
    }

    if (stockCritico.length > 0) {
      alertas.push({
        tipo: 'critico',
        icono: 'exclamation-triangle',
        titulo: `${stockCritico.length} producto${stockCritico.length > 1 ? 's' : ''} sin stock o al límite`,
        detalle: stockCritico.slice(0, 3).map(p => `${p.nombre} (${p.stock_actual}/${p.stock_minimo})`).join(', ') +
          (stockCritico.length > 3 ? ` y ${stockCritico.length - 3} más` : ''),
        accion: 'Reponer inventario',
        enlace: 'stock'
      });
    }

    const muyVendidos = topRentabilidad.filter(p => p.vendidos > 0);
    if (muyVendidos.length > 0 && muyVendidos[0].margen < 30) {
      alertas.push({
        tipo: 'info',
        icono: 'chart-line',
        titulo: 'Revisar precios',
        detalle: `Tu producto más vendido (${muyVendidos[0].nombre}) tiene solo ${muyVendidos[0].margen}% de margen. Un pequeño ajuste puede aumentar la rentabilidad.`,
        accion: 'Ver rentabilidad',
        enlace: 'reportes'
      });
    }

    if (horasPico.length > 0) {
      alertas.push({
        tipo: 'info',
        icono: 'clock',
        titulo: `Horas pico: ${horasPico[0].hora}:00 hs`,
        detalle: 'Considerá reforzar el personal de cocina y salón en estos horarios para optimizar el servicio.',
        accion: 'Ver reportes',
        enlace: 'reportes'
      });
    }

    if (stockPreventivo.length > 0) {
      alertas.push({
        tipo: 'aviso',
        icono: 'boxes',
        titulo: `${stockPreventivo.length} producto${stockPreventivo.length > 1 ? 's' : ''} por agotarse pronto`,
        detalle: stockPreventivo.slice(0, 3).map(p => `${p.nombre} (${p.stock_actual})`).join(', '),
        accion: 'Orden de compra',
        enlace: 'stock'
      });
    }

    // --- Recomendaciones accionables de negocio ---
    const recomendaciones = [];
    if (diferencia < -15) {
      recomendaciones.push({
        icono: 'trending-down',
        titulo: 'Las ventas están por debajo de tu promedio',
        texto: `Hoy las ventas van ${Math.abs(diferencia)}% por debajo de tu promedio diario de la semana. Considerá promociones para impulsar el ticket.`
      });
    } else if (diferencia > 15) {
      recomendaciones.push({
        icono: 'trending-up',
        titulo: '¡Gran día de ventas!',
        texto: `Hoy superás tu promedio diario en ${diferencia}%. Aprovechá el flujo para ofrecer los productos de mayor margen.`
      });
    }

    const altaDemandaBajoStock = topRentabilidad.filter(p => p.vendidos > 0 && stockBajo.some(s => s.nombre === p.nombre));
    if (altaDemandaBajoStock.length > 0) {
      recomendaciones.push({
        icono: 'lightbulb',
        titulo: 'Productos demandados con stock bajo',
        texto: `${altaDemandaBajoStock[0].nombre} se vende bien pero su stock está bajo. Priorizá su reposición para no perder ventas.`
      });
    }

    if (recomendaciones.length === 0) {
      recomendaciones.push({
        icono: 'thumbs-up',
        titulo: 'Todo bajo control',
        texto: 'No se detectan desvíos importantes. Seguí monitoreando el panel para nuevas recomendaciones personalizadas.'
      });
    }

    res.json({
      alertas,
      recomendaciones,
      stock_bajo: stockBajo.map(p => ({
        nombre: p.nombre, stock_actual: p.stock_actual,
        stock_minimo: p.stock_minimo, unidad: p.unidad
      })),
      metricas: {
        ventas_hoy: ventasHoy.total,
        pedidos_hoy: ventasHoy.pedidos,
        promedio_semana: ventasSemana.promedio,
        diferencia_pct: diferencia,
        horas_pico: horasPico
      },
      generado_en: new Date().toISOString()
    });
  } catch (err) {
    errorInterno(res, err);
  }
});

};
