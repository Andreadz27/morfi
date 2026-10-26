'use strict';
// Venta cruzada: datos que usan la carta y el punto de venta para sugerir.
// - Categorías: con qué se sugiere cada una ("Acompañalo con…": a los cafés, laminados y pastelería).
// - Productos: su versión grande ("¿Lo querés grande?"), su horario (las promos de 8 a 12) y, si es un combo,
//   qué incluye (Promo 1 = 1 café + 2 medialunas), para avisar "te conviene la promo" cuando se arma suelto.
// El horario se hace cumplir en los pedidos del cliente (QR, online, asistente); en el punto de venta solo avisa.
const { get, all } = require('../db');
const { errorHttp } = require('../util');
const { ahoraLocal } = require('./cierre-dia');

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const DIAS_TXT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const leerJSON = t => { try { const v = t ? JSON.parse(t) : null; return v && typeof v === 'object' ? v : null; } catch (e) { return null; } };
const enteros = lista => [...new Set((Array.isArray(lista) ? lista : String(lista || '').split(',')).map(Number).filter(n => Number.isInteger(n) && n > 0))];

// Horario de un producto: { dias: [0..6], desde, hasta } o null (siempre disponible)
function validarHorario(h) {
  if (h === null || h === undefined || h === '') return null;
  const v = typeof h === 'string' ? leerJSON(h) : h;
  if (!v || typeof v !== 'object') throw errorHttp(400, 'Horario inválido');
  const dias = [...new Set((Array.isArray(v.dias) ? v.dias : []).map(Number))].filter(d => Number.isInteger(d) && d >= 0 && d <= 6).sort();
  if (!dias.length) throw errorHttp(400, 'Elegí al menos un día del horario');
  if (!HORA.test(String(v.desde || '')) || !HORA.test(String(v.hasta || '')) || v.hasta <= v.desde) throw errorHttp(400, 'Horario inválido (HH:MM, el fin después del inicio)');
  return JSON.stringify({ dias, desde: v.desde, hasta: v.hasta });
}

function disponibleAhora(horario, ahora = ahoraLocal()) {
  const h = typeof horario === 'string' ? leerJSON(horario) : horario;
  if (!h) return true;
  return h.dias.includes(ahora.dia) && h.desde <= ahora.hora && ahora.hora < h.hasta;
}

function textoHorario(horario) {
  const h = typeof horario === 'string' ? leerJSON(horario) : horario;
  if (!h) return '';
  const consecutivos = h.dias.length > 2 && h.dias.every((d, i) => i === 0 || d === h.dias[i - 1] + 1);
  const dias = h.dias.length === 7 ? 'todos los días' : consecutivos ? `de ${DIAS_TXT[h.dias[0]]} a ${DIAS_TXT[h.dias[h.dias.length - 1]]}` : h.dias.map(d => DIAS_TXT[d]).join(', ');
  return `${dias} de ${h.desde} a ${h.hasta}`;
}

// Qué incluye un combo: { componentes: [{ productos: [ids], cantidad }] } (cada componente: "1 café" = cualquiera de esos)
async function validarCombo(c, productoId = null) {
  if (c === null || c === undefined || c === '') return null;
  const v = typeof c === 'string' ? leerJSON(c) : c;
  const lista = v && Array.isArray(v.componentes) ? v.componentes : null;
  if (!lista || !lista.length) return null;
  if (lista.length > 8) throw errorHttp(400, 'Hasta 8 componentes por combo');
  const componentes = lista.map(x => ({ productos: enteros(x && x.productos), cantidad: x && x.cantidad !== undefined ? Math.trunc(Number(x.cantidad)) : 1 }));
  if (componentes.some(x => !x.productos.length || !(x.cantidad >= 1) || x.cantidad > 10)) throw errorHttp(400, 'Cada parte del combo necesita productos y una cantidad de 1 a 10');
  const todos = [...new Set(componentes.flatMap(x => x.productos))];
  if (productoId && todos.includes(Number(productoId))) throw errorHttp(400, 'Un combo no puede incluirse a sí mismo');
  const ok = await all(`SELECT id FROM productos WHERE id IN (${todos.map(() => '?').join(',')})`, todos);
  if (ok.length !== todos.length) throw errorHttp(400, 'Algún producto del combo no existe');
  return JSON.stringify({ componentes });
}

async function validarVersionGrande(id, productoId = null) {
  if (id === null || id === undefined || id === '' || Number(id) === 0) return null;
  const n = Number(id);
  if (!Number.isInteger(n) || n === Number(productoId)) throw errorHttp(400, 'Versión grande inválida');
  if (!(await get('SELECT id FROM productos WHERE id = ?', [n]))) throw errorHttp(400, 'La versión grande no existe');
  return n;
}

// Con qué categorías se sugiere una categoría ("Acompañalo con…")
async function validarSugerir(lista, categoriaId = null) {
  const ids = enteros(lista).filter(n => n !== Number(categoriaId));
  if (!ids.length) return '';
  const ok = await all(`SELECT id FROM categorias WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  if (ok.length !== ids.length) throw errorHttp(400, 'Alguna categoría para sugerir no existe');
  return ids.join(',');
}

// Pedidos del cliente: un producto con horario (las promos de 8 a 12) solo se pide en ese horario
async function controlarHorarios(items, ahora = ahoraLocal()) {
  const ids = [...new Set(items.map(i => Number(i.producto_id)))];
  if (!ids.length) return;
  const filas = await all(`SELECT nombre, horario FROM productos WHERE id IN (${ids.map(() => '?').join(',')}) AND horario != ''`, ids);
  const fuera = filas.find(p => !disponibleAhora(p.horario, ahora));
  if (fuera) throw errorHttp(400, `${fuera.nombre} se pide ${textoHorario(fuera.horario)}`);
}

module.exports = {
  validarHorario, disponibleAhora, textoHorario, validarCombo, validarVersionGrande, validarSugerir, controlarHorarios, leerJSON
};
