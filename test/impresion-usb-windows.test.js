// Impresora USB en Windows (por PowerShell): error claro si no está instalada.
// En un archivo aparte: en el CI de Windows, PowerShell a veces tarda más de 30 s en arrancar y el límite de tiempo
// es por archivo. Cualquiera de los dos mensajes claros vale: "no se encontró" o "no respondió" (cortado por tiempo).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciarServidor } = require('./helpers');

let s;
before(async () => { if (process.platform === 'win32') s = await iniciarServidor({ GM_IMPRESION_TIMEOUT_MS: '45000' }); });
after(async () => { if (s) await s.cerrar(); });

test('USB en Windows: error claro si la impresora no está instalada', { skip: process.platform !== 'win32' }, async () => {
  const [, imp] = await s.llamar('POST', '/api/impresoras', { nombre: 'USB inexistente', tipo: 'usb', destino: 'Impresora Que No Existe 123', activa: false }, s.tokenAdmin);
  const [, r] = await s.llamar('POST', `/api/impresoras/${imp.id}/prueba`, undefined, s.tokenAdmin);
  assert.equal(r.ok, false);
  assert.match(r.message, /No se encontró la impresora 'Impresora Que No Existe 123'|La impresora no respondió en d+ segundos/);
  assert.doesNotMatch(r.message, /EncodedCommand/, 'sin el comando de PowerShell en el mensaje');
});
