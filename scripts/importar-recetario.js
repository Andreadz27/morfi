// Carga sub-recetas (salsas, cremas...) desde un archivo JSON: crea los insumos que falten y arma cada receta.
// Se puede correr con el servidor andando y más de una vez: busca por nombre y reemplaza la receta (no duplica).
// Antes de cargar hace una copia de seguridad de la base.
//
// Uso:  npm run recetario:importar -- C:\ruta\recetario.json
// Formato: { "subrecetas": [ { "nombre": "Salsa Ranch", "rendimiento": 5,
//            "ingredientes": [ { "nombre": "Mayonesa", "cantidad": 100, "unidad": "g" } ] } ] }
// Usa la base de GM_DATA_DIR (por defecto data/).
'use strict';
const fs = require('fs');

async function main() {
  const archivo = process.argv[2];
  if (!archivo) throw new Error('Falta el archivo: npm run recetario:importar -- recetario.json');
  const { subrecetas } = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  if (!Array.isArray(subrecetas) || !subrecetas.length) throw new Error('El archivo no tiene "subrecetas"');

  // Se cargan los módulos del sistema: misma base, mismas migraciones y mismas reglas que el servidor
  const { run, get, transaccion } = require('../src/db');
  const { migrarConRespaldo } = require('../src/migraciones');
  const { crearBackup } = require('../src/servicios/backups');
  const { guardarRecetaTx } = require('../src/servicios/recetas');
  const { DATA_DIR } = require('../src/config');

  if (!(await get("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'productos'"))) {
    throw new Error(`No hay base en ${DATA_DIR}. Ejecuta primero: npm run init-db`);
  }
  await migrarConRespaldo({ respaldar: crearBackup });
  const copia = await crearBackup();

  const resumen = { insumos: 0, subrecetas: 0, actualizadas: 0 };
  await transaccion(async () => {
    const buscar = nombre => get('SELECT id, clase FROM productos WHERE nombre = ? COLLATE NOCASE AND activo = 1 ORDER BY id LIMIT 1', [nombre]);
    for (const sr of subrecetas) {
      const nombre = String(sr.nombre || '').trim();
      const rendimiento = Number(sr.rendimiento) || 1;
      if (!nombre || !Array.isArray(sr.ingredientes) || !sr.ingredientes.length) throw new Error(`Sub-receta incompleta: ${nombre || '(sin nombre)'}`);
      if (!(rendimiento > 0 && rendimiento <= 10000)) throw new Error(`Rendimiento inválido en ${nombre}`);

      const lineas = [];
      for (const ing of sr.ingredientes) {
        const nombreIng = String(ing.nombre || '').trim();
        if (!nombreIng) throw new Error(`Ingrediente sin nombre en ${nombre}`);
        let existente = await buscar(nombreIng);
        if (!existente) {
          const r = await run(`INSERT INTO productos (nombre, categoria_id, precio_venta, costo, clase, unidad) VALUES (?, NULL, 0, 0, 'insumo', ?)`,
            [nombreIng, String(ing.unidad || 'unidad')]);
          existente = { id: r.id };
          resumen.insumos++;
        }
        lineas.push({ ingrediente_id: existente.id, cantidad: ing.cantidad });
      }

      const actual = await buscar(nombre);
      if (actual && actual.clase !== 'elaboracion') throw new Error(`Ya hay un producto "${nombre}" que no es sub-receta: cambiale el nombre a uno de los dos`);
      let id;
      if (actual) {
        id = actual.id;
        await run('UPDATE productos SET rendimiento = ? WHERE id = ?', [rendimiento, id]);
        resumen.actualizadas++;
      } else {
        id = (await run(`INSERT INTO productos (nombre, categoria_id, precio_venta, costo, clase, rendimiento) VALUES (?, NULL, 0, 0, 'elaboracion', ?)`,
          [nombre, rendimiento])).id;
        resumen.subrecetas++;
      }
      await guardarRecetaTx(id, lineas);
    }
    await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (NULL, ?, ?)', ['importar_recetario',
      `Recetario importado por script: ${resumen.subrecetas} sub-recetas nuevas, ${resumen.actualizadas} actualizadas, ${resumen.insumos} insumos nuevos`]);
  });

  console.log(`\n  Recetario cargado en ${DATA_DIR} (copia previa: ${copia && copia.nombre})`);
  console.log(`    Sub-recetas nuevas:      ${resumen.subrecetas}`);
  console.log(`    Sub-recetas actualizadas: ${resumen.actualizadas}`);
  console.log(`    Insumos nuevos:          ${resumen.insumos}`);
  console.log('  Los insumos nuevos quedan con costo 0: cargale el costo a cada uno en Productos > Insumos.\n');
}

main().then(() => process.exit(0), err => {
  console.error('No se pudo cargar el recetario:', err.message);
  process.exit(1);
});
