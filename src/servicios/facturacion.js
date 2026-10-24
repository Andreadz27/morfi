'use strict';
// Factura electrónica AFIP/ARCA: facturas, notas de crédito y consulta del padrón.
// La usan las rutas de integraciones y el cobro en la mesa (cobrar y facturar en un solo paso).
const Afip = require('@afipsdk/afip.js');
const { run, get } = require('../db');
const { emitEvento } = require('../realtime');
const { fechaLocal } = require('../tiempo');
const { errorHttp } = require('../util');
const { getIntCfg } = require('./integraciones');

const NOMBRES_COMPROBANTE = { 1: 'Factura A', 2: 'Nota Débito A', 3: 'Nota Crédito A',
                              6: 'Factura B', 7: 'Nota Débito B', 8: 'Nota Crédito B',
                             11: 'Factura C', 12: 'Nota Débito C', 13: 'Nota Crédito C',
                             51: 'Factura M' };
const FACTURAS = [1, 6, 11];
// Nota de crédito que anula cada tipo de factura
const NOTA_CREDITO_DE = { 1: 3, 6: 8, 11: 13 };

// Condición frente al IVA del receptor (tabla de ARCA)
const CONDICIONES_IVA = {
  1: 'IVA Responsable Inscripto', 4: 'IVA Sujeto Exento', 5: 'Consumidor Final',
  6: 'Responsable Monotributo', 7: 'Sujeto No Categorizado', 13: 'Monotributista Social',
  15: 'IVA No Alcanzado', 16: 'Monotributo Trabajador Independiente Promovido'
};
// A quién se le puede hacer Factura A
const CONDICIONES_FACTURA_A = [1, 6, 13, 16];

// Evita pedir dos CAE para el mismo comprobante si llegan dos solicitudes a la vez
// (la llamada a AFIP es HTTP externa y no puede ir dentro de una transacción)
const enCurso = new Set();

// CUIT/CUIL válido: 11 dígitos y dígito verificador (módulo 11)
function cuitValido(cuit) {
  const d = String(cuit || '').replace(/\D/g, '');
  if (d.length !== 11) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((s, p, i) => s + p * Number(d[i]), 0);
  let verificador = 11 - (suma % 11);
  if (verificador === 11) verificador = 0;
  if (verificador === 10) verificador = 9;
  return verificador === Number(d[10]);
}

// Valida los datos del comprobante sin llamar a AFIP. Devuelve { tipo, cuit, condicion } o lanza un error 400.
function validarDatosFactura(tipoComprobante, cuitReceptor, condicionIva) {
  const tipo = parseInt(tipoComprobante, 10);
  // CUIT del receptor: obligatorio para Factura A
  const cuit = String(cuitReceptor || '').replace(/\D/g, '');
  if (!tipo) throw errorHttp(400, 'Faltan datos obligatorios.');
  // 1 = Factura A, 6 = Factura B, 11 = Factura C
  if (!FACTURAS.includes(tipo))
    throw errorHttp(400, 'Tipo de comprobante no soportado (usar Factura A, B o C).');
  if (tipo === 1 && cuit.length !== 11)
    throw errorHttp(400, 'La Factura A requiere el CUIT del cliente (11 dígitos).');
  if (tipo === 1 && !cuitValido(cuit))
    throw errorHttp(400, 'El CUIT del cliente no es válido (revisá el dígito verificador).');
  // Sin dato, la Factura A va a Responsable Inscripto (como antes) y B/C a Consumidor Final
  const condicion = condicionIva ? parseInt(condicionIva, 10) : (tipo === 1 ? 1 : 5);
  if (tipo === 1 && !CONDICIONES_FACTURA_A.includes(condicion))
    throw errorHttp(400, `A un cliente ${CONDICIONES_IVA[condicion] || 'con esa condición'} no se le hace Factura A: usá Factura B.`);
  if (!CONDICIONES_IVA[condicion]) throw errorHttp(400, 'Condición de IVA del cliente no válida.');
  return { tipo, cuit: tipo === 1 ? cuit : '', condicion };
}

