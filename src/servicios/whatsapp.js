'use strict';
// WhatsApp Business (API oficial de Meta, "Cloud API"): avisos al cliente con plantillas aprobadas.
// - Comprobante después de cobrar (lo manda el mozo o la caja)
// - Pedido listo para retirar (al marcarlo en cocina) y pedido en camino (delivery)
// - Recordatorio de reservas unas horas antes
// Meta solo deja iniciar conversaciones con plantillas aprobadas en WhatsApp Manager: los nombres se configuran
// en Integraciones → WhatsApp. Cada envío queda en whatsapp_mensajes con su estado (enviado, entregado, leído).
const crypto = require('crypto');
const { run, get, all } = require('../db');
const { emitEvento } = require('../realtime');
const { offsetZonaMin } = require('../tiempo');
const { getIntCfg } = require('./integraciones');
const { tiene, errorPlan, estadoLicencia } = require('../licencia');
// Se carga al usarlo: el asistente usa pedidos, que a su vez avisan por WhatsApp
const asistente = () => require('./asistente');

// GM_WA_API_URL: API de Meta alternativa (los tests usan una simulada)
const API_WA = (process.env.GM_WA_API_URL || 'https://graph.facebook.com').replace(/\/$/, '');
const VERSION_API = 'v21.0';

const PLANTILLAS_POR_DEFECTO = {
  comprobante: 'comprobante_compra',
  pedido_estado: 'estado_pedido',
  recordatorio_reserva: 'recordatorio_reserva',
  resumen_diario: 'resumen_diario'
};

async function configWhatsApp() {
  const cfg = await getIntCfg('whatsapp');
  return { ...cfg, plantillas: { ...PLANTILLAS_POR_DEFECTO, ...(cfg.plantillas || {}) }, idioma: cfg.idioma || 'es_AR' };
}
const listo = cfg => !!(cfg.activa && cfg.phone_number_id && cfg.access_token);

// Teléfono argentino → formato internacional de WhatsApp (549 + característica + número, sin 0 ni 15).
// Acepta "011 15-1234-5678", "+54 9 11 1234-5678", "1112345678"... Devuelve null si no se puede interpretar.
function normalizarTelefono(tel) {
  let d = String(tel || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('54')) {
    d = d.slice(2);
    if (d.startsWith('9')) d = d.slice(1);
  }
  if (d.startsWith('0')) d = d.slice(1);
  // Con el 15 de celular: característica de 2 a 4 dígitos + 15 + número (quedan 12 dígitos)
  if (d.length === 12) {
    for (const largo of [2, 3, 4]) {
      if (d.slice(largo, largo + 2) === '15') { d = d.slice(0, largo) + d.slice(largo + 2); break; }
    }
  }
  return d.length === 10 ? '549' + d : null;
}

