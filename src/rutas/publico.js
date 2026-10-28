'use strict';
const {
  rateLimit, urlPublica, urlCartaNube, get, all, errorInterno, crearPedidoOnline, mesaPorToken, estadoMesa, solicitarPedidoMesa, llamarMozo,
  iniciarPagoMesa, verificarPagoMesa, pedirComprobanteMesa, leerTraducciones, ORDEN_CARTA, cartaPorMomentos, listarGrupos, gruposPorProducto,
  leerJSON, disponibleAhora, textoHorario
} = require('../contexto');
const QRCode = require('qrcode');

module.exports = function registrarRutas(app) {

// Imagen QR de un texto (link de la carta, de pago de Mercado Pago...). Antes se pedía a api.qrserver.com:
// sin internet no salía ningún QR. Es pública porque la usa <img src> (sin token) y solo dibuja el texto.
app.get('/api/publico/qr.svg', async (req, res) => {
  try {
    const texto = String(req.query.d || '');
    if (!texto || texto.length > 1000) return res.status(400).json({ error: 'Texto inválido para el QR' });
    res.type('image/svg+xml').set('Cache-Control', 'public, max-age=86400')
      .send(await QRCode.toString(texto, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' }));
  } catch (err) { errorInterno(res, err); }
});

// ============ MENÚ PÚBLICO (carta QR - sin autenticación) ============

app.get('/api/publico/menu', async (req, res) => {
  try {
    const categorias = await all(`
      SELECT c.id, c.nombre, c.descripcion, c.traducciones, c.sugerir, c.nombre_para_llevar FROM categorias c
      WHERE c.activo = 1 AND EXISTS (SELECT 1 FROM productos p WHERE p.categoria_id = c.id AND p.activo = 1 AND p.clase = 'venta')
      ORDER BY c.orden, c.nombre
    `);
    const productos = await all(`
      SELECT p.id, p.nombre, p.descripcion, p.precio_venta, p.categoria_id,
             p.tracking_stock, p.stock_actual, p.es_plato, p.traducciones, p.nuevo, p.recomendado,
             p.version_grande_id, p.horario, p.combo, p.para_llevar
      FROM productos p
      WHERE p.activo = 1 AND p.clase = 'venta'
      ORDER BY ${ORDEN_CARTA}
    `);
    // Traducciones de la carta (inglés y portugués): el navegador elige el idioma
    for (const x of [...categorias, ...productos]) x.traducciones = leerTraducciones(x.traducciones);
    // Venta cruzada: con qué se sugiere cada categoría; horario (y si se puede pedir ahora) y combos
    for (const c of categorias) c.sugerir = c.sugerir ? c.sugerir.split(',').map(Number) : [];
    for (const p of productos) {
      p.disponible = disponibleAhora(p.horario);
      p.horario_texto = textoHorario(p.horario);
      p.horario = leerJSON(p.horario);
      p.combo = leerJSON(p.combo);
    }
    // Opciones y adicionales: los grupos (con precios) y cuáles tiene cada producto
    const porProducto = await gruposPorProducto();
    for (const p of productos) p.grupos = porProducto[p.id] || [];
    const usados = new Set(Object.values(porProducto).flat());
    const grupos = (await listarGrupos({ soloActivos: true })).filter(g => usados.has(g.id) && g.opciones.length)
      .map(({ id, nombre, tipo, obligatorio, maximo, traducciones, opciones }) => ({ id, nombre, tipo, obligatorio, maximo, traducciones, opciones }));
    // Momentos del día (Desayuno, Brunch...), el de ahora y destacados (Nuevo, Recomendado, Lo más pedido)
    res.json({ categorias, productos, grupos, ...await cartaPorMomentos(categorias, productos) });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.get('/api/publico/info', async (req, res) => {
  try {
    const config = await get('SELECT nombre_negocio, eslogan, direccion, telefono, email, cuit FROM configuracion WHERE id = 1');
    // Sin BASE_URL no hay links: el navegador arma los suyos con la dirección por la que entró
    // (antes salían con localhost y el QR impreso en las mesas no abría en ningún celular)
    const base = urlPublica();
    // Con Fadido Nube la carta tiene link fijo en la nube: anda aunque cambie la conexión o la PC del local
    const nube = urlCartaNube();
    res.json({
      nombre: config?.nombre_negocio || 'Fadido',
      eslogan: config?.eslogan || '',
      descripcion: config?.direccion ? `Dirección: ${config.direccion}` : '',
      telefono: config?.telefono || '',
      email: config?.email || '',
      // Para el aviso de privacidad del formulario del pedido (el local es el responsable de los datos)
      cuit: config?.cuit || '',
      links: nube ? {
        carta:     `${nube}/pedido.html`,
        whatsapp:  `${nube}/pedido.html?origen=whatsapp`,
        instagram: `${nube}/pedido.html?origen=instagram`
      } : base ? {
        carta:     `${base}/pedido.html?ver=1`,
        whatsapp:  `${base}/pedido.html?origen=whatsapp`,
        instagram: `${base}/pedido.html?origen=instagram`
      } : {}
    });
  } catch (err) { errorInterno(res, err); }
});

const pedidoOnlineLimiter = rateLimit({ windowMs: 60000, max: 10 });
app.post('/api/publico/pedido', pedidoOnlineLimiter, async (req, res) => {
  try {
    const { pid, numero, total, origen } = await crearPedidoOnline(req.body);
    const label = { whatsapp: 'WhatsApp', instagram: 'Instagram', web: 'Web' }[origen] || origen;
    res.status(201).json({ id: pid, numero_pedido: numero, subtotal: total, total, origen: label });
  } catch (err) { errorInterno(res, err); }
});

// ============ PEDIDO DESDE LA MESA (QR de cada mesa, sin login) ============
// En el local todos los celulares salen por la misma IP (el WiFi): el límite por IP es amplio
// y el tope real es por mesa (pedidos sin confirmar, en el servicio)
const mesaLimiter = rateLimit({ windowMs: 60000, max: 60 });
const conMesa = fn => async (req, res) => {
  try {
    const mesa = await mesaPorToken(req.params.token);
    if (!mesa) return res.status(404).json({ error: 'Este QR no corresponde a ninguna mesa. Pedile ayuda al mozo.' });
    await fn(req, res, mesa);
  } catch (err) { errorInterno(res, err); }
};

app.get('/api/publico/mesa/:token', mesaLimiter, conMesa(async (req, res, mesa) => {
  res.json(await estadoMesa(mesa));
}));

app.post('/api/publico/mesa/:token/pedido', mesaLimiter, conMesa(async (req, res, mesa) => {
  const { items, notas, cliente } = req.body || {};
  res.status(201).json(await solicitarPedidoMesa(mesa, { items, notas, cliente }));
}));

app.post('/api/publico/mesa/:token/llamar', mesaLimiter, conMesa(async (req, res, mesa) => {
  const { tipo, forma } = req.body || {};
  res.status(201).json(await llamarMozo(mesa, tipo, forma));
}));

// Pagar desde la mesa con Mercado Pago: toda la cuenta o una parte, con propina
app.post('/api/publico/mesa/:token/pagar', mesaLimiter, conMesa(async (req, res, mesa) => {
  const { partes, propina } = req.body || {};
  res.status(201).json(await iniciarPagoMesa(mesa, req.params.token, { partes, propina }));
}));

// Al volver de Mercado Pago (payment_id viene en la URL de vuelta): se consulta y se acredita
app.post('/api/publico/mesa/:token/pago/:id/verificar', mesaLimiter, conMesa(async (req, res, mesa) => {
  res.json(await verificarPagoMesa(mesa, Number(req.params.id), req.body && req.body.payment_id));
}));

app.post('/api/publico/mesa/:token/pago/:id/comprobante', mesaLimiter, conMesa(async (req, res, mesa) => {
  res.json(await pedirComprobanteMesa(mesa, Number(req.params.id), req.body && req.body.telefono));
}));

};