// Configuración de AFIP lista para usar, o error 400 con lo que falta
async function configAfip() {
  const cfg = await getIntCfg('afip');
  if (!cfg.activa)        throw errorHttp(400, 'La integración AFIP no está activa.');
  if (!cfg.cuit)          throw errorHttp(400, 'Configurá el CUIT en Integraciones → AFIP.');
  if (!cfg.access_token)  throw errorHttp(400, 'Configurá el Access Token de AfipSDK en Integraciones → AFIP.');
  return cfg;
}

// Instancia de AfipSDK con o sin certificado propio.
// GM_AFIP_API_URL: servidor de AfipSDK alternativo (los tests usan uno simulado).
function crearAfip(cfg) {
  const opciones = {
    CUIT:         parseInt(String(cfg.cuit).replace(/-/g, ''), 10),
    production:   cfg.modo === 'produccion',
    access_token: cfg.access_token
  };
  // Si el usuario subió su propio cert + key, los usamos
  if (cfg.cert && cfg.key && !/^•+$/.test(cfg.key)) {
    opciones.cert = cfg.cert;
    opciones.key  = cfg.key;
  }
  const afip = new Afip(opciones);
  if (process.env.GM_AFIP_API_URL) afip.AdminClient.defaults.baseURL = process.env.GM_AFIP_API_URL.replace(/\/?$/, '/');
  return afip;
}

// Importes que pide AFIP. El total incluye IVA; Factura A y B lo discriminan, la C (monotributo) no.
function importes(cfg, tipo, total) {
  // Alícuotas AFIP: 3 = 0%, 4 = 10.5%, 5 = 21%, 6 = 27%
  const ALICUOTAS = { 3: 0, 4: 0.105, 5: 0.21, 6: 0.27 };
  const codigoAlicuota = ALICUOTAS[cfg.iva_tipo] !== undefined ? Number(cfg.iva_tipo) : 5;
  const discriminaIVA = [1, 3, 6, 8].includes(tipo);
  if (!discriminaIVA) return { neto: total, iva: 0, codigoAlicuota: null };
  const neto = parseFloat((total / (1 + ALICUOTAS[codigoAlicuota])).toFixed(2));
  return { neto, iva: parseFloat((total - neto).toFixed(2)), codigoAlicuota };
}

// Factura que anula una nota de crédito, en el formato de AFIP (la fecha va si está guardada)
function comprobanteAsociado(cfg, factura) {
  const asociado = {
    Tipo: factura.tipo_comprobante,
    PtoVta: factura.punto_venta,
    Nro: factura.numero_comprobante,
    Cuit: parseInt(String(cfg.cuit).replace(/\D/g, ''), 10)
  };
  const fecha = parseInt(String(factura.fecha_comprobante || '').replace(/\D/g, ''), 10);
  if (fecha) asociado.CbteFch = fecha;
  return asociado;
}

// Numeración: "último + 1" se pide a ARCA y se usa al pedir el CAE. Dos cajas facturando el mismo tipo a la vez
// pedían el mismo número y ARCA rechazaba una: los pedidos de CAE de un mismo punto de venta y tipo van en fila.
const filasCAE = new Map();
function enFila(clave, fn) {
  const anterior = filasCAE.get(clave) || Promise.resolve();
  const actual = anterior.then(fn, fn);
  const cola = actual.catch(() => {});
  filasCAE.set(clave, cola);
  cola.then(() => { if (filasCAE.get(clave) === cola) filasCAE.delete(clave); });
  return actual;
}

// Pide el CAE y guarda el comprobante. receptor: { cuit, condicion }; asociado: la factura que anula una nota de crédito
function solicitarCAE(cfg, datos) {
  const ptoVenta = parseInt(cfg.pto_venta, 10) || 1;
  return enFila(`${cfg.modo}-${ptoVenta}-${datos.tipo}`, () => solicitarCAEenFila(cfg, ptoVenta, datos));
}

// Fecha de ARCA (AAAAMMDD) → AAAA-MM-DD
const fechaDeArca = f => String(f || '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');

