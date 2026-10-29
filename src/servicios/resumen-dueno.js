'use strict';
// Resumen de cada noche por WhatsApp al dueño: al cerrar el día (automático o a mano) le llega cuánto vendió,
// cuánto ganó, lo más vendido y lo que hay que mirar (stock bajo, caja sin contar, facturas en espera).
// Se configura en Integraciones → WhatsApp ("WhatsApp del dueño"). Es un mensaje que inicia el local, por eso
// Meta exige una plantilla aprobada (categoría Utilidad): {{1}} negocio, {{2}} fecha, {{3}} ventas, {{4}} tickets,
// {{5}} ganancia, {{6}} lo más vendido, {{7}} para mirar. Un cierre repetido del mismo día no lo manda dos veces.
const { get } = require('../db');
const { alEvento } = require('../realtime');
const { configWhatsApp, enviarPlantilla, whatsappListo } = require('./whatsapp');

const plata = n => '$ ' + new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(Math.round(Number(n) || 0));
const fechaCorta = f => f.split('-').reverse().slice(0, 2).join('/');

async function textoResumen(fecha) {
  const c = await get('SELECT resumen FROM cierres_dia WHERE fecha = ?', [fecha]);
  if (!c) return null;
  const r = JSON.parse(c.resumen);
  let ganancia = null;
  try {
    const g = await require('./ganancias').resumenGanancias({ desde: fecha, hasta: fecha });
    ganancia = g.totales && g.totales.ganancia;
  } catch (e) { /* sin costos cargados: va sin ganancia */ }
  const top = (r.ventas.mas_vendidos || []).slice(0, 3).map(p => `${p.nombre} (${p.cantidad})`).join(', ') || 'sin ventas';
  const mirar = [
    r.stock_bajo && r.stock_bajo.length ? `stock bajo: ${r.stock_bajo.slice(0, 3).map(s => s.nombre).join(', ')}` : '',
    r.pendientes.cajas_sin_contar.length ? 'falta contar el efectivo' : '',
    r.pendientes.facturas_en_espera ? `${r.pendientes.facturas_en_espera} facturas en espera` : '',
    r.pendientes.pedidos_abiertos.length ? `${r.pendientes.pedidos_abiertos.length} pedidos sin cerrar` : ''
  ].filter(Boolean).join('; ') || 'todo en orden';
  const variacion = r.comparacion && r.comparacion.variacion !== null ? ` (${r.comparacion.variacion > 0 ? '+' : ''}${r.comparacion.variacion}% vs. el mismo día de la semana pasada)` : '';
  return [fechaCorta(fecha), plata(r.ventas.total) + variacion, String(r.ventas.tickets),
    ganancia === null ? 'cargá los costos para verla' : plata(ganancia), top, mirar];
}

async function enviarResumenDueno(fecha) {
  const cfg = await configWhatsApp();
  if (!whatsappListo(cfg) || !cfg.telefono_dueno) return null;
  const partes = await textoResumen(fecha);
  if (!partes) return null;
  const negocio = ((await get('SELECT nombre_negocio FROM configuracion WHERE id = 1')) || {}).nombre_negocio || 'tu local';
  return enviarPlantilla({
    cfg, telefono: cfg.telefono_dueno, plantilla: cfg.plantillas.resumen_diario, unico: true,
    motivo: 'resumen_diario', referencia: Number(fecha.replace(/-/g, '')), parametros: [negocio, ...partes]
  }).catch(e => { console.error('[Resumen al dueño]', e.message); return null; });
}

function iniciarResumenDueno() {
  alEvento('cierre:hecho', d => d && d.fecha && enviarResumenDueno(d.fecha));
}

module.exports = { iniciarResumenDueno, enviarResumenDueno, textoResumen };
