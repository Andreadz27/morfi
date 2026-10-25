'use strict';
// Carta en otros idiomas: cada producto y categoría guarda sus traducciones en la columna `traducciones`
// como JSON { en: { nombre, descripcion }, pt: { ... } }. El español es el nombre de siempre: si falta una
// traducción, la carta muestra el español. Cocina, caja y tickets siguen en español.
const { errorHttp } = require('./util');

const IDIOMAS = ['en', 'pt'];
const LARGO = { nombre: 120, descripcion: 500 };

// Normaliza lo que manda el formulario. Devuelve el JSON a guardar, o null si no quedó ninguna traducción.
function normalizarTraducciones(valor, campos = ['nombre', 'descripcion']) {
  if (valor === null || valor === undefined || valor === '') return null;
  let t = valor;
  if (typeof t === 'string') {
    try { t = JSON.parse(t); } catch (e) { throw errorHttp(400, 'Traducciones inválidas'); }
  }
  if (typeof t !== 'object' || Array.isArray(t)) throw errorHttp(400, 'Traducciones inválidas');
  const limpio = {};
  for (const [idioma, textos] of Object.entries(t)) {
    if (!IDIOMAS.includes(idioma)) throw errorHttp(400, `Idioma no soportado: ${idioma}`);
    if (!textos || typeof textos !== 'object') continue;
    const fila = {};
    for (const campo of campos) {
      const texto = String(textos[campo] || '').trim();
      if (texto.length > LARGO[campo]) throw errorHttp(400, `La traducción (${idioma}) del ${campo} es muy larga`);
      if (texto) fila[campo] = texto;
    }
    if (Object.keys(fila).length) limpio[idioma] = fila;
  }
  return Object.keys(limpio).length ? JSON.stringify(limpio) : null;
}

// Para la carta pública: el objeto, o {} si no hay (o si quedó algo ilegible en la base)
function leerTraducciones(texto) {
  if (!texto) return {};
  try { const t = JSON.parse(texto); return t && typeof t === 'object' && !Array.isArray(t) ? t : {}; } catch (e) { return {}; }
}

module.exports = { IDIOMAS, normalizarTraducciones, leerTraducciones };
