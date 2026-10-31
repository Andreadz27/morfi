// Genera los sonidos de aviso de la caja (public/sonidos/*.wav), sintetizados acá mismo: sin archivos de terceros.
// - pago.wav: caja registradora ("cha-ching"): dos golpes metálicos y monedas.
// - pedido.wav: campana fuerte de tres notas (ding-ding-ding), se oye aunque haya ruido.
// Uso: node scripts/generar-sonidos.js
'use strict';
const fs = require('fs');
const path = require('path');

const TASA = 22050;
// Ruido con semilla fija: el archivo sale igual cada vez que se genera
let semilla = 12345;
const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648);

function wav(muestras) {
  // Normaliza al 90 % del máximo: fuerte pero sin distorsionar
  const pico = muestras.reduce((m, x) => Math.max(m, Math.abs(x)), 0) || 1;
  const datos = Buffer.alloc(muestras.length * 2);
  muestras.forEach((x, i) => datos.writeInt16LE(Math.round(x / pico * 0.9 * 32767), i * 2));
  const cab = Buffer.alloc(44);
  cab.write('RIFF', 0); cab.writeUInt32LE(36 + datos.length, 4); cab.write('WAVE', 8);
  cab.write('fmt ', 12); cab.writeUInt32LE(16, 16); cab.writeUInt16LE(1, 20); cab.writeUInt16LE(1, 22);
  cab.writeUInt32LE(TASA, 24); cab.writeUInt32LE(TASA * 2, 28); cab.writeUInt16LE(2, 32); cab.writeUInt16LE(16, 34);
  cab.write('data', 36); cab.writeUInt32LE(datos.length, 40);
  return Buffer.concat([cab, datos]);
}

// Una nota de campana: fundamental + parciales inarmónicos, ataque corto y caída larga
function campana(buf, inicio, hz, dur, vol) {
  const parciales = [[1, 1], [2.76, 0.45], [5.4, 0.25], [8.93, 0.12]];
  const desde = Math.round(inicio * TASA), n = Math.round(dur * TASA);
  for (let i = 0; i < n && desde + i < buf.length; i++) {
    const t = i / TASA;
    const env = Math.min(1, t / 0.004) * Math.exp(-t * 3.2);
    let s = 0;
    for (const [m, a] of parciales) s += a * Math.sin(2 * Math.PI * hz * m * t) * Math.exp(-t * m * 0.6);
    buf[desde + i] += vol * env * s;
  }
}

// Golpe metálico corto (el "cha" de la caja): ruido filtrado con resonancias
function golpe(buf, inicio, vol) {
  const desde = Math.round(inicio * TASA), n = Math.round(0.18 * TASA);
  let anterior = 0;
  for (let i = 0; i < n && desde + i < buf.length; i++) {
    const t = i / TASA;
    const ruido = azar() * 2 - 1;
    anterior = anterior * 0.6 + ruido * 0.4; // un poco más grave que el ruido blanco
    const metal = Math.sin(2 * Math.PI * 3200 * t) * 0.5 + Math.sin(2 * Math.PI * 4700 * t) * 0.35;
    buf[desde + i] += vol * Math.exp(-t * 28) * (anterior * 0.7 + metal * 0.6);
  }
}

function sonidoPago() {
  const buf = new Float64Array(Math.round(1.6 * TASA));
  golpe(buf, 0, 0.9);
  golpe(buf, 0.11, 0.8);
  // "ching": campanita aguda brillante + monedas
  campana(buf, 0.22, 2093, 1.3, 0.8);
  campana(buf, 0.24, 2637, 1.2, 0.45);
  for (let k = 0; k < 7; k++) campana(buf, 0.3 + k * 0.045, 3000 + (k % 3) * 420, 0.25, 0.12);
  return buf;
}

function sonidoPedido() {
  const buf = new Float64Array(Math.round(2.0 * TASA));
  campana(buf, 0, 784, 1.2, 1);      // sol
  campana(buf, 0.32, 988, 1.2, 1);   // si
  campana(buf, 0.64, 1175, 1.35, 1); // re
  return buf;
}

const dir = path.join(__dirname, '..', 'public', 'sonidos');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'pago.wav'), wav(sonidoPago()));
fs.writeFileSync(path.join(dir, 'pedido.wav'), wav(sonidoPedido()));
console.log('Sonidos generados en', dir);
