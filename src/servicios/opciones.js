'use strict';
// Opciones y adicionales de los productos: grupos ("¿Qué leche?", "Adicionales") con sus opciones y precios,
// asignados a los productos. Tipo "una": se elige una (si es obligatoria y no llega, va la primera: así un
// pedido del asistente o de un cliente viejo sigue entrando con la opción de siempre). Tipo "varias": cero o
// más, con tope opcional. El recargo sale siempre de la base (resolverItems), nunca del navegador.
const { run, all, transaccion } = require('../db');
const { errorHttp } = require('../util');
const { normalizarTraducciones, leerTraducciones } = require('../traducciones');

const TIPOS = ['una', 'varias'];
const MAX_OPCIONES = 30;
const MAX_ELEGIDAS = 20;
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

async function listarGrupos({ soloActivos = false } = {}) {
  const grupos = await all(`SELECT * FROM grupos_opciones ${soloActivos ? 'WHERE activo = 1' : ''} ORDER BY orden, id`);
  const opciones = await all('SELECT * FROM opciones WHERE activo = 1 ORDER BY orden, id');
  const asignados = await all('SELECT producto_id, grupo_id FROM producto_grupos ORDER BY orden, grupo_id');
  return grupos.map(g => ({
    id: g.id, nombre: g.nombre, tipo: g.tipo, obligatorio: !!g.obligatorio, maximo: g.maximo, orden: g.orden, activo: !!g.activo,
    traducciones: leerTraducciones(g.traducciones),
    opciones: opciones.filter(o => o.grupo_id === g.id)
      .map(o => ({ id: o.id, nombre: o.nombre, precio: o.precio, traducciones: leerTraducciones(o.traducciones) })),
    productos: asignados.filter(a => a.grupo_id === g.id).map(a => a.producto_id)
  }));
}

async function validarGrupo(b) {
  const nombre = String(b.nombre || '').trim().slice(0, 60);
  if (!nombre) throw errorHttp(400, 'Poné un nombre al grupo (por ejemplo, ¿Qué leche?)');
  const tipo = TIPOS.includes(b.tipo) ? b.tipo : 'una';
  // Solo "elegí una" puede ser obligatoria (siempre tiene una por defecto: la primera)
  const obligatorio = tipo === 'una' && !!b.obligatorio ? 1 : 0;
  const maximo = tipo === 'varias' ? Math.max(0, Math.trunc(Number(b.maximo) || 0)) : 1;
  const lista = Array.isArray(b.opciones) ? b.opciones : [];
  if (!lista.length) throw errorHttp(400, 'El grupo necesita al menos una opción');
  if (lista.length > MAX_OPCIONES) throw errorHttp(400, `Hasta ${MAX_OPCIONES} opciones por grupo`);
  const opciones = lista.map(o => {
    const n = String((o && o.nombre) || '').trim().slice(0, 60);
    const precio = Number((o && o.precio) === '' || (o && o.precio) === undefined ? 0 : o.precio);
    if (!n) throw errorHttp(400, 'Cada opción necesita un nombre');
    if (!Number.isFinite(precio) || precio < 0) throw errorHttp(400, `Precio inválido en "${n}"`);
    return { id: Number(o.id) || null, nombre: n, precio: r2(precio), traducciones: normalizarTraducciones(o.traducciones, ['nombre']) };
  });
  const productos = [...new Set((Array.isArray(b.productos) ? b.productos : []).map(Number).filter(n => Number.isInteger(n) && n > 0))];
  if (productos.length) {
    const ok = await all(`SELECT id FROM productos WHERE id IN (${productos.map(() => '?').join(',')})`, productos);
    if (ok.length !== productos.length) throw errorHttp(400, 'Alguno de los productos no existe');
  }
  return {
    nombre, tipo, obligatorio, maximo, opciones, productos,
    orden: Number.isInteger(Number(b.orden)) ? Number(b.orden) : 0,
    activo: b.activo === undefined ? 1 : (b.activo ? 1 : 0),
    traducciones: normalizarTraducciones(b.traducciones, ['nombre'])
  };
}

