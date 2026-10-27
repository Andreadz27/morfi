'use strict';
const {
  run, get, all, errorHttp, actualizarParcial, errorInterno, autenticar, requiere, transaccion, obtenerReceta, guardarRecetaTx, recalcularCostosConIngrediente, costoReceta,
  costoConReceta, validarClaseTx, recetario, CLASES,
  normalizarTraducciones, ORDEN_CARTA, listarMomentos, guardarMomento, borrarMomento, listarGrupos, guardarGrupo, borrarGrupo, gruposPorProducto,
  validarHorario, validarCombo, validarVersionGrande, validarSugerir
} = require('../contexto');

module.exports = function registrarRutas(app) {

// ============ CATEGORIAS ============

app.get('/api/categorias', autenticar, async (req, res) => {
  try {
    const categorias = await all('SELECT * FROM categorias WHERE activo = 1 ORDER BY orden');
    res.json(categorias);
  } catch (err) {
    errorInterno(res, err);
  }
});

app.post('/api/categorias', autenticar, requiere('catalogo'), async (req, res) => {
  try {
    const { nombre, descripcion, color, orden, traducciones, sugerir, nombre_para_llevar } = req.body;
    const result = await run(
      'INSERT INTO categorias (nombre, descripcion, color, orden, traducciones, sugerir, nombre_para_llevar) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [nombre, descripcion || '', color || '#4CAF50', orden || 0, normalizarTraducciones(traducciones), await validarSugerir(sugerir),
        String(nombre_para_llevar || '').trim().slice(0, 60)]
    );
    res.status(201).json({ id: result.id, message: 'Categoría creada' });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.put('/api/categorias/:id', autenticar, requiere('catalogo'), async (req, res) => {
  try {
    const body = { ...(req.body || {}) };
    if (body.traducciones !== undefined) body.traducciones = normalizarTraducciones(body.traducciones);
    if (body.sugerir !== undefined) body.sugerir = await validarSugerir(body.sugerir, req.params.id);
    if (body.nombre_para_llevar !== undefined) body.nombre_para_llevar = String(body.nombre_para_llevar || '').trim().slice(0, 60);
    await actualizarParcial('categorias', req.params.id, body, ['nombre', 'descripcion', 'color', 'orden', 'activo', 'traducciones', 'sugerir',
      'nombre_para_llevar']);
    res.json({ message: 'Categoría actualizada' });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.delete('/api/categorias/:id', autenticar, requiere('catalogo'), async (req, res) => {
  try {
    await run('UPDATE categorias SET activo = 0 WHERE id = ?', [req.params.id]);
    res.json({ message: 'Categoría desactivada' });
  } catch (err) {
    errorInterno(res, err);
  }
});

// ============ MOMENTOS DE LA CARTA (servicios/carta.js) ============
// Desayuno, Brunch, Almuerzo, Merienda...: horario y categorías. La carta abre en el de la hora.

app.get('/api/carta/momentos', autenticar, async (req, res) => {
  try { res.json(await listarMomentos()); } catch (err) { errorInterno(res, err); }
});

app.post('/api/carta/momentos', autenticar, requiere('catalogo'), async (req, res) => {
  try { res.status(201).json(await guardarMomento(req.body)); } catch (err) { errorInterno(res, err); }
});

app.put('/api/carta/momentos/:id', autenticar, requiere('catalogo'), async (req, res) => {
  try { res.json(await guardarMomento(req.body, Number(req.params.id))); } catch (err) { errorInterno(res, err); }
});

app.delete('/api/carta/momentos/:id', autenticar, requiere('catalogo'), async (req, res) => {
  try { await borrarMomento(Number(req.params.id)); res.json({ message: 'Momento borrado' }); } catch (err) { errorInterno(res, err); }
});

// ============ OPCIONES Y ADICIONALES (servicios/opciones.js) ============
// Grupos ("¿Qué leche?", "Adicionales") con sus opciones y precios, y los productos que los usan

app.get('/api/opciones/grupos', autenticar, async (req, res) => {
  try { res.json(await listarGrupos()); } catch (err) { errorInterno(res, err); }
});

app.post('/api/opciones/grupos', autenticar, requiere('catalogo'), async (req, res) => {
  try { res.status(201).json(await guardarGrupo(req.body)); } catch (err) { errorInterno(res, err); }
});

app.put('/api/opciones/grupos/:id', autenticar, requiere('catalogo'), async (req, res) => {
  try { res.json(await guardarGrupo(req.body, Number(req.params.id))); } catch (err) { errorInterno(res, err); }
});

app.delete('/api/opciones/grupos/:id', autenticar, requiere('catalogo'), async (req, res) => {
  try { await borrarGrupo(Number(req.params.id)); res.json({ message: 'Grupo borrado' }); } catch (err) { errorInterno(res, err); }
});

// ============ PRODUCTOS ============

app.get('/api/productos', autenticar, async (req, res) => {
  try {
    const productos = await all(`
      SELECT p.*, c.nombre as categoria_nombre, c.color as categoria_color,
        (SELECT COUNT(*) FROM recetas r WHERE r.plato_id = p.id) AS ingredientes_receta
      FROM productos p
      LEFT JOIN categorias c ON p.categoria_id = c.id
      WHERE p.activo = 1
      ORDER BY c.orden, ${ORDEN_CARTA}
    `);
    // Grupos de opciones de cada producto (el punto de venta pregunta "¿Qué leche?" al tocarlo)
    const grupos = await gruposPorProducto();
    for (const p of productos) p.grupos = grupos[p.id] || [];
    res.json(productos);
  } catch (err) {
    errorInterno(res, err);
  }
});

// Valida y normaliza los datos de un producto. Con "actual" (edición) los campos que
// no vienen en el body conservan su valor: antes se guardaban como NULL y el producto
// editado desaparecía del POS (activo = NULL) y perdía el stock.
async function datosProducto(body, actual = {}) {
  const valor = (campo, porDefecto) => body[campo] !== undefined ? body[campo] : (actual[campo] !== undefined ? actual[campo] : porDefecto);
  const numero = (campo, porDefecto) => {
    const v = valor(campo, porDefecto);
    const n = Number(v);
    if (v === null || v === '' || !Number.isFinite(n) || n < 0) throw errorHttp(400, `Valor inválido en ${campo.replace('_', ' ')}`);
    return n;
  };
  const bandera = (campo, porDefecto) => valor(campo, porDefecto) ? 1 : 0;

  const nombre = String(valor('nombre', '') || '').trim();
  if (!nombre) throw errorHttp(400, 'El nombre es obligatorio');
  if (valor('precio_venta', undefined) === undefined) throw errorHttp(400, 'El precio de venta es obligatorio');

  let categoriaId = valor('categoria_id', null);
  if (categoriaId === '' || Number.isNaN(Number(categoriaId))) categoriaId = null;
  if (categoriaId !== null) {
    const cat = await get('SELECT id FROM categorias WHERE id = ?', [categoriaId]);
    if (!cat) throw errorHttp(400, 'La categoría no existe');
    categoriaId = cat.id;
  }

  // Tipo: se vende (carta y POS), insumo o sub-receta (servicios/recetas.js). Rinde: presentaciones de la sub-receta.
  const clase = String(valor('clase', 'venta') || 'venta');
  if (!CLASES.includes(clase)) throw errorHttp(400, 'Tipo de producto inválido');
  const rendimiento = clase === 'elaboracion' ? numero('rendimiento', 1) : 1;
  if (!(rendimiento > 0 && rendimiento <= 10000)) throw errorHttp(400, 'El rendimiento tiene que ser mayor a 0');

  return {
    nombre,
    clase,
    rendimiento,
    descripcion: String(valor('descripcion', '') || ''),
    categoria_id: categoriaId,
    precio_venta: numero('precio_venta'),
    costo: numero('costo', 0),
    es_plato: bandera('es_plato', 0),
    tracking_stock: bandera('tracking_stock', 0),
    stock_actual: Number(valor('stock_actual', 0)) || 0, // puede quedar negativo por ventas
    stock_minimo: numero('stock_minimo', 0),
    unidad: String(valor('unidad', 'unidad') || 'unidad'),
    activo: bandera('activo', 1),
    orden: Math.trunc(numero('orden', 0)),
    // Destacados de la carta: "Nuevo" y "Recomendado de la casa"
    nuevo: bandera('nuevo', 0),
    // En el menú Take Away (para llevar)
    para_llevar: bandera('para_llevar', 0),
    recomendado: bandera('recomendado', 0),
    // Venta cruzada: versión grande, horario (promos de 8 a 12) y qué incluye un combo. Sin el campo, se conserva.
    version_grande_id: body.version_grande_id !== undefined ? await validarVersionGrande(body.version_grande_id, actual.id) : (actual.version_grande_id || null),
    horario: body.horario !== undefined ? (validarHorario(body.horario) || '') : (actual.horario || ''),
    combo: body.combo !== undefined ? ((await validarCombo(body.combo, actual.id)) || '') : (actual.combo || ''),
    // Sin "traducciones" en el body, la edición conserva las que tenía
    traducciones: body.traducciones !== undefined ? normalizarTraducciones(body.traducciones) : (actual.traducciones || null)
  };
}

app.post('/api/productos', autenticar, requiere('catalogo'), async (req, res) => {
  try {
    const p = await datosProducto(req.body || {});
    const result = await run(
      `INSERT INTO productos (nombre, descripcion, categoria_id, precio_venta, costo, es_plato, tracking_stock, stock_actual, stock_minimo, unidad, activo, traducciones, orden, nuevo, recomendado,
         version_grande_id, horario, combo, clase, rendimiento, para_llevar)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [p.nombre, p.descripcion, p.categoria_id, p.precio_venta, p.costo, p.es_plato, p.tracking_stock, p.stock_actual, p.stock_minimo, p.unidad, p.activo, p.traducciones, p.orden, p.nuevo, p.recomendado, p.version_grande_id, p.horario, p.combo, p.clase, p.rendimiento, p.para_llevar]
    );
    res.status(201).json({ id: result.id, message: 'Producto creado' });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.put('/api/productos/:id', autenticar, requiere('catalogo'), async (req, res) => {
  try {
    const actual = await get('SELECT * FROM productos WHERE id = ?', [req.params.id]);
    if (!actual) return res.status(404).json({ error: 'Producto no encontrado' });
    const p = await datosProducto(req.body || {}, actual);
    await transaccion(async () => {
      if (p.clase !== actual.clase) await validarClaseTx(actual.id, p.clase);
      // Con receta, el costo es el de sus ingredientes (no se edita a mano); el de una sub-receta, por presentación
      const receta = await obtenerReceta(actual.id);
      if (receta.length) p.costo = costoConReceta(p, receta);
      await run(
        `UPDATE productos SET
         nombre = ?, descripcion = ?, categoria_id = ?, precio_venta = ?, costo = ?,
         es_plato = ?, tracking_stock = ?, stock_actual = ?, stock_minimo = ?, unidad = ?, activo = ?, traducciones = ?, orden = ?, nuevo = ?, recomendado = ?,
         version_grande_id = ?, horario = ?, combo = ?, clase = ?, rendimiento = ?, para_llevar = ?
         WHERE id = ?`,
        [p.nombre, p.descripcion, p.categoria_id, p.precio_venta, p.costo, p.es_plato, p.tracking_stock, p.stock_actual, p.stock_minimo, p.unidad, p.activo, p.traducciones, p.orden, p.nuevo, p.recomendado, p.version_grande_id, p.horario, p.combo, p.clase, p.rendimiento, p.para_llevar, actual.id]
      );
      // Si es ingrediente y cambió su costo, se actualiza el costo de los platos que lo usan
      if (Number(p.costo) !== Number(actual.costo)) await recalcularCostosConIngrediente(actual.id);
    });
    res.json({ message: 'Producto actualizado' });
  } catch (err) {
    errorInterno(res, err);
  }
});

// Receta del plato: ingredientes con cantidad, costo de cada uno, costo total y margen
app.get('/api/productos/:id/receta', autenticar, requiere('catalogo', 'reportes.costos'), async (req, res) => {
  try {
    const plato = await get('SELECT id, nombre, precio_venta, costo, clase, rendimiento FROM productos WHERE id = ?', [req.params.id]);
    if (!plato) return res.status(404).json({ error: 'Producto no encontrado' });
    const lineas = await obtenerReceta(plato.id);
    // costo: el del producto (en una sub-receta, por presentación); costo_total: el de toda la receta
    const costo = lineas.length ? costoConReceta(plato, lineas) : Number(plato.costo) || 0;
    const precio = Number(plato.precio_venta) || 0;
    res.json({ plato_id: plato.id, nombre: plato.nombre, clase: plato.clase, rendimiento: plato.rendimiento, precio_venta: precio, lineas, costo,
      costo_total: lineas.length ? costoReceta(lineas) : costo,
      margen: precio > 0 ? Math.round((precio - costo) / precio * 1000) / 10 : null });
  } catch (err) { errorInterno(res, err); }
});

// Reemplaza la receta. body: { lineas: [{ ingrediente_id, cantidad }] } — vacía la quita
app.put('/api/productos/:id/receta', autenticar, requiere('catalogo'), async (req, res) => {
  try {
    const lineas = await transaccion(() => guardarRecetaTx(Number(req.params.id), (req.body || {}).lineas));
    const { costo } = await get('SELECT costo FROM productos WHERE id = ?', [req.params.id]);
    res.json({ lineas, costo: lineas.length ? costo : null, message: lineas.length ? 'Receta guardada' : 'Receta quitada' });
  } catch (err) { errorInterno(res, err); }
});

// Recetario: fichas técnicas de los platos con receta y de las sub-recetas
app.get('/api/recetario', autenticar, requiere('catalogo', 'reportes.costos'), async (req, res) => {
  try { res.json(await recetario()); } catch (err) { errorInterno(res, err); }
});

app.delete('/api/productos/:id', autenticar, requiere('catalogo'), async (req, res) => {
  try {
    await run('UPDATE productos SET activo = 0 WHERE id = ?', [req.params.id]);
    res.json({ message: 'Producto desactivado' });
  } catch (err) {
    errorInterno(res, err);
  }
});

};
