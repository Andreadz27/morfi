// Actualizador y cambios de nombre: si una actualización falla y vuelve a una versión de antes de un cambio de
// nombre (GastroManager o Morfi), la base recupera el nombre que esa versión espera (si no, crearía una vacía).
// Van aparte de cambio-nombre.test.js (y uno por archivo): cada uno arma un repositorio y corre el actualizador, y juntos pasaban
// el límite de 60 s por archivo en Windows (CI).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const { SECRET_KEY } = require('./helpers');

// Como cambio-nombre-actualizador.test.js, pero la versión anterior es de Morfi: abre la base con rutaBase() y su archivo-base.js la llama morfi.db
test('actualizador: al volver a una versión de Morfi, la base vuelve a llamarse morfi.db', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-nombre-act-'));
  const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@test.com', ...a], { cwd, encoding: 'utf8' }).trim();
  const bare = path.join(tmp, 'origen.git'), inst = path.join(tmp, 'instalacion'), dev = path.join(tmp, 'dev'), datos = path.join(tmp, 'datos');
  try {
    git(tmp, 'init', '--bare', '--quiet', '-b', 'main', bare);
    git(RAIZ, 'push', '--quiet', bare, 'HEAD:refs/heads/main');
    git(tmp, 'clone', '--quiet', bare, dev);
    for (const f of ['scripts/actualizar.js', 'src/servicios/backups.js', 'src/archivo-base.js', 'src/db.js'])
      fs.copyFileSync(path.join(RAIZ, f), path.join(dev, f));
    const baseNueva = fs.readFileSync(path.join(dev, 'src', 'archivo-base.js'), 'utf8');
    fs.writeFileSync(path.join(dev, 'src', 'archivo-base.js'), baseNueva.replace("const ARCHIVO_BASE = 'fadido.db'", "const ARCHIVO_BASE = 'morfi.db'"));
    // La copia previa la hace la versión instalada. En la vida real, cuando la base ya es fadido.db es porque arrancó la
    // versión nueva; acá se simula ese estado, así que la copia apunta a fadido.db (si no, crearía una morfi.db vacía)
    const copias = fs.readFileSync(path.join(dev, 'src', 'servicios', 'backups.js'), 'utf8');
    fs.writeFileSync(path.join(dev, 'src', 'servicios', 'backups.js'), copias.replace('rutaBase(DATA_DIR)', "require('path').join(DATA_DIR, 'fadido.db')"));
    git(dev, 'add', '-A');
    git(dev, 'commit', '--quiet', '-m', 'Versión de Morfi');
    git(dev, 'push', '--quiet', 'origin', 'main');
    git(tmp, 'clone', '--quiet', bare, inst);
    fs.symlinkSync(path.join(RAIZ, 'node_modules'), path.join(inst, 'node_modules'), 'junction');
    const anterior = git(inst, 'rev-parse', 'HEAD');

    const env = { ...process.env, GM_DATA_DIR: datos, SECRET_KEY, GM_ENV_FILE: path.join(tmp, 'sin.env') };
    execFileSync(process.execPath, [path.join(RAIZ, 'init-db.js')], { env, stdio: 'ignore' });
    assert.ok(fs.existsSync(path.join(datos, 'fadido.db')));

    fs.writeFileSync(path.join(dev, 'src', 'archivo-base.js'), baseNueva);
    fs.appendFileSync(path.join(dev, 'package-lock.json'), '\n');
    git(dev, 'add', '-A');
    git(dev, 'commit', '--quiet', '-m', 'Versión Fadido');
    git(dev, 'push', '--quiet', 'origin', 'main');

    const r = spawnSync(process.execPath, [path.join(inst, 'scripts', 'actualizar.js'), '--sin-npm', '--sin-reiniciar', '--simular-falla-npm'],
      { cwd: inst, env, encoding: 'utf8' });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.equal(git(inst, 'rev-parse', 'HEAD'), anterior);
    assert.match(r.stdout, /usa data\/morfi\.db: se le devolvió ese nombre a la base/);
    assert.ok(fs.existsSync(path.join(datos, 'morfi.db')), 'la versión de Morfi encuentra su base');
    assert.equal(fs.existsSync(path.join(datos, 'fadido.db')), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
