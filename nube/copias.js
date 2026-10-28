'use strict';
// Fadido Nube: copia de seguridad de su base (cuentas, locales y sus tokens, ventas, cartas), como la del local.
// Cada 24 h en NUBE_DATOS/copias (se conservan las últimas NUBE_COPIAS_CONSERVAR, 30 por defecto). Además:
// - NUBE_COPIA_DIR (o BACKUP_COPIA_DIR): un duplicado en otra carpeta, por ejemplo una sincronizada con Drive.
// - BACKUP_S3_* (como el local, src/servicios/copia-nube.js): se sube al bucket en la carpeta "nube", cifrada
//   con BACKUP_CLAVE si está.
// Restaurar: detener la nube (pm2 stop fadido-nube), copiar la copia elegida sobre NUBE_DATOS/nube.db, borrar
// nube.db-wal y nube.db-shm, y volver a iniciarla. Si se pierde, los locales mandan lo que tengan sin enviar, pero
// las cuentas, los usuarios del panel y los tokens de los locales solo están acá.
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const { DIR } = require('./db');
const { configNube, subirCopia } = require('../src/servicios/copia-nube');

const DIR_COPIAS = path.join(DIR, 'copias');
const CONSERVAR = Math.max(1, parseInt(process.env.NUBE_COPIAS_CONSERVAR, 10) || 30);
const NOMBRE = /^nube_\d{4}-\d{2}-\d{2}_\d{6}(_\d{1,3})?\.db$/;

function listarCopias() {
  if (!fs.existsSync(DIR_COPIAS)) return [];
  return fs.readdirSync(DIR_COPIAS).filter(n => NOMBRE.test(n)).sort().reverse()
    .map(nombre => ({ nombre, fecha: fs.statSync(path.join(DIR_COPIAS, nombre)).mtime.toISOString() }));
}

let enCurso = null;
function crearCopia() {
  if (enCurso) return enCurso;
  enCurso = (async () => {
    fs.mkdirSync(DIR_COPIAS, { recursive: true });
    const base = 'nube_' + new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '');
    let nombre = `${base}.db`;
    for (let n = 2; fs.existsSync(path.join(DIR_COPIAS, nombre)); n++) nombre = `${base}_${n}.db`;
    const destino = path.join(DIR_COPIAS, nombre);
    // Se escribe con otro nombre y se renombra al terminar: mientras se escribía, la copia a medio hacer ya figuraba
    // como la última (en /api/salud y en la rotación)
    const parcial = destino + '.parcial';
    fs.rmSync(parcial, { force: true });
    // VACUUM INTO: copia consistente aunque la nube esté recibiendo ventas (conexión propia, como en el local)
    await new Promise((ok, mal) => {
      const con = new sqlite3.Database(path.join(DIR, 'nube.db'));
      con.configure('busyTimeout', 10000);
      con.run('VACUUM INTO ?', [parcial], e => con.close(() => e ? mal(e) : ok()));
    });
    fs.renameSync(parcial, destino);
    const otraCarpeta = process.env.NUBE_COPIA_DIR || process.env.BACKUP_COPIA_DIR;
    if (otraCarpeta) {
      try {
        fs.mkdirSync(otraCarpeta, { recursive: true });
        fs.copyFileSync(destino, path.join(otraCarpeta, nombre));
      } catch (e) { console.error('[nube] No se pudo copiar a', otraCarpeta + ':', e.message); }
    }
    for (const vieja of listarCopias().slice(CONSERVAR)) {
      try { fs.unlinkSync(path.join(DIR_COPIAS, vieja.nombre)); } catch (e) {}
    }
    console.log(`[nube] Copia creada: ${nombre}`);
    const cfg = configNube();
    if (cfg) {
      cfg.prefijo = [cfg.prefijo, 'nube'].filter(Boolean).join('/');
      subirCopia(destino, cfg).catch(e => console.error('[nube] Error al subir la copia:', e.message));
    }
    return nombre;
  })().finally(() => { enCurso = null; });
  return enCurso;
}

// Al iniciar y cada hora: copia si la última tiene más de 24 h
async function copiaSiCorresponde() {
  try {
    const ultima = listarCopias()[0];
    if (!ultima || Date.now() - Date.parse(ultima.fecha) >= 24 * 3600 * 1000) await crearCopia();
  } catch (e) { console.error('[nube] Error en la copia automática:', e.message); }
}

module.exports = { DIR_COPIAS, listarCopias, crearCopia, copiaSiCorresponde };