// Si se cortó la conexión después de pedir el CAE, ARCA puede haber emitido el comprobante sin que llegara la
// respuesta. Antes de pedir otro se consulta ese número: si existe con el mismo importe y receptor, es el nuestro.
async function comprobanteYaEmitido(afip, ptoVenta, tipo, numero, total, receptor) {
  const ultimo = await afip.ElectronicBilling.getLastVoucher(ptoVenta, tipo);
  if (!(ultimo >= numero)) return null;
  const info = await afip.ElectronicBilling.getVoucherInfo(numero, ptoVenta, tipo);
  if (!info || Math.abs(Number(info.ImpTotal) - total) >= 0.01) return null;
  if (Number(info.DocNro || 0) !== (receptor.cuit ? parseInt(receptor.cuit, 10) : 0)) return null;
  return { CAE: String(info.CodAutorizacion), CAEFchVto: fechaDeArca(info.FchVto), fecha: fechaDeArca(info.CbteFch) };
}

async function solicitarCAEenFila(cfg, ptoVenta, { pedidoId, tipo, total, receptor, neto, iva, codigoAlicuota, asociado, motivo, numeroIntentado }) {
  const afip = crearAfip(cfg);
  const nombre = NOMBRES_COMPROBANTE[tipo] || `Tipo ${tipo}`;

  const recuperado = numeroIntentado ? await comprobanteYaEmitido(afip, ptoVenta, tipo, numeroIntentado, total, receptor) : null;
  if (recuperado) {
    console.warn(`[AFIP] ${nombre} ${ptoVenta}-${numeroIntentado} del pedido ${pedidoId} ya estaba emitida: se recupera sin pedir otra`);
    return guardarComprobante(cfg, ptoVenta, numeroIntentado, recuperado, { pedidoId, tipo, total, receptor, neto, iva, asociado, motivo });
  }

  // Obtener último número de comprobante para calcular el siguiente
  const nroComprobante = (await afip.ElectronicBilling.getLastVoucher(ptoVenta, tipo)) + 1;

  // Fecha en formato YYYYMMDD que requiere AFIP. Es la del negocio (ZONA_HORARIA), no la del servidor:
  // en un servidor en UTC las facturas de después de las 21 h de Argentina salían con la fecha de mañana.
  const fechaAFIP = fechaLocal().replace(/-/g, '');

  const voucherData = {
    CbteTipo:   tipo,
    PtoVta:     ptoVenta,
    Concepto:   1,           // 1=Productos, 2=Servicios, 3=Productos y Servicios
    // 80 = CUIT del receptor; 99 = Consumidor Final sin identificar
    DocTipo:    receptor.cuit ? 80 : 99,
    DocNro:     receptor.cuit ? parseInt(receptor.cuit, 10) : 0,
    // Condición IVA del receptor (obligatoria)
    CondicionIVAReceptorId: receptor.condicion,
    CbteDesde:  nroComprobante,
    CbteHasta:  nroComprobante,
    CbteFch:    parseInt(fechaAFIP, 10),
    ImpTotal:   total,
    ImpTotConc: 0,
    ImpNeto:    neto,
    ImpOpEx:    0,
    ImpIVA:     iva,
    ImpTrib:    0,
    MonId:      'PES',
    MonCotiz:   1,
    ...(codigoAlicuota ? { Iva: [{ Id: codigoAlicuota, BaseImp: neto, Importe: iva }] } : {}),
    // La nota de crédito tiene que indicar qué factura anula
    ...(asociado ? { CbtesAsoc: [comprobanteAsociado(cfg, asociado)] } : {})
  };

  // Llamada real al WSFE de AFIP. Si se corta acá, el número queda anotado para no duplicar al reintentar.
  let resultado;
  try {
    resultado = await afip.ElectronicBilling.createVoucher(voucherData);
  } catch (e) {
    e.numeroIntentado = nroComprobante;
    throw e;
  }
  return guardarComprobante(cfg, ptoVenta, nroComprobante, { ...resultado, fecha: fechaLocal() },
    { pedidoId, tipo, total, receptor, neto, iva, asociado, motivo });
}

