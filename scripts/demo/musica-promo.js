// Música de fondo del video promocional, sintetizada (sin derechos de terceros): un colchón de acordes suave
// y un arpegio liviano a 96 bpm. Sale un WAV estéreo de 44,1 kHz; el volumen final y el "duck" bajo la voz
// los hace ffmpeg en grabar-promo.js.
// Uso: node scripts/demo/musica-promo.js <segundos> <salida.wav>
'use strict';
const fs = require('fs');

const SR = 44100;
const BPM = 96;
const negra = 60 / BPM;
// Progresión cálida y optimista: Fmaj7 – Am7 – Dm9 – C(add9), un compás (4 negras) cada una
const ACORDES = [
  [53, 57, 60, 64], // Fmaj7
  [57, 60, 64, 67], // Am7
  [50, 57, 60, 64], // Dm9 (sin 3ra grave)
  [48, 55, 62, 64]  // Cadd9
];
const hz = n => 440 * Math.pow(2, (n - 69) / 12);

function generar(segundos) {
  const n = Math.ceil(segundos * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const compas = negra * 4;
  // Colchón: cada nota con dos osciladores un poco desafinados (ancho estéreo), ataque y cola lentos
  for (let c = 0; c * compas < segundos; c++) {
    const acorde = ACORDES[c % ACORDES.length];
    const t0 = c * compas, dur = compas + 1.2;
    for (const nota of acorde) {
      const f = hz(nota);
      const i0 = Math.floor(t0 * SR), i1 = Math.min(n, Math.floor((t0 + dur) * SR));
      for (let i = i0; i < i1; i++) {
        const t = (i - i0) / SR;
        const env = Math.min(1, t / 0.9) * Math.min(1, (dur - t) / 1.2);
        const a = Math.sin(2 * Math.PI * f * 1.003 * t) + 0.25 * Math.sin(2 * Math.PI * f * 2.006 * t);
        const b = Math.sin(2 * Math.PI * f * 0.997 * t) + 0.25 * Math.sin(2 * Math.PI * f * 1.994 * t);
        L[i] += 0.05 * env * a;
        R[i] += 0.05 * env * b;
      }
    }
    // Bajo: la fundamental una octava abajo, redondo
    const fb = hz(acorde[0] - 12);
    const i0 = Math.floor(t0 * SR), i1 = Math.min(n, Math.floor((t0 + compas) * SR));
    for (let i = i0; i < i1; i++) {
      const t = (i - i0) / SR;
      const env = Math.min(1, t / 0.05) * Math.exp(-t * 0.6);
      const v = 0.09 * env * Math.sin(2 * Math.PI * fb * t);
      L[i] += v; R[i] += v;
    }
  }
  // Arpegio en corcheas, tipo "pluck" (decae rápido), alternando izquierda y derecha
  const corchea = negra / 2;
  for (let k = 0; k * corchea < segundos; k++) {
    const t0 = k * corchea;
    const acorde = ACORDES[Math.floor(t0 / compas) % ACORDES.length];
    const patron = [0, 2, 1, 3, 2, 1, 3, 2];
    const f = hz(acorde[patron[k % 8]] + 12);
    const pan = k % 2 ? 0.7 : 0.3;
    const i0 = Math.floor(t0 * SR), i1 = Math.min(n, i0 + Math.floor(0.6 * SR));
    for (let i = i0; i < i1; i++) {
      const t = (i - i0) / SR;
      const env = Math.min(1, t / 0.004) * Math.exp(-t * 7);
      const v = 0.045 * env * (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * f * 3 * t) * Math.exp(-t * 20));
      L[i] += v * (1 - pan) * 2; R[i] += v * pan * 2;
    }
  }
  // Eco suave (dos repeticiones cruzadas) y fundido de entrada y salida
  const eco = Math.floor(negra * 0.75 * SR);
  for (let i = n - 1; i >= eco; i--) { L[i] += 0.22 * R[i - eco]; R[i] += 0.22 * L[i - eco]; }
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const fade = Math.min(1, t / 1.5) * Math.min(1, (segundos - t) / 2.5);
    L[i] *= fade; R[i] *= fade;
  }
  return [L, R];
}

function wav([L, R]) {
  let pico = 0;
  for (let i = 0; i < L.length; i++) pico = Math.max(pico, Math.abs(L[i]), Math.abs(R[i]));
  const k = pico ? 0.89 / pico : 1; // normalizado a -1 dBFS
  const buf = Buffer.alloc(44 + L.length * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + L.length * 4, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(L.length * 4, 40);
  for (let i = 0; i < L.length; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * k)) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * k)) * 32767), 46 + i * 4);
  }
  return buf;
}

if (require.main === module) {
  const [segundos, salida] = [Number(process.argv[2]), process.argv[3]];
  if (!(segundos > 0) || !salida) { console.error('Uso: node musica-promo.js <segundos> <salida.wav>'); process.exit(1); }
  fs.writeFileSync(salida, wav(generar(segundos)));
}
module.exports = { generar, wav };