async function waRequest(cfg, body) {
  const r = await fetch(`${API_WA}/${VERSION_API}/${encodeURIComponent(cfg.phone_number_id)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = data.error || {};
    throw new Error(`WhatsApp ${r.status}: ${e.error_user_msg || e.message || 'error'}${e.code ? ` (código ${e.code})` : ''}`);
  }
  return data;
}

// Envía una plantilla y deja registro. motivo + referencia identifican el aviso (ej. pedido_listo, 15):
// con unico = true no se manda dos veces el mismo aviso automático.
const enCurso = new Set();
async function enviarPlantilla({ telefono, plantilla, parametros = [], motivo, referencia = null, unico = false, cfg }) {
  // Los avisos por WhatsApp son del plan Pro (el asistente contesta con enviarTexto: es un extra aparte)
  if (!(await tiene('whatsapp'))) throw errorPlan('whatsapp', await estadoLicencia());
  cfg = cfg || await configWhatsApp();
  if (!listo(cfg)) throw Object.assign(new Error('WhatsApp no está configurado o activo (Integraciones → WhatsApp).'), { status: 400 });
  const destino = normalizarTelefono(telefono);
  if (!destino) throw Object.assign(new Error('El teléfono no es válido (ej: 11 1234-5678 con característica).'), { status: 400 });

  const clave = `${motivo}:${referencia}`;
  if (unico) {
    if (enCurso.has(clave)) return null;
    // Se marca ANTES de consultar la base: si se marcaba después, dos pasadas a la vez (dos recordatorios, o
    // "listo" tocado dos veces) pasaban las dos el control y el cliente recibía el mismo mensaje dos veces
    enCurso.add(clave);
    let ya;
    try { ya = await get("SELECT id FROM whatsapp_mensajes WHERE motivo = ? AND referencia = ? AND estado != 'error'", [motivo, referencia]); }
    catch (e) { enCurso.delete(clave); throw e; }
    if (ya) { enCurso.delete(clave); return null; }
  }
  let id;
  try {
    ({ id } = await run(
      `INSERT INTO whatsapp_mensajes (telefono, plantilla, motivo, referencia, parametros, estado)
       VALUES (?, ?, ?, ?, ?, 'enviando')`, [destino, plantilla, motivo, referencia, JSON.stringify(parametros)]));
  } catch (e) {
    if (unico) enCurso.delete(clave);
    throw e;
  }
  try {
    const r = await waRequest(cfg, {
      messaging_product: 'whatsapp',
      to: destino,
      type: 'template',
      template: {
        name: plantilla,
        language: { code: cfg.idioma },
        ...(parametros.length ? { components: [{ type: 'body', parameters: parametros.map(t => ({ type: 'text', text: String(t) })) }] } : {})
      }
    });
    const waId = (r.messages && r.messages[0] && r.messages[0].id) || '';
    await run("UPDATE whatsapp_mensajes SET estado = 'enviado', wa_message_id = ? WHERE id = ?", [waId, id]);
    emitEvento('whatsapp:mensaje', { id, motivo, estado: 'enviado' });
    return { id, telefono: destino, wa_message_id: waId };
  } catch (e) {
    await run("UPDATE whatsapp_mensajes SET estado = 'error', error = ? WHERE id = ?", [String(e.message).slice(0, 500), id]);
    throw e;
  } finally {
    if (unico) enCurso.delete(clave);
  }
}

// Mensaje de texto libre (lo usa el asistente). Meta lo permite solo dentro de las 24 h desde el último mensaje
// del cliente: el asistente siempre contesta a un mensaje recién llegado.
async function enviarTexto({ telefono, texto, motivo = 'asistente', cfg }) {
  cfg = cfg || await configWhatsApp();
  if (!listo(cfg)) throw Object.assign(new Error('WhatsApp no está configurado o activo (Integraciones → WhatsApp).'), { status: 400 });
  const destino = normalizarTelefono(telefono) || String(telefono || '').replace(/\D/g, '');
  if (!destino) throw Object.assign(new Error('Teléfono inválido'), { status: 400 });
  const cuerpo = String(texto || '').slice(0, 4000);
  const { id } = await run(`INSERT INTO whatsapp_mensajes (telefono, plantilla, motivo, parametros, estado)
    VALUES (?, '', ?, ?, 'enviando')`, [destino, motivo, JSON.stringify([cuerpo.slice(0, 1000)])]);
  try {
    const r = await waRequest(cfg, { messaging_product: 'whatsapp', to: destino, type: 'text', text: { body: cuerpo, preview_url: false } });
    const waId = (r.messages && r.messages[0] && r.messages[0].id) || '';
    await run("UPDATE whatsapp_mensajes SET estado = 'enviado', wa_message_id = ? WHERE id = ?", [waId, id]);
    emitEvento('whatsapp:mensaje', { id, motivo, estado: 'enviado' });
    return { id, wa_message_id: waId };
  } catch (e) {
    await run("UPDATE whatsapp_mensajes SET estado = 'error', error = ? WHERE id = ?", [String(e.message).slice(0, 500), id]);
    throw e;
  }
}

const moneda = n => '$ ' + new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(Number(n) || 0);
const nombreNegocio = async () => ((await get('SELECT nombre_negocio FROM configuracion WHERE id = 1')) || {}).nombre_negocio || 'el local';

// Comprobante de un pedido cobrado: {{1}} cliente, {{2}} negocio, {{3}} total, {{4}} comprobante
async function enviarComprobante(pedidoId, telefono) {
  const pedido = await get('SELECT * FROM pedidos WHERE id = ?', [pedidoId]);
  if (!pedido) throw Object.assign(new Error('Pedido no encontrado'), { status: 404 });
  if (pedido.estado !== 'pagado') throw Object.assign(new Error('El pedido todavía no está cobrado'), { status: 400 });
  const factura = await get(`SELECT * FROM comprobantes_afip f WHERE f.pedido_id = ? AND f.tipo_comprobante IN (1, 6, 11)
    AND NOT EXISTS (SELECT 1 FROM comprobantes_afip nc WHERE nc.comprobante_asociado_id = f.id) ORDER BY f.id DESC LIMIT 1`, [pedidoId]);
  const comprobante = factura
    ? `${factura.tipo_comprobante_nombre} ${String(factura.punto_venta).padStart(4, '0')}-${String(factura.numero_comprobante).padStart(8, '0')} (CAE ${factura.cae})`
    : `Pedido ${pedido.numero_pedido}`;
  const cfg = await configWhatsApp();
  return enviarPlantilla({
    cfg, telefono, plantilla: cfg.plantillas.comprobante, motivo: 'comprobante', referencia: pedidoId,
    parametros: [pedido.cliente || 'cliente', await nombreNegocio(), moneda(pedido.total), comprobante]
  });
}

// ----- Aviso "tu pedido está listo" pedido por el cliente (barra y autoservicio desde la mesa) -----
// El cliente toca "Avisame por WhatsApp": se abre su WhatsApp con un mensaje ya escrito para el número del local
// ("Avisame cuando esté listo mi pedido #12 (clave a3f9)"). Como escribió él primero, Meta deja contestarle con texto
// libre durante 24 h sin plantilla aprobada y sin costo (conversación de servicio). La clave (4 letras del código del
// pedido) evita que alguien se anote al pedido de otro escribiendo solo el número.
const RE_ANOTARSE = /pedido\s*#?\s*(\d{1,5})\b[^a-f0-9]*\(?\s*clave\s*([a-f0-9]{4})\b/i;
const claveAviso = codigo => String(codigo || '').slice(-4);

// Número de WhatsApp del local para el link (el de Integraciones → WhatsApp; si no, el teléfono del negocio)
async function numeroAvisos(cfg) {
  cfg = cfg || await configWhatsApp();
  if (!listo(cfg)) return '';
  const tel = cfg.numero || ((await get('SELECT telefono FROM configuracion WHERE id = 1')) || {}).telefono;
  return normalizarTelefono(tel) || '';
}

// Mensaje entrante: si es un pedido de aviso, se anota el teléfono al pedido y se contesta. Devuelve true si lo era.
async function anotarAvisoListo(telefono, texto) {
  const m = RE_ANOTARSE.exec(String(texto || ''));
  if (!m) return false;
  const numero = String(Number(m[1]));
  const clave = m[2].toLowerCase();
  const candidatos = await all(`SELECT id, numero_pedido, codigo_cliente, listo_en, retirado_en, lugar FROM pedidos
    WHERE codigo_cliente IS NOT NULL AND estado IN ('abierto', 'pagado') AND retirado_en IS NULL
      AND creado_en >= datetime('now', '-12 hours') ORDER BY id DESC`);
  const p = candidatos.find(c => claveAviso(c.codigo_cliente) === clave && String(c.numero_pedido).split('-').pop().replace(/^0+(?=\d)/, '') === numero);
  const enviar = t => enviarTexto({ telefono, texto: t, motivo: 'aviso_retiro' }).catch(e => console.error('[WhatsApp aviso de retiro]', e.message));
  if (!p) {
    await enviar('No encontramos ese pedido. Revisá el número en la pantalla de tu pedido o preguntá en el mostrador.');
    return true;
  }
  await run('UPDATE pedidos SET telefono_aviso = ? WHERE id = ?', [String(telefono), p.id]);
  emitEvento('retiro:actualizar', { pedido_id: p.id });
  await enviar(p.listo_en
    ? `¡Tu pedido #${numero} ya está listo! Retiralo en el mostrador de ${await nombreNegocio()}.`
    : `¡Listo! Te avisamos por acá cuando tu pedido #${numero} esté para retirar en el mostrador.`);
  return true;
}