async function guardarComprobante(cfg, ptoVenta, nroComprobante, resultado, { pedidoId, tipo, total, receptor, neto, iva, asociado, motivo }) {
  const nombre = NOMBRES_COMPROBANTE[tipo] || `Tipo ${tipo}`;
  // modo: las facturas de homologación (pruebas) no tienen validez fiscal y no se mezclan con las reales
  let id;
  try {
    ({ id } = await run(
      `INSERT INTO comprobantes_afip
         (pedido_id, tipo_comprobante, tipo_comprobante_nombre, punto_venta, numero_comprobante, cae, cae_vencimiento,
          fecha_comprobante, total, imp_neto, imp_iva, cuit_receptor, razon_social_receptor, condicion_iva_receptor,
          comprobante_asociado_id, motivo, modo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [pedidoId, tipo, nombre, ptoVenta, nroComprobante, resultado.CAE, resultado.CAEFchVto, resultado.fecha, total, neto, iva,
       receptor.cuit || '', receptor.razon_social || '', receptor.condicion, asociado ? asociado.id : null, motivo || '',
       cfg.modo === 'produccion' ? 'produccion' : 'homologacion']
    ));
  } catch (e) {
    // ARCA ya emitió el comprobante: si no se guarda, el sistema dejaría facturar el pedido de nuevo (duplicado).
    // noReintentar: la fila de facturas en espera no tiene que volver a pedirlo
    const dato = `${nombre} ${ptoVenta}-${nroComprobante} CAE ${resultado.CAE} del pedido ${pedidoId}`;
    console.error(`[AFIP] Comprobante emitido y NO guardado: ${dato}`, e);
    throw Object.assign(errorHttp(500, `ARCA emitió ${dato}, pero no se pudo guardar en el sistema. Anotalo y avisá a soporte antes de volver a facturar.`), { noReintentar: true });
  }
  emitEvento('afip:comprobante', { pedido_id: pedidoId, cae: resultado.CAE });

  return {
    ok:                 true,
    id,
    cae:                resultado.CAE,
    cae_vencimiento:    resultado.CAEFchVto,
    numero_comprobante: nroComprobante,
    punto_venta:        ptoVenta,
    tipo_comprobante:   tipo,
    tipo_nombre:        nombre
  };
}

// Factura del pedido que sigue vigente (sin nota de crédito que la anule).
// soloReales: en producción, una factura de prueba (homologación) no impide hacer la real.
const facturaVigente = (pedidoId, { soloReales = false } = {}) => get(
  `SELECT * FROM comprobantes_afip f
   WHERE f.pedido_id = ? AND f.tipo_comprobante IN (1, 6, 11)
     AND NOT EXISTS (SELECT 1 FROM comprobantes_afip nc WHERE nc.comprobante_asociado_id = f.id)
     ${soloReales ? "AND COALESCE(f.modo, '') != 'homologacion'" : ''}
   ORDER BY f.id DESC LIMIT 1`, [pedidoId]);

// numeroIntentado: reintento de una factura en espera (ver comprobanteYaEmitido)
async function emitirFactura(pedidoId, tipoComprobante, cuitReceptor, { condicionIva, razonSocial, numeroIntentado } = {}) {
  const { tipo, cuit, condicion } = validarDatosFactura(tipoComprobante, cuitReceptor, condicionIva);
  const clave = `pedido-${pedidoId}`;
  if (enCurso.has(clave)) throw errorHttp(409, 'Ya se está generando el comprobante de este pedido.');
  enCurso.add(clave);
  try {
    const cfg = await configAfip();
    const pedido = await get('SELECT * FROM pedidos WHERE id = ?', [pedidoId]);
    if (!pedido) throw errorHttp(404, 'Pedido no encontrado.');
    if (pedido.estado !== 'pagado') throw errorHttp(400, 'Solo se pueden facturar pedidos cobrados.');

    // No emitir comprobante duplicado para el mismo pedido (si se anuló con nota de crédito, se puede volver a facturar)
    const yaFacturado = await facturaVigente(pedidoId, { soloReales: cfg.modo === 'produccion' });
    if (yaFacturado)
      throw errorHttp(409, `Este pedido ya tiene ${yaFacturado.tipo_comprobante_nombre} con CAE ${yaFacturado.cae}.`);

    // La propina es del personal: no es venta del local, no se factura ni lleva IVA
    const total = Math.round(((parseFloat(pedido.total) || 0) - (parseFloat(pedido.propina) || 0)) * 100) / 100;
    if (!(total > 0)) throw errorHttp(400, 'El pedido no tiene importe para facturar.');
    const { neto, iva, codigoAlicuota } = importes(cfg, tipo, total);
    return await solicitarCAE(cfg, {
      pedidoId, tipo, total, neto, iva, codigoAlicuota, numeroIntentado,
      receptor: { cuit, condicion, razon_social: String(razonSocial || '').slice(0, 200) }
    });
  } finally {
    enCurso.delete(clave);
  }
}

// ---- CAEA (contingencia): factura sin conexión con ARCA, RG ARCA 5782/2025 y 5785/2025 ----
// Quincena de una fecha AAAA-MM-DD: periodo AAAAMM y orden 1 (del 1 al 15) o 2 (del 16 a fin de mes)
function quincena(fecha) {
  const [a, m, d] = fecha.split('-').map(Number);
  return { periodo: a * 100 + m, orden: d <= 15 ? 1 : 2 };
}
const modoDe = cfg => (cfg.modo === 'produccion' ? 'produccion' : 'homologacion');
// Fecha y hora de generación del comprobante (AAAAMMDDhhmmss, hora del negocio)
function fechaHoraArca() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: process.env.ZONA_HORARIA || 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  return `${p.year}${p.month}${p.day}${p.hour}${p.minute}${p.second}`;
}

// Factura con el CAEA de la quincena, sin ARCA: se numera en el punto de venta CAEA desde el último número conocido y
// queda para informar (servicios/caea.js lo informa al volver internet). null si no se puede: sin punto de venta CAEA
// configurado, sin CAEA vigente o sin la numeración (se obtienen con conexión). Entonces la factura queda en espera.
async function emitirConCAEA(pedidoId, tipoComprobante, cuitReceptor, { condicionIva, razonSocial } = {}) {
  const { tipo, cuit, condicion } = validarDatosFactura(tipoComprobante, cuitReceptor, condicionIva);
  const cfg = await configAfip();
  const pto = parseInt(cfg.pto_venta_caea, 10);
  if (!pto) return null;
  const modo = modoDe(cfg);
  const hoy = fechaLocal();
  const { periodo, orden } = quincena(hoy);
  const caea = await get('SELECT * FROM caea WHERE modo = ? AND periodo = ? AND orden = ?', [modo, periodo, orden]);
  const numeracion = await get('SELECT ultimo FROM caea_numeracion WHERE modo = ? AND pto_venta = ? AND tipo = ?', [modo, pto, tipo]);
  if (!caea || !numeracion) return null;

  const clave = `pedido-${pedidoId}`;
  if (enCurso.has(clave)) throw errorHttp(409, 'Ya se está generando el comprobante de este pedido.');
  enCurso.add(clave);
  try {
    const pedido = await get('SELECT * FROM pedidos WHERE id = ?', [pedidoId]);
    if (!pedido) throw errorHttp(404, 'Pedido no encontrado.');
    if (pedido.estado !== 'pagado') throw errorHttp(400, 'Solo se pueden facturar pedidos cobrados.');
    const yaFacturado = await facturaVigente(pedidoId, { soloReales: modo === 'produccion' });
    if (yaFacturado) throw errorHttp(409, `Este pedido ya tiene ${yaFacturado.tipo_comprobante_nombre} ${yaFacturado.autorizacion || 'CAE'} ${yaFacturado.cae}.`);
    const total = Math.round(((parseFloat(pedido.total) || 0) - (parseFloat(pedido.propina) || 0)) * 100) / 100;
    if (!(total > 0)) throw errorHttp(400, 'El pedido no tiene importe para facturar.');
    const { neto, iva, codigoAlicuota } = importes(cfg, tipo, total);
    const receptor = { cuit, condicion, razon_social: String(razonSocial || '').slice(0, 200) };

    return await enFila(`caea-${modo}-${pto}-${tipo}`, async () => {
      const { maximo } = await get(`SELECT COALESCE(MAX(numero_comprobante), 0) AS maximo FROM comprobantes_afip
        WHERE punto_venta = ? AND tipo_comprobante = ? AND COALESCE(modo, '') = ?`, [pto, tipo, modo]);
      const actual = await get('SELECT ultimo FROM caea_numeracion WHERE modo = ? AND pto_venta = ? AND tipo = ?', [modo, pto, tipo]);
      const numero = Math.max(Number(actual.ultimo) || 0, Number(maximo) || 0) + 1;
      const datos = {
        Concepto: 1, DocTipo: cuit ? 80 : 99, DocNro: cuit ? parseInt(cuit, 10) : 0, CondicionIVAReceptorId: condicion,
        CbteDesde: numero, CbteHasta: numero, CbteFch: parseInt(hoy.replace(/-/g, ''), 10),
        ImpTotal: total, ImpTotConc: 0, ImpNeto: neto, ImpOpEx: 0, ImpIVA: iva, ImpTrib: 0, MonId: 'PES', MonCotiz: 1,
        ...(codigoAlicuota ? { Iva: { AlicIva: [{ Id: codigoAlicuota, BaseImp: neto, Importe: iva }] } } : {}),
        CAEA: caea.caea, CbteFchHsGen: fechaHoraArca()
      };
      const nombre = NOMBRES_COMPROBANTE[tipo];
      const { id } = await run(
        `INSERT INTO comprobantes_afip
           (pedido_id, tipo_comprobante, tipo_comprobante_nombre, punto_venta, numero_comprobante, cae, cae_vencimiento,
            fecha_comprobante, total, imp_neto, imp_iva, cuit_receptor, razon_social_receptor, condicion_iva_receptor,
            motivo, modo, autorizacion, caea_informado, caea_datos)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, 'CAEA', 0, ?)`,
        [pedidoId, tipo, nombre, pto, numero, caea.caea, caea.vig_hasta, hoy, total, neto, iva,
         receptor.cuit, receptor.razon_social, condicion, modo, JSON.stringify({ PtoVta: pto, CbteTipo: tipo, ...datos })]);
      await run('UPDATE caea_numeracion SET ultimo = ? WHERE modo = ? AND pto_venta = ? AND tipo = ?', [numero, modo, pto, tipo]);
      emitEvento('afip:comprobante', { pedido_id: pedidoId, cae: caea.caea, autorizacion: 'CAEA' });
      return {
        ok: true, id, cae: caea.caea, cae_vencimiento: caea.vig_hasta, numero_comprobante: numero, punto_venta: pto,
        tipo_comprobante: tipo, tipo_nombre: nombre, autorizacion: 'CAEA',
        mensaje: 'Sin conexión con ARCA: factura emitida con CAEA (contingencia). Se informa sola a ARCA cuando vuelve internet.'
      };
    });
  } finally {
    enCurso.delete(clave);
  }
}

// Nota de crédito por el total de una factura: la anula ante ARCA. El cobro no se toca
// (si hay que devolver plata, se registra como egreso de caja).
async function emitirNotaCredito(comprobanteId, motivo, cuitReceptor) {
  motivo = String(motivo || '').trim().slice(0, 200);
  if (!motivo) throw errorHttp(400, 'Indicá el motivo de la nota de crédito.');
  const clave = `nc-${comprobanteId}`;
  if (enCurso.has(clave)) throw errorHttp(409, 'Ya se está generando la nota de crédito de esta factura.');
  enCurso.add(clave);
  try {
    const cfg = await configAfip();
    const factura = await get('SELECT * FROM comprobantes_afip WHERE id = ?', [comprobanteId]);
    if (!factura) throw errorHttp(404, 'Comprobante no encontrado.');
    if (!FACTURAS.includes(factura.tipo_comprobante)) throw errorHttp(400, 'Solo se anulan facturas A, B o C.');
    const anulada = await get('SELECT tipo_comprobante_nombre, cae FROM comprobantes_afip WHERE comprobante_asociado_id = ?', [factura.id]);
    if (anulada) throw errorHttp(409, `Esta factura ya fue anulada con ${anulada.tipo_comprobante_nombre} (CAE ${anulada.cae}).`);
    // Una factura de prueba no existe en el ARCA real (y al revés): la nota de crédito la rechazaría
    const modoActual = cfg.modo === 'produccion' ? 'produccion' : 'homologacion';
    if (factura.modo && factura.modo !== modoActual)
      throw errorHttp(400, factura.modo === 'homologacion'
        ? 'Esa factura es de prueba (homologación): no tiene validez fiscal y no hace falta anularla.'
        : 'Esa factura es real (producción): para anularla, pasá AFIP a modo producción.');

    // Mismo receptor que la factura. Las Facturas A anteriores a esta versión no guardaban el CUIT: se pide.
    let cuit = factura.cuit_receptor || '';
    if (factura.tipo_comprobante === 1 && !cuit) {
      cuit = String(cuitReceptor || '').replace(/\D/g, '');
      if (!cuitValido(cuit)) throw errorHttp(400, 'Esta factura no tiene guardado el CUIT del cliente: ingresalo para anularla.');
    }
    const condicion = factura.condicion_iva_receptor || (factura.tipo_comprobante === 1 ? 1 : 5);
    const tipo = NOTA_CREDITO_DE[factura.tipo_comprobante];
    const total = Number(factura.total) || 0;
    // Mismos importes que la factura; las anteriores a esta versión se recalculan con la alícuota configurada
    const calculado = importes(cfg, tipo, total);
    const neto = factura.imp_neto !== null && factura.imp_neto !== undefined ? factura.imp_neto : calculado.neto;
    const iva = factura.imp_iva !== null && factura.imp_iva !== undefined ? factura.imp_iva : calculado.iva;

    return await solicitarCAE(cfg, {
      pedidoId: factura.pedido_id, tipo, total, neto, iva, codigoAlicuota: calculado.codigoAlicuota,
      receptor: { cuit, condicion, razon_social: factura.razon_social_receptor },
      asociado: factura, motivo
    });
  } finally {
    enCurso.delete(clave);
  }
}

// Padrón de ARCA (constancia de inscripción, servicio A5): razón social y condición frente al IVA de un CUIT.
// La CUIT del local tiene que tener habilitado el servicio "ws_sr_constancia_inscripcion" en ARCA.
const cachePadron = new Map();
const HORAS_CACHE_PADRON = 12;

function condicionDesdePadron(persona) {
  if (persona.datosMonotributo) return 6;
  const impuestos = [].concat((persona.datosRegimenGeneral && persona.datosRegimenGeneral.impuesto) || [])
    .map(i => Number(i.idImpuesto));
  if (impuestos.includes(30)) return 1;   // IVA
  if (impuestos.includes(32)) return 4;   // IVA exento
  return 5;
}

async function consultarPadron(cuitConsultado) {
  const cuit = String(cuitConsultado || '').replace(/\D/g, '');
  if (!cuitValido(cuit)) throw errorHttp(400, 'El CUIT no es válido (revisá el dígito verificador).');
  const enCache = cachePadron.get(cuit);
  if (enCache && Date.now() - enCache.hora < HORAS_CACHE_PADRON * 3600e3) return enCache.datos;

  const cfg = await configAfip();
  let persona;
  try {
    persona = await crearAfip(cfg).RegisterInscriptionProof.getTaxpayerDetails(parseInt(cuit, 10));
  } catch (e) {
    throw errorHttp(502, `No se pudo consultar el padrón de ARCA: ${e.message}. Revisá que el servicio de constancia de inscripción esté habilitado para tu CUIT.`);
  }
  if (!persona) throw errorHttp(404, 'El CUIT no figura en el padrón de ARCA.');

  const g = persona.datosGenerales || {};
  const dom = g.domicilioFiscal || {};
  const condicion = condicionDesdePadron(persona);
  const errores = [].concat((persona.errorConstancia && persona.errorConstancia.error) || []);
  const datos = {
    cuit,
    razon_social: g.razonSocial || [g.apellido, g.nombre].filter(Boolean).join(' ') || '',
    condicion_iva: condicion,
    condicion_iva_nombre: CONDICIONES_IVA[condicion],
    domicilio: [dom.direccion, dom.localidad, dom.descripcionProvincia].filter(Boolean).join(', '),
    factura_sugerida: CONDICIONES_FACTURA_A.includes(condicion) ? 1 : 6,
    activo: !g.estadoClave || g.estadoClave === 'ACTIVO',
    observaciones: errores.map(String)
  };
  cachePadron.set(cuit, { hora: Date.now(), datos });
  return datos;
}

module.exports = {
  emitirFactura, emitirNotaCredito, consultarPadron, validarDatosFactura, cuitValido, crearAfip, facturaVigente,
  emitirConCAEA, configAfip, quincena, modoDe, fechaDeArca, FACTURAS,
  CONDICIONES_IVA, CONDICIONES_FACTURA_A
};