// Crea o edita el grupo con sus opciones (las que se sacan quedan inactivas: los pedidos viejos las conservan)
// y los productos que lo usan
async function guardarGrupo(datos, id = null) {
  const g = await validarGrupo(datos || {});
  return transaccion(async () => {
    if (id) {
      const r = await run(`UPDATE grupos_opciones SET nombre = ?, tipo = ?, obligatorio = ?, maximo = ?, orden = ?, activo = ?, traducciones = ?
        WHERE id = ?`, [g.nombre, g.tipo, g.obligatorio, g.maximo, g.orden, g.activo, g.traducciones, id]);
      if (!r.changes) throw errorHttp(404, 'Grupo no encontrado');
    } else {
      id = (await run(`INSERT INTO grupos_opciones (nombre, tipo, obligatorio, maximo, orden, activo, traducciones) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [g.nombre, g.tipo, g.obligatorio, g.maximo, g.orden, g.activo, g.traducciones])).id;
    }
    const actuales = await all('SELECT id FROM opciones WHERE grupo_id = ? AND activo = 1', [id]);
    const quedan = new Set();
    for (const [i, o] of g.opciones.entries()) {
      const existe = o.id && actuales.some(a => a.id === o.id);
      if (existe) {
        await run('UPDATE opciones SET nombre = ?, precio = ?, orden = ?, traducciones = ? WHERE id = ?', [o.nombre, o.precio, i, o.traducciones, o.id]);
        quedan.add(o.id);
      } else {
        await run('INSERT INTO opciones (grupo_id, nombre, precio, orden, traducciones) VALUES (?, ?, ?, ?, ?)', [id, o.nombre, o.precio, i, o.traducciones]);
      }
    }
    for (const a of actuales) if (!quedan.has(a.id)) await run('UPDATE opciones SET activo = 0 WHERE id = ?', [a.id]);
    await run('DELETE FROM producto_grupos WHERE grupo_id = ?', [id]);
    for (const p of g.productos) await run('INSERT INTO producto_grupos (producto_id, grupo_id, orden) VALUES (?, ?, ?)', [p, id, g.orden]);
    return { id };
  });
}

async function borrarGrupo(id) {
  await transaccion(async () => {
    const r = await run('DELETE FROM grupos_opciones WHERE id = ?', [id]);
    if (!r.changes) throw errorHttp(404, 'Grupo no encontrado');
    await run('DELETE FROM producto_grupos WHERE grupo_id = ?', [id]);
    await run('UPDATE opciones SET activo = 0 WHERE grupo_id = ?', [id]);
  });
}

// Grupos (activos, con opciones) de cada producto: { producto_id: [grupo_id, ...] }
async function gruposPorProducto() {
  const filas = await all(`SELECT pg.producto_id, pg.grupo_id FROM producto_grupos pg JOIN grupos_opciones g ON g.id = pg.grupo_id
    WHERE g.activo = 1 AND EXISTS (SELECT 1 FROM opciones o WHERE o.grupo_id = g.id AND o.activo = 1)
    ORDER BY g.orden, g.id`);
  const mapa = {};
  for (const f of filas) (mapa[f.producto_id] = mapa[f.producto_id] || []).push(f.grupo_id);
  return mapa;
}

// Las opciones elegidas para un producto, validadas contra la base. Devuelve [{ id, grupo, nombre, precio }]
async function resolverOpciones(productoId, elegidas) {
  const ids = [...new Set((Array.isArray(elegidas) ? elegidas : []).map(Number))];
  if (ids.some(n => !Number.isInteger(n) || n <= 0) || ids.length > MAX_ELEGIDAS) throw errorHttp(400, 'Opciones inválidas');
  const grupos = await all(`SELECT g.* FROM grupos_opciones g JOIN producto_grupos pg ON pg.grupo_id = g.id
    WHERE pg.producto_id = ? AND g.activo = 1 ORDER BY g.orden, g.id`, [productoId]);
  if (!grupos.length) {
    if (ids.length) throw errorHttp(400, 'Ese producto no tiene opciones');
    return [];
  }
  const opciones = await all(`SELECT * FROM opciones WHERE activo = 1 AND grupo_id IN (${grupos.map(() => '?').join(',')}) ORDER BY orden, id`,
    grupos.map(g => g.id));
  const elegidasOk = ids.map(id => opciones.find(o => o.id === id));
  if (elegidasOk.some(o => !o)) throw errorHttp(400, 'Alguna opción no está disponible para ese producto');
  const resultado = [];
  for (const g of grupos) {
    const delGrupo = elegidasOk.filter(o => o.grupo_id === g.id);
    if (g.tipo === 'una' && delGrupo.length > 1) throw errorHttp(400, `En "${g.nombre}" se elige una sola opción`);
    if (g.tipo === 'varias' && g.maximo > 0 && delGrupo.length > g.maximo) throw errorHttp(400, `En "${g.nombre}" se eligen hasta ${g.maximo}`);
    if (g.tipo === 'una' && g.obligatorio && !delGrupo.length) {
      const porDefecto = opciones.find(o => o.grupo_id === g.id);
      if (porDefecto) delGrupo.push(porDefecto);
    }
    for (const o of delGrupo) resultado.push({ id: o.id, grupo: g.nombre, nombre: o.nombre, precio: r2(o.precio) });
  }
  return resultado;
}

module.exports = { listarGrupos, guardarGrupo, borrarGrupo, gruposPorProducto, resolverOpciones };
