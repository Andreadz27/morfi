'use strict';
// Carta por momentos del día (Desayuno, Brunch, Almuerzo, Merienda...) y destacados.
// Cada momento tiene su horario y sus categorías (una categoría puede estar en varios: los cafés van en el
// desayuno y en la merienda). La carta abre en el momento de la hora del local y muestra los otros a un toque.
// Destacados: "Nuevo" y "Recomendado de la casa" los marca el local en cada producto; "Lo más pedido" sale
// solo de las ventas de las últimas 4 semanas.
const { run, get, all, transaccion } = require('../db');
const { errorHttp } = require('../util');
const { normalizarTraducciones, leerTraducciones } = require('../traducciones');
const { ahoraLocal } = require('./cierre-dia');

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_MOMENTOS = 8;
const DIAS_MAS_PEDIDO = 28;
const MAS_PEDIDO_CANTIDAD = 6;   // cuántos productos llevan "Lo más pedido"
const MAS_PEDIDO_MINIMO = 3;     // unidades vendidas como mínimo (con pocas ventas no se marca nada)

async function listarMomentos({ soloActivos = false } = {}) {
  const momentos = await all(`SELECT * FROM momentos_carta ${soloActivos ? 'WHERE activo = 1' : ''} ORDER BY orden, desde, id`);
  const rel = await all('SELECT momento_id, categoria_id FROM momento_categorias ORDER BY orden, categoria_id');
  return momentos.map(m => ({
    id: m.id, nombre: m.nombre, icono: m.icono || '', desde: m.desde, hasta: m.hasta, orden: m.orden, activo: !!m.activo,
    traducciones: leerTraducciones(m.traducciones),
    categorias: rel.filter(r => r.momento_id === m.id).map(r => r.categoria_id)
  }));
}

async function validarMomento(b) {
  const nombre = String(b.nombre || '').trim().slice(0, 40);
  if (!nombre) throw errorHttp(400, 'Poné un nombre al momento (por ejemplo, Desayuno)');
  if (!HORA.test(String(b.desde || '')) || !HORA.test(String(b.hasta || ''))) throw errorHttp(400, 'Horario inválido (HH:MM)');
  if (b.hasta <= b.desde) throw errorHttp(400, 'La hora de fin tiene que ser después de la de inicio');
  const ids = [...new Set((Array.isArray(b.categorias) ? b.categorias : []).map(Number).filter(n => Number.isInteger(n) && n > 0))];
  if (!ids.length) throw errorHttp(400, 'Elegí al menos una categoría para el momento');
  const existentes = await all(`SELECT id FROM categorias WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  if (existentes.length !== ids.length) throw errorHttp(400, 'Alguna de las categorías no existe');
  return {
    nombre, desde: b.desde, hasta: b.hasta, categorias: ids,
    icono: String(b.icono || '').slice(0, 8),
    orden: Number.isInteger(Number(b.orden)) ? Number(b.orden) : 0,
    activo: b.activo === undefined ? 1 : (b.activo ? 1 : 0),
    traducciones: normalizarTraducciones(b.traducciones, ['nombre'])
  };
}

async function guardarMomento(datos, id = null) {
  const m = await validarMomento(datos || {});
  return transaccion(async () => {
    if (id) {
      const r = await run(`UPDATE momentos_carta SET nombre = ?, icono = ?, desde = ?, hasta = ?, orden = ?, activo = ?, traducciones = ?
        WHERE id = ?`, [m.nombre, m.icono, m.desde, m.hasta, m.orden, m.activo, m.traducciones, id]);
      if (!r.changes) throw errorHttp(404, 'Momento no encontrado');
      await run('DELETE FROM momento_categorias WHERE momento_id = ?', [id]);
    } else {
      if ((await get('SELECT COUNT(*) AS n FROM momentos_carta')).n >= MAX_MOMENTOS) throw errorHttp(400, `Hasta ${MAX_MOMENTOS} momentos`);
      id = (await run(`INSERT INTO momentos_carta (nombre, icono, desde, hasta, orden, activo, traducciones) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [m.nombre, m.icono, m.desde, m.hasta, m.orden, m.activo, m.traducciones])).id;
    }
    for (const [i, c] of m.categorias.entries())
      await run('INSERT INTO momento_categorias (momento_id, categoria_id, orden) VALUES (?, ?, ?)', [id, c, i]);
    return { id };
  });
}

async function borrarMomento(id) {
  await transaccion(async () => {
    await run('DELETE FROM momento_categorias WHERE momento_id = ?', [id]);
    const r = await run('DELETE FROM momentos_carta WHERE id = ?', [id]);
    if (!r.changes) throw errorHttp(404, 'Momento no encontrado');
  });
}

// El momento de la hora: si se superponen (Desayuno hasta las 12, Brunch desde las 11), el que empezó último
function momentoActual(momentos, hora = ahoraLocal().hora) {
  const vigentes = momentos.filter(m => m.desde <= hora && hora < m.hasta);
  return vigentes.length ? vigentes.sort((a, b) => b.desde.localeCompare(a.desde))[0].id : null;
}

async function masPedidos() {
  const filas = await all(`SELECT i.producto_id, SUM(i.cantidad) AS cantidad FROM pedido_items i JOIN pedidos p ON p.id = i.pedido_id
    WHERE p.estado = 'pagado' AND p.cerrado_en >= datetime('now', ?) AND i.producto_id IS NOT NULL
    GROUP BY i.producto_id HAVING SUM(i.cantidad) >= ? ORDER BY cantidad DESC LIMIT ?`,
  [`-${DIAS_MAS_PEDIDO} days`, MAS_PEDIDO_MINIMO, MAS_PEDIDO_CANTIDAD]);
  return new Set(filas.map(f => f.producto_id));
}

// Lo que suma la carta pública: momentos (solo con categorías que tienen productos), el actual y destacados
async function cartaPorMomentos(categoriasVisibles, productos) {
  const conProductos = new Set(categoriasVisibles.map(c => c.id));
  const momentos = (await listarMomentos({ soloActivos: true }))
    .map(m => ({ id: m.id, nombre: m.nombre, icono: m.icono, desde: m.desde, hasta: m.hasta, traducciones: m.traducciones,
      categorias: m.categorias.filter(c => conProductos.has(c)) }))
    .filter(m => m.categorias.length);
  const top = await masPedidos();
  for (const p of productos) {
    p.nuevo = !!p.nuevo;
    p.recomendado = !!p.recomendado;
    p.mas_pedido = top.has(p.id);
  }
  return { momentos, momento_actual: momentoActual(momentos) };
}

module.exports = { listarMomentos, guardarMomento, borrarMomento, momentoActual, masPedidos, cartaPorMomentos };
