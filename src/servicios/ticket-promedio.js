'use strict';
// Ticket promedio por ticket y por persona, sin que nadie cargue cuántas personas hay: se calcula con lo que se pidió.
// - Cada bebida (café, té, jugo, licuado...) = 1 persona.
// - Cada plato (desayunos, sándwiches, platos, combos...) = 1 persona; si el nombre dice "para 2", "dúo" o "para
//   compartir", cuenta por 2 (o lo que diga "para N").
// - Pastelería, panadería y postres acompañan: no suman personas.
// - Personas del ticket = lo que dé más entre bebidas y platos (mínimo 1). Si hay menos platos que personas (y al menos
//   uno), el ticket queda como "compartido".
// Sin propinas (son del personal). Las ventas sin detalle (sin productos de la carta) no entran en el cálculo por persona.
const { all } = require('../db');
const { LOCAL } = require('../tiempo');

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const sinAcentos = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const BEBIDA = /caf|bebida|infusion|licuad|jugo|exprimid|\bte\b|\btes\b|gaseosa|agua|vino|cerveza|trago|smoothie|limonada|latte|capuccino|espresso/;
const PLATO = /desayun|brunch|sandwich|tostad|plato|principal|combo|promo|almuerzo|cena|ensalad|pasta|pizza|hamburg|milanesa|bowl|tarta|empanad|wrap|minuta|huevo|toast|arepa/;

// Qué es un producto, por su categoría (y si no alcanza, por su nombre)
function clase(categoria, nombre) {
  const c = sinAcentos(categoria);
  if (BEBIDA.test(c)) return 'bebida';
  if (PLATO.test(c)) return 'plato';
  if (c) return 'acompana';
  const n = sinAcentos(nombre);
  return BEBIDA.test(n) ? 'bebida' : PLATO.test(n) ? 'plato' : 'acompana';
}

// Para cuántos es un plato: "para 2", "dúo", "para compartir"
function porciones(nombre) {
  const n = sinAcentos(nombre);
  const m = n.match(/para\s*(\d+)/);
  if (m) return Math.max(1, Math.min(20, Number(m[1])));
  return /\bduo\b|para compartir|compartir/.test(n) ? 2 : 1;
}

function vacio() { return { tickets: 0, ventas: 0, personas: 0, platos: 0, compartidos: 0, sin_detalle: 0 }; }
function cerrar(s) {
  const conPersonas = s.tickets - s.sin_detalle;
  return {
    tickets: s.tickets, ventas: r2(s.ventas), personas: s.personas, platos: r2(s.platos), compartidos: s.compartidos,
    sin_detalle: s.sin_detalle,
    por_ticket: s.tickets ? r2(s.ventas / s.tickets) : 0,
    por_persona: s.personas ? r2(s.ventas_con_personas / s.personas) : 0,
    platos_por_persona: s.personas ? Math.round(s.platos / s.personas * 100) / 100 : 0,
    personas_por_ticket: conPersonas ? Math.round(s.personas / conPersonas * 10) / 10 : 0
  };
}

async function calcular(desde, hasta) {
  const L = LOCAL();
  const filas = await all(`SELECT p.id, p.tipo, p.total, COALESCE(p.propina, 0) AS propina, date(p.cerrado_en, ${L}) AS dia,
      pi.producto_id, pi.nombre_producto, pi.cantidad, c.nombre AS categoria
    FROM pedidos p LEFT JOIN pedido_items pi ON pi.pedido_id = p.id
    LEFT JOIN productos pr ON pr.id = pi.producto_id LEFT JOIN categorias c ON c.id = pr.categoria_id
    WHERE p.estado = 'pagado' AND date(p.cerrado_en, ${L}) BETWEEN ? AND ? ORDER BY p.id`, [desde, hasta]);
  const pedidos = new Map();
  for (const f of filas) {
    const p = pedidos.get(f.id) || { tipo: f.tipo, venta: r2(f.total - f.propina), dia: f.dia, bebidas: 0, platos: 0, comensales: 0, conCarta: false };
    if (f.producto_id) {
      p.conCarta = true;
      const k = clase(f.categoria, f.nombre_producto);
      const cant = Number(f.cantidad) || 0;
      if (k === 'bebida') p.bebidas += cant;
      else if (k === 'plato') { p.platos += cant; p.comensales += cant * porciones(f.nombre_producto); }
    }
    pedidos.set(f.id, p);
  }
  const total = vacio(), salon = vacio(), llevar = vacio();
  const semana = Array.from({ length: 7 }, vacio);
  for (const p of pedidos.values()) {
    const personas = p.conCarta ? Math.max(1, Math.ceil(p.bebidas), Math.ceil(p.comensales)) : 0;
    const dow = new Date(p.dia + 'T12:00:00Z').getUTCDay();
    for (const s of [total, p.tipo === 'salon' ? salon : llevar, semana[dow]]) {
      s.tickets++;
      s.ventas += p.venta;
      if (!p.conCarta) { s.sin_detalle++; continue; }
      s.ventas_con_personas = (s.ventas_con_personas || 0) + p.venta;
      s.personas += personas;
      s.platos += p.platos;
      if (p.platos > 0 && p.comensales < personas) s.compartidos++;
    }
  }
  const NOMBRES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  return {
    total: cerrar(total), salon: cerrar(salon), llevar: cerrar(llevar),
    por_dia_semana: [1, 2, 3, 4, 5, 6, 0].map(d => ({ dia: NOMBRES[d], ...cerrar(semana[d]) })).filter(x => x.tickets)
  };
}

const sumarDias = (fecha, n) => new Date(Date.parse(fecha + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

// El período pedido y el anterior del mismo largo (para comparar: este mes contra el pasado, esta semana contra la otra)
async function ticketPromedio(desde, hasta) {
  const dias = Math.round((Date.parse(hasta) - Date.parse(desde)) / 86400000) + 1;
  const antHasta = sumarDias(desde, -1), antDesde = sumarDias(desde, -dias);
  const [actual, anterior] = await Promise.all([calcular(desde, hasta), calcular(antDesde, antHasta)]);
  return { desde, hasta, ...actual, anterior: { desde: antDesde, hasta: antHasta, ...anterior.total } };
}

module.exports = { ticketPromedio, clase, porciones };
