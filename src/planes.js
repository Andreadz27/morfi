'use strict';
// Planes de Fadido: qué incluye cada uno y cuánto cuesta. Es el ÚNICO lugar con precios y módulos:
// lo usan el local (src/licencia.js), Fadido Nube (nube/) y la pantalla "Tu plan". La landing repite los precios
// a mano (landing/index.html, sección #precios): si cambian acá, cambiarlos también ahí.
// Precios finales en pesos por mes (actualizarlos con la inflación; referencia en docs/PLANES.md).
//
// Lo básico de un local (pedidos, mesas, cocina, caja, cobros, factura electrónica, stock, reportes, copias de
// seguridad, funcionar sin internet) está en TODOS los planes y nunca se apaga: ni con el plan vencido.

// Módulos que dependen del plan
const MODULOS = {
  mesa_qr: 'Pedido y pago con Mercado Pago desde el QR de la mesa',
  online: 'Pedidos online: carta con link fijo, WhatsApp e Instagram',
  apps_delivery: 'Integración con PedidosYa, Rappi y otras apps de delivery',
  whatsapp: 'WhatsApp Business: comprobantes, avisos y recordatorios de reservas',
  personal: 'Personal: fichadas, turnos y reparto de propinas',
  fidelizacion: 'Fidelización: puntos, cupones y gift cards',
  costos: 'Ganancias detalladas (por día, mes, plato y canal), recetas, sub-recetas y costo de cada plato',
  contabilidad: 'Contabilidad: gastos, facturas de compra leídas con IA, cuentas a pagar, IVA, resultados y libro diario',
  panel_nube: 'Panel Fadido Nube: tus ventas desde el celular',
  multisucursal: 'Varias sucursales y precios centrales',
  asistente: 'Asistente IA que atiende WhatsApp (pedidos y reservas)'
};

// Lo que viene en TODOS los planes (para la pantalla "Tu plan"; la landing lo repite a mano)
const INCLUIDO = [
  'Pedidos, mesas, cocina en pantalla, caja y cobros',
  'Factura electrónica ARCA, también cuando ARCA no responde (CAEA)',
  'Funciona sin internet y los mozos toman pedidos aunque se corte el WiFi',
  'Carta QR en español, inglés y portugués, y llamado al mozo desde la mesa',
  'Opciones y adicionales, venta cruzada y menú Take Away',
  'Cuenta dividida por plato y cierre del día automático',
  'Stock, reportes y copia de seguridad en la nube',
  'Usuarios ilimitados'
];

const PRO = ['mesa_qr', 'online', 'apps_delivery', 'whatsapp', 'personal', 'fidelizacion', 'costos', 'contabilidad', 'panel_nube'];

// precio: abono mensual. contado: pago único (licencia de por vida del plan) + mantenimiento por mes (ver MANTENIMIENTO)
const PLANES = {
  esencial: { nombre: 'Esencial', precio: 24900, contado: 490000, mantenimiento: 7900, modulos: [],
    para: 'Cafés, bares, rotiserías y locales chicos' },
  pro: { nombre: 'Pro', precio: 49900, contado: 990000, mantenimiento: 14900, modulos: PRO,
    para: 'Restaurantes con salón, delivery y equipo' },
  cadenas: { nombre: 'Cadenas', precio: 44900, contado: 890000, mantenimiento: 12900, por_local: true, minimo_locales: 2,
    modulos: [...PRO, 'multisucursal'], para: 'Dos o más sucursales' },
  // Prueba gratis de una instalación nueva (y de un local nuevo en la nube): todo incluido
  prueba: { nombre: 'Prueba gratis', precio: 0, modulos: Object.keys(MODULOS), interno: true }
};

// Se suman a cualquier plan
const EXTRAS = {
  asistente: { nombre: 'Asistente IA por WhatsApp', precio: 19900,
    nota: 'El consumo de IA va en la cuenta de Anthropic del local (su propia clave)' }
};

// De contado: el plan se paga una vez y queda para siempre, aunque se deje de pagar el mantenimiento.
// El mantenimiento (mensual; el año adelantado con los mismos descuentos) incluye esto:
const MANTENIMIENTO = [
  'Actualizaciones y mejoras nuevas',
  'Cambios de ARCA y de la factura electrónica al día',
  'Soporte por WhatsApp y a distancia',
  'Copia de seguridad en la nube y panel Fadido Nube'
];

// Instalación (pago único, por local). A distancia no se cobra; presencial en AMBA tiene precio fijo y fuera de AMBA
// se suman los viáticos. Comprando de contado, la presencial va bonificada.
const INSTALACION = {
  distancia: { nombre: 'A distancia', precio: 0,
    incluye: 'Alta, carga de la carta y capacitación por videollamada' },
  presencial: { nombre: 'Presencial (CABA y GBA)', precio: 89000,
    incluye: 'Instalación en la PC del local, impresoras de comandas y tickets, QR de las mesas y capacitación al equipo en el local' },
  nota: 'Fuera de CABA y GBA, se suman los viáticos. Comprando un plan de contado, la instalación presencial va bonificada.'
};

const DIAS_PRUEBA = 30;
// Con el plan vencido sigue todo igual estos días; después quedan solo los módulos de Esencial
const DIAS_GRACIA = 10;
// Desde cuántos días antes de vencer se avisa
const DIAS_AVISO = 7;
// Pago adelantado: anual = 2 meses gratis; semestral = 10 % menos
const DESCUENTOS = { semestral: 0.10, anual: 2 / 12 };

// A dónde escribe el cliente para contratar o cambiar de plan (botón "Quiero este plan")
const VENTAS = {
  // El de Fadido (11 2390-0155); FADIDO_VENTAS_WHATSAPP lo cambia (por ejemplo, un revendedor). Con código de país, solo números
  whatsapp: process.env.FADIDO_VENTAS_WHATSAPP || process.env.MORFI_VENTAS_WHATSAPP || '5491123900155',
  email: process.env.FADIDO_VENTAS_EMAIL || process.env.MORFI_VENTAS_EMAIL || ''
};

const PLAN_MINIMO = Object.fromEntries(Object.keys(MODULOS).map(m =>
  [m, Object.keys(EXTRAS).includes(m) ? m : ['esencial', 'pro', 'cadenas'].find(p => PLANES[p].modulos.includes(m))]));

// Módulos de un plan con sus extras
function modulosDe(plan, extras = []) {
  const base = (PLANES[plan] || PLANES.esencial).modulos;
  return [...new Set([...base, ...extras.filter(e => EXTRAS[e])])];
}

// Plan más barato que incluye el módulo (o el extra que hay que sumar)
const planMinimo = modulo => PLAN_MINIMO[modulo] || null;

module.exports = { MODULOS, INCLUIDO, PLANES, EXTRAS, MANTENIMIENTO, INSTALACION, DIAS_PRUEBA, DIAS_GRACIA, DIAS_AVISO, DESCUENTOS, VENTAS, modulosDe, planMinimo };
