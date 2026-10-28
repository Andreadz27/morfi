// Cambio de nombre GastroManager → Fadido en una instalación existente: la base gastromanager.db (con su -wal)
// pasa a fadido.db sin perder datos; las copias viejas se siguen listando; el actualizador, si vuelve a una versión
// de antes del cambio, le devuelve el nombre viejo a la base (test/cambio-nombre-actualizador.test.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { iniciarServidor } = require('./helpers');
const { rutaBase } = require('../src/archivo-base');


test('rutaBase: renombra morfi.db (Fadido antes se llamaba Morfi) con su -wal y -shm', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-nombre-'));
  try {
    for (const s of ['', '-wal', '-shm']) fs.writeFileSync(path.join(dir, 'morfi.db' + s), 'datos' + s);
    // Una gastromanager.db olvidada al lado no gana: la de Morfi es la más nueva
    fs.writeFileSync(path.join(dir, 'gastromanager.db'), 'vieja');
    assert.equal(rutaBase(dir), path.join(dir, 'fadido.db'));
    for (const s of ['', '-wal', '-shm']) {
      assert.equal(fs.readFileSync(path.join(dir, 'fadido.db' + s), 'utf8'), 'datos' + s);
      assert.equal(fs.existsSync(path.join(dir, 'morfi.db' + s)), false);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('copias: las fadido_ nuevas van primero y la rotación borra las morfi_ viejas, no las nuevas', async () => {
  const s = await iniciarServidor({ BACKUPS_CONSERVAR: '3' });
  try {
    const dir = path.join(s.dataDir, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    for (const n of ['morfi_2026-10-20_050000.db', 'morfi_2026-10-21_050000.db', 'morfi_2026-10-22_050000.db', 'gastromanager_2026-10-01_050000.db'])
      fs.writeFileSync(path.join(dir, n), 'x');
    const [, nueva] = await s.llamar('POST', '/api/backups', {}, s.tokenAdmin);
    assert.match(nueva.nombre, /^fadido_/);
    const [, copias] = await s.llamar('GET', '/api/backups', null, s.tokenAdmin);
    // Quedan 3: primero las fadido_ (la del arranque del servidor y la pedida), después las morfi_ más nuevas
    const nombres = copias.map(c => c.nombre);
    assert.equal(nombres.length, 3, nombres.join());
    assert.equal(nombres[0], nueva.nombre);
    const primeraVieja = nombres.findIndex(n => !n.startsWith('fadido_'));
    assert.ok(primeraVieja === -1 || nombres.slice(primeraVieja).every(n => n.startsWith('morfi_')), nombres.join());
    assert.ok(nombres.includes('morfi_2026-10-22_050000.db') || primeraVieja === -1, nombres.join());
    assert.ok(!nombres.includes('morfi_2026-10-20_050000.db') && !nombres.some(n => n.startsWith('gastromanager_')), 'se borraron las más viejas');
  } finally { await s.cerrar(); }
});

test('rutaBase: renombra gastromanager.db con su -wal y -shm; no pisa una fadido.db existente', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-nombre-'));
  try {
    for (const s of ['', '-wal', '-shm']) fs.writeFileSync(path.join(dir, 'gastromanager.db' + s), 'datos' + s);
    assert.equal(rutaBase(dir), path.join(dir, 'fadido.db'));
    for (const s of ['', '-wal', '-shm']) {
      assert.equal(fs.readFileSync(path.join(dir, 'fadido.db' + s), 'utf8'), 'datos' + s);
      assert.equal(fs.existsSync(path.join(dir, 'gastromanager.db' + s)), false);
    }
    // Ya renombrada: no hace nada. Si aparece una vieja (copia a mano), no reemplaza la actual.
    fs.writeFileSync(path.join(dir, 'gastromanager.db'), 'vieja');
    rutaBase(dir);
    assert.equal(fs.readFileSync(path.join(dir, 'fadido.db'), 'utf8'), 'datos');
    // Instalación nueva: no hay ninguna
    const vacia = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-nombre-'));
    assert.equal(rutaBase(vacia), path.join(vacia, 'fadido.db'));
    assert.equal(fs.existsSync(path.join(vacia, 'fadido.db')), false);
    fs.rmSync(vacia, { recursive: true, force: true });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('el servidor arranca con la base de antes del cambio de nombre y conserva los datos y las copias', async () => {
  // Instalación "vieja": base gastromanager.db con una venta y una copia gastromanager_...
  const s0 = await iniciarServidor();
  await s0.q("INSERT INTO pedidos (numero_pedido, tipo, estado, subtotal, total) VALUES ('VIEJO-1', 'takeaway', 'pagado', 500, 500)");
  await s0.cerrar({ conservarDatos: true });
  const dir = s0.dataDir;
  try {
    for (const sufijo of ['-wal', '-shm', '']) if (fs.existsSync(path.join(dir, 'fadido.db' + sufijo))) fs.renameSync(path.join(dir, 'fadido.db' + sufijo), path.join(dir, 'gastromanager.db' + sufijo));
    fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
    fs.copyFileSync(path.join(dir, 'gastromanager.db'), path.join(dir, 'backups', 'gastromanager_2026-01-01_050000.db'));

    const s = await iniciarServidor({}, { dataDir: dir });
    try {
      assert.equal(fs.existsSync(path.join(dir, 'gastromanager.db')), false);
      assert.deepEqual((await s.q("SELECT numero_pedido FROM pedidos WHERE numero_pedido = 'VIEJO-1'")).length, 1, 'la venta sigue ahí');
      const [st, copias] = await s.llamar('GET', '/api/backups', null, s.tokenAdmin);
      assert.equal(st, 200);
      assert.ok(copias.some(c => c.nombre === 'gastromanager_2026-01-01_050000.db'), 'la copia vieja se sigue viendo');
      const [, nueva] = await s.llamar('POST', '/api/backups', {}, s.tokenAdmin);
      assert.match(nueva.nombre, /^fadido_/);
    } finally { await s.cerrar(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