// Cocina lo marcó listo o la caja lo vuelve a llamar. Nunca rechaza (se llama sin await).
async function avisarRetiroWhatsApp(pedidoId, { otraVez = false } = {}) {
  try {
    const p = await get('SELECT numero_pedido, telefono_aviso, lugar FROM pedidos WHERE id = ?', [pedidoId]);
    if (!p || !p.telefono_aviso) return null;
    const numero = String(p.numero_pedido).split('-').pop().replace(/^0+(?=\d)/, '');
    const negocio = await nombreNegocio();
    return await enviarTexto({ telefono: p.telefono_aviso, motivo: 'aviso_retiro', texto: otraVez
      ? `🔔 Te estamos esperando: tu pedido #${numero} está listo en el mostrador de ${negocio}.`
      : `🔔 ¡Tu pedido #${numero} está listo! Pasá a retirarlo por el mostrador de ${negocio}. Decí tu número al retirar.` });
  } catch (e) { console.error('[WhatsApp aviso de retiro]', e.message); return null; }
}

// Aviso de estado de pedido: {{1}} cliente, {{2}} número, {{3}} negocio, {{4}} "listo para retirar" / "en camino".
// Automático y sin repetir; si falla solo queda en el registro (no corta la operación de cocina o delivery).
// Se llama sin await: nunca rechaza (una promesa rechazada sin manejar tira el proceso en pleno servicio).
function avisarEstadoPedido(pedidoId, estado) {
  return avisarEstadoPedidoSinCapturar(pedidoId, estado)
    .catch(e => { console.error('[WhatsApp aviso de pedido]', e.message); return null; });
}

