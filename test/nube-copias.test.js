// Morfi Nube: copia de su base al iniciar (y cada 24 h), rotación y duplicado en otra carpeta.
// Su base tiene las cuentas, los usuarios del panel y los tokens de los locales: sin copia, un disco roto los perdía.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const sqlite3 = require('sqlite3');
const { esperar } = require('./helpers');

const RAIZ = path.join(__dirname, '..');
const puertoLibre = () => new Promise(ok => { const x = net.createServer(); x.listen(0, () => { const { port } = x.address(); x.close(() => ok(port)); }); });

test('al iniciar copia la base, conserva solo las últimas y deja un duplicado en NUBE_COPIA_DIR', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'morfi-nube-copias-'));
  const datos = path.join(tmp, 'datos'), otra = path.join(tmp, 'drive');
  // Dos copias viejas: con NUBE_COPIAS_CONSERVAR=2, al crear la nueva se borra la más vieja
  fs.mkdirSync(path.join(datos, 'copias'), { recursive: true });
  for (const n of ['nube_2026-01-01_000000.db', 'nube_2026-01-02_000000.db']) {
    const f = path.join(datos, 'copias', n);
    fs.writeFileSync(f, 'vieja');
    const hace = new Date(Date.now() - 3 * 24 * 3600 * 1000);
    fs.utimesSync(f, hace, hace);
  }
  const port = await puertoLibre();
  const nube = spawn(process.execPath, [path.join(RAIZ, 'nube', 'servidor.js')], { stdio: 'ignore',
    env: { ...process.env, NUBE_DATOS: datos, PORT: String(port), NUBE_COPIAS_CONSERVAR: '2', NUBE_COPIA_DIR: otra,
      BACKUP_S3_ENDPOINT: '', BACKUP_COPIA_DIR: '' } });
  try {
    // Hasta que informe la copia NUEVA (las dos viejas ya figuran desde el arranque)
    const reciente = s => s && s.ultima_copia && Date.parse(s.ultima_copia) > Date.now() - 60000;
    let salud = null;
    for (let t = 0; t < 30000 && !reciente(salud); t += 250) {
      try { salud = await (await fetch(`http://127.0.0.1:${port}/api/salud`)).json(); } catch (e) {}
      if (!reciente(salud)) await esperar(250);
    }
    assert.ok(reciente(salud), '/api/salud informa la copia recién hecha: ' + JSON.stringify(salud));
    const copias = fs.readdirSync(path.join(datos, 'copias')).sort();
    assert.equal(copias.length, 2, copias.join(', '));
    assert.equal(copias[0], 'nube_2026-01-02_000000.db', 'se borró la más vieja');
    const nueva = copias[1];
    assert.match(nueva, /^nube_\d{4}-\d{2}-\d{2}_\d{6}\.db$/);
    assert.ok(fs.existsSync(path.join(otra, nueva)), 'duplicado en NUBE_COPIA_DIR');

    // La copia es una base de la nube que se puede abrir
    const tablas = await new Promise((ok, mal) => {
      const db = new sqlite3.Database(path.join(datos, 'copias', nueva), sqlite3.OPEN_READONLY);
      db.all("SELECT name FROM sqlite_master WHERE type = 'table'", (e, r) => db.close(() => e ? mal(e) : ok(r.map(x => x.name))));
    });
    for (const t of ['cuentas', 'usuarios', 'locales', 'ventas']) assert.ok(tablas.includes(t), `falta la tabla ${t}`);
  } finally {
    nube.kill();
    await esperar(300);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