async function avisarEstadoPedidoSinCapturar(pedidoId, estado) {
  const cfg = await configWhatsApp();
  if (!listo(cfg) || !cfg.avisar_pedidos) return null;
  const pedido = await get(`SELECT p.*, e.telefono AS telefono_entrega FROM pedidos p
    LEFT JOIN entregas e ON e.pedido_id = p.id WHERE p.id = ?`, [pedidoId]);
  if (!pedido || !pedido.telefono_entrega || !normalizarTelefono(pedido.telefono_entrega)) return null;
  const texto = { listo: 'listo para retirar', en_camino: 'en camino' }[estado];
  if (!texto) return null;
  return enviarPlantilla({
    cfg, telefono: pedido.telefono_entrega, plantilla: cfg.plantillas.pedido_estado, unico: true,
    motivo: `pedido_${estado}`, referencia: pedidoId,
    parametros: [pedido.cliente || 'cliente', pedido.numero_pedido, await nombreNegocio(), texto]
  }).catch(e => { console.error('[WhatsApp aviso de pedido]', e.message); return null; });
}

// Recordatorio de las reservas confirmadas que empiezan dentro de las próximas N horas (hora del negocio):
// {{1}} cliente, {{2}} negocio, {{3}} fecha, {{4}} hora, {{5}} personas
async function enviarRecordatoriosReservas() {
  const cfg = await configWhatsApp();
  const horas = Number(cfg.recordatorio_horas) || 0;
  if (!listo(cfg) || horas <= 0 || !(await tiene('whatsapp'))) return 0;
  const local = ms => new Date(ms + offsetZonaMin() * 60000).toISOString().slice(0, 16).replace('T', ' ');
  const ahora = local(Date.now());
  const hasta = local(Date.now() + horas * 3600e3);
  const reservas = await all(`
    SELECT r.* FROM reservas r
    WHERE r.estado = 'confirmada' AND r.telefono != '' AND (r.fecha || ' ' || r.hora) > ? AND (r.fecha || ' ' || r.hora) <= ?
      AND NOT EXISTS (SELECT 1 FROM whatsapp_mensajes w WHERE w.motivo = 'recordatorio_reserva' AND w.referencia = r.id AND w.estado != 'error')`,
    [ahora, hasta]);
  const negocio = await nombreNegocio();
  let enviados = 0;
  for (const r of reservas) {
    if (!normalizarTelefono(r.telefono)) continue;
    const [a, m, d] = r.fecha.split('-');
    const ok = await enviarPlantilla({
      cfg, telefono: r.telefono, plantilla: cfg.plantillas.recordatorio_reserva, unico: true,
      motivo: 'recordatorio_reserva', referencia: r.id,
      parametros: [r.cliente, negocio, `${d}/${m}/${a}`, r.hora, String(r.personas || 2)]
    }).catch(e => { console.error('[WhatsApp recordatorio]', e.message); return null; });
    if (ok) enviados++;
  }
  return enviados;
}

// Revisa las reservas cada 5 minutos (GM_WA_INTERVALO_MS en los tests)
function iniciarRecordatoriosWhatsApp() {
  const ms = Number(process.env.GM_WA_INTERVALO_MS) || 5 * 60 * 1000;
  const revisar = () => enviarRecordatoriosReservas().catch(e => console.error('[WhatsApp recordatorios]', e.message));
  setInterval(revisar, ms).unref();
}

// ---------- Webhook de Meta ----------
// Firma: X-Hub-Signature-256 = sha256 HMAC del cuerpo crudo con el "secreto de la app". Sin secreto no se acepta nada.
function firmaValida(cfg, cuerpoCrudo, firma) {
  if (!cfg.app_secret || !cuerpoCrudo || !firma) return false;
  const esperada = 'sha256=' + crypto.createHmac('sha256', cfg.app_secret).update(cuerpoCrudo).digest('hex');
  const a = Buffer.from(esperada), b = Buffer.from(String(firma));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const ESTADOS_META = { sent: 'enviado', delivered: 'entregado', read: 'leido', failed: 'error' };
const ORDEN_ESTADO = { enviando: 0, enviado: 1, entregado: 2, leido: 3 };

// Estados de los mensajes enviados y mensajes que escriben los clientes (quedan para responder; si el asistente IA está activo, los contesta)
async function procesarWebhook(body) {
  for (const entrada of [].concat((body && body.entry) || [])) {
    for (const cambio of [].concat(entrada.changes || [])) {
      const v = cambio.value || {};
      for (const st of [].concat(v.statuses || [])) {
        const estado = ESTADOS_META[st.status];
        if (!estado || !st.id) continue;
        const msg = await get('SELECT id, estado FROM whatsapp_mensajes WHERE wa_message_id = ?', [String(st.id)]);
        // Meta puede mandar los estados desordenados: "entregado" no pisa a "leído"
        if (!msg || (estado !== 'error' && (ORDEN_ESTADO[estado] || 0) <= (ORDEN_ESTADO[msg.estado] || 0))) continue;
        const error = estado === 'error' ? [].concat(st.errors || []).map(e => e.title || e.message).join('; ') : null;
        await run('UPDATE whatsapp_mensajes SET estado = ?, error = COALESCE(?, error) WHERE id = ?', [estado, error, msg.id]);
      }
      const contactos = Object.fromEntries([].concat(v.contacts || []).map(c => [c.wa_id, (c.profile && c.profile.name) || '']));
      for (const m of [].concat(v.messages || [])) {
        if (!m.id || await get('SELECT 1 AS x FROM whatsapp_entrantes WHERE wa_message_id = ?', [String(m.id)])) continue;
        const texto = (m.text && m.text.body) || (m.button && m.button.text) || `[${m.type || 'mensaje'}]`;
        await run('INSERT INTO whatsapp_entrantes (wa_message_id, telefono, nombre, texto) VALUES (?, ?, ?, ?)',
          [String(m.id), String(m.from || ''), contactos[m.from] || '', String(texto).slice(0, 2000)]);
        emitEvento('whatsapp:entrante', { telefono: m.from, nombre: contactos[m.from] || '', texto: String(texto).slice(0, 200) });
        // "Avisame cuando esté listo mi pedido #12": lo contesta Fadido (no el asistente)
        if (m.from && await anotarAvisoListo(String(m.from), texto)) continue;
        // Asistente IA (si está activo): contesta en segundo plano; no a mensajes viejos (Meta reintenta tras un corte)
        const reciente = !m.timestamp || Date.now() / 1000 - Number(m.timestamp) < 30 * 60;
        if (reciente && m.from && await tiene('asistente')) {
          const tipo = m.type === 'text' || m.type === 'button' || !m.type ? 'text' : m.type;
          asistente().atender({ telefono: String(m.from), nombre: contactos[m.from] || '', texto, tipo },
            { enviar: t => enviarTexto({ telefono: String(m.from), texto: t }) });
        }
      }
    }
  }
}

module.exports = {
  normalizarTelefono, configWhatsApp, enviarPlantilla, enviarTexto, enviarComprobante, avisarEstadoPedido, whatsappListo: listo,
  enviarRecordatoriosReservas, iniciarRecordatoriosWhatsApp, firmaValida, procesarWebhook, PLANTILLAS_POR_DEFECTO,
  claveAviso, numeroAvisos, anotarAvisoListo, avisarRetiroWhatsApp
};
