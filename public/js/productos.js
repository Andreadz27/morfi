// =============================================
// MORFI - Productos
// CRUD de productos y categor\u00edas
// =============================================

const Productos = {
  productos: [],
  categorias: [],

  async render() {
    const view = document.getElementById('view-productos');
    view.innerHTML = '<div class="text-center mt-20"><i class="fas fa-spinner fa-spin fa-3x"></i></div>';
    try {
      const [productos, categorias, momentos] = await Promise.all([API.getProductos(), API.getCategorias(), API.getMomentos().catch(() => [])]);
      this.momentos = momentos;
      this.productos = productos;
      this.categorias = categorias;
      this.paint(view);
    } catch (err) {
      view.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error: ${esc(err.message)}</p></div>`;
    }
  },

  esAdmin() {
    return App.puede('catalogo');
  },

  // Filtro de la vista: categoría elegida ('todas' o su id) y texto buscado
  filtroCat: 'todas',
  busqueda: '',

  paint(view) {
    const esAdmin = this.esAdmin();
    const cuenta = id => this.productos.filter(p => p.categoria_id === id).length;
    const sinCat = this.productos.filter(p => !this.categorias.some(c => c.id === p.categoria_id)).length;
    const chip = (id, nombre, n, color, icono) => `
      <button class="pos-cat-btn ${String(this.filtroCat) === String(id) ? 'active' : ''}" onclick="Productos.verCategoria('${id}')"
        ${color ? `style="--cat-color:${esc(color)}"` : ''}>
        ${icono ? `<i class="fas ${icono}"></i> ` : `<span class="prod-cat-punto" style="background:${esc(color || '#64748b')}"></span>`}${esc(nombre)}
        <span class="pos-cat-count">${n}</span>
      </button>`;
    const chips = [
      chip('todas', 'Todas', this.productos.length, '', 'fa-th-large'),
      ...this.categorias.map(c => chip(c.id, c.nombre, cuenta(c.id), c.color)),
      ...(sinCat ? [chip('sin', 'Sin categoría', sinCat, '#94a3b8')] : [])
    ].join('');

    view.innerHTML = `
      <div class="page-header">
        <div>
          <h2><i class="fas fa-hamburger"></i> Productos</h2>
          <p>${this.productos.length} productos en ${this.categorias.length} categorías</p>
        </div>
        <div>
          ${
            esAdmin ? `
            <button class="btn btn-primary" onclick="Productos.nuevaCategoria()"><i class="fas fa-tag"></i> Categoría</button>
            <button class="btn btn-success" onclick="Productos.nuevo()"><i class="fas fa-plus"></i> Nuevo producto</button>
            ` : ''
          }
          <button class="btn btn-outline" onclick="Productos.render()"><i class="fas fa-sync-alt"></i> Refrescar</button>
        </div>
      </div>

      <div class="card mb-20">
        <div class="prod-buscador">
          <i class="fas fa-search"></i>
          <input type="search" id="prodBuscar" placeholder="Buscar producto..." value="${esc(this.busqueda)}"
            oninput="Productos.buscar(this.value)" aria-label="Buscar producto">
        </div>
        <div class="pos-categories">${chips}</div>
      </div>

      ${esAdmin ? this.htmlMomentos() : ''}

      <div id="prodListado">${this.htmlListado(esAdmin)}</div>
    `;
  },

  // Productos agrupados por categoría, en el orden de la carta; cada grupo con su color y cantidad
  htmlListado(esAdmin = this.esAdmin()) {
    if (!this.productos.length) return `<div class="card"><div class="empty-state"><i class="fas fa-box-open"></i><p>Sin productos</p></div></div>`;
    const texto = this.busqueda.trim().toLowerCase();
    const coincide = p => !texto || p.nombre.toLowerCase().includes(texto) || String(p.descripcion || '').toLowerCase().includes(texto);
    const grupos = [
      ...this.categorias.map(c => ({ id: c.id, nombre: c.nombre, color: c.color, nota: c.descripcion, productos: this.productos.filter(p => p.categoria_id === c.id) })),
      { id: 'sin', nombre: 'Sin categoría', color: '#94a3b8', productos: this.productos.filter(p => !this.categorias.some(c => c.id === p.categoria_id)) }
    ].filter(g => this.filtroCat === 'todas' || String(g.id) === String(this.filtroCat))
      .map(g => ({ ...g, productos: g.productos.filter(coincide) }))
      .filter(g => g.productos.length);
    if (!grupos.length) return `<div class="card"><div class="empty-state"><i class="fas fa-search"></i><p>No hay productos${texto ? ` que coincidan con "${esc(this.busqueda.trim())}"` : ' en esta categoría'}</p></div></div>`;

    const fila = p => `
      <tr>
        <td><div class="font-bold">${esc(p.nombre)}</div>${p.descripcion ? `<small class="text-muted prod-desc">${esc(p.descripcion)}</small>` : ''}</td>
        <td class="font-bold">${fmtMoneda(p.precio_venta)}</td>
        <td>${fmtMoneda(p.costo)}</td>
        <td>${p.tracking_stock
          ? `<span class="${p.stock_actual <= p.stock_minimo ? 'text-danger font-bold' : ''}">${p.stock_actual} ${esc(p.unidad || '')}</span>`
          : '<span class="text-muted">Sin control</span>'}</td>
        <td>${p.es_plato ? '<span class="badge badge-blue">Plato</span>' : '<span class="badge badge-gray">Producto</span>'}</td>
        ${esAdmin ? `
          <td class="prod-acciones">
            <button class="btn btn-outline btn-sm" onclick="Productos.receta(${p.id})" title="Receta e ingredientes">
              <i class="fas fa-blender"></i>${p.ingredientes_receta ? ` ${p.ingredientes_receta}` : ''}</button>
            <button class="btn btn-outline btn-sm" onclick="Productos.editar(${p.id})" title="Editar"><i class="fas fa-edit"></i></button>
            <button class="btn btn-danger btn-sm" onclick="Productos.eliminar(${p.id})" title="Eliminar"><i class="fas fa-trash"></i></button>
          </td>` : ''}
      </tr>`;
    return grupos.map(g => `
      <div class="card mb-20 prod-grupo" style="--cat-color:${esc(g.color || '#64748b')}">
        <div class="card-header">
          <span class="card-title"><span class="prod-cat-punto"></span> ${esc(g.nombre)}</span>
          <span>
            ${esAdmin && g.id !== 'sin' ? `<button class="btn btn-outline btn-sm" onclick="Productos.editarCategoria(${Number(g.id)})" title="Editar categoría"><i class="fas fa-edit"></i></button>` : ''}
            <span class="pos-cat-count">${g.productos.length}</span>
          </span>
        </div>
        ${g.nota ? `<div class="prod-nota-categoria"><i class="fas fa-info-circle"></i> ${esc(g.nota)} <small>(se ve en la carta)</small></div>` : ''}
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Producto</th><th>Precio</th><th>Costo</th><th>Stock</th><th>Tipo</th>${esAdmin ? '<th>Acciones</th>' : ''}</tr>
            </thead>
            <tbody>${g.productos.map(fila).join('')}</tbody>
          </table>
        </div>
      </div>`).join('');
  },

  verCategoria(id) {
    this.filtroCat = id;
    this.paint(document.getElementById('view-productos'));
  },

  // Al escribir solo se rehace el listado: el buscador no pierde el foco
  buscar(texto) {
    this.busqueda = texto;
    const el = document.getElementById('prodListado');
    if (el) el.innerHTML = this.htmlListado();
  },

  nuevo() {
    this.abrirFormulario(null);
  },

  editar(id) {
    const p = this.productos.find(x => x.id === id);
    if (p) this.abrirFormulario(p);
  },

  abrirFormulario(p) {
    const catOptions = this.categorias.map(c =>
      `<option value="${c.id}" ${p && p.categoria_id === c.id ? 'selected' : ''}>${esc(c.nombre)}</option>`
    ).join('');

    App.showModal(`
      <form onsubmit="Productos.guardar(event, ${p ? p.id : 'null'})">
        <div class="form-group">
          <label>Nombre</label>
          <input type="text" id="prodNombre" value="${p ? esc(p.nombre) : ''}" required>
        </div>
        <div class="form-group">
          <label>Descripci\u00f3n</label>
          <textarea id="prodDescripcion">${p ? esc(p.descripcion || '') : ''}</textarea>
        </div>
        <div class="grid grid-2">
          <div class="form-group">
            <label>Categor\u00eda</label>
            <select id="prodCategoria">${catOptions}</select>
          </div>
          <div class="form-group">
            <label>Tipo</label>
            <select id="prodTipo">
              <option value="1" ${p && p.es_plato ? 'selected' : ''}>Plato</option>
              <option value="0" ${p && !p.es_plato ? 'selected' : ''}>Producto simple</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label>Orden en la carta</label>
          <input type="number" id="prodOrden" min="0" step="1" value="${p && p.orden ? p.orden : ''}" placeholder="Ej: 1 = primero de su categoría">
          <small class="form-hint">Posición dentro de su categoría, como en la carta impresa. Vacío: va después, por nombre.</small>
        </div>
        <div class="grid grid-2">
          <div class="form-group">
            <label>Precio de venta ($)</label>
            <input type="number" id="prodPrecio" min="0" step="0.01" value="${p ? p.precio_venta : ''}" required>
          </div>
          <div class="form-group">
            <label>Costo ($)</label>
            <input type="number" id="prodCosto" min="0" step="0.01" value="${p ? p.costo : '0'}" ${p && p.ingredientes_receta ? 'readonly' : ''}>
            ${p && p.ingredientes_receta ? '<small class="form-hint">Lo calcula la receta: se actualiza solo cuando cambian los ingredientes.</small>' : ''}
          </div>
        </div>
        <div class="grid grid-2">
          <div class="form-group">
            <label>Unidad</label>
            <input type="text" id="prodUnidad" value="${p ? esc(p.unidad || '') : ''}" placeholder="Ej: unidad, kg, lt">
          </div>
          <div class="form-group">
            <label>Stock m\u00ednimo</label>
            <input type="number" id="prodStockMin" min="0" value="${p ? p.stock_minimo : '0'}">
          </div>
        </div>
        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="prodTracking" ${p && p.tracking_stock ? 'checked' : ''}>
            Controlar stock
          </label>
        </div>
        <div class="form-group">
          <label>Destacar en la carta</label>
          <label class="checkbox-label"><input type="checkbox" id="prodRecomendado" ${p && p.recomendado ? 'checked' : ''}> Recomendado de la casa</label>
          <label class="checkbox-label"><input type="checkbox" id="prodNuevo" ${p && p.nuevo ? 'checked' : ''}> Nuevo</label>
          <small class="form-hint">"Lo más pedido" se marca solo con las ventas de las últimas 4 semanas.</small>
        </div>
        <div class="form-group" id="stockInicialGroup" ${(!p && 'style="display:none"') || ''}>
          <label>Stock inicial</label>
          <input type="number" id="prodStockInicial" min="0" value="${p ? p.stock_actual : '0'}">
        </div>
        ${this.htmlTraducciones('prod', p && p.traducciones, true)}
        <div class="modal-footer">
          <button type="button" class="btn btn-danger" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-success">Guardar</button>
        </div>
      </form>
    `, { title: p ? `Editar ${p.nombre}` : 'Nuevo producto' });

    document.getElementById('prodTracking').addEventListener('change', (e) => {
      document.getElementById('stockInicialGroup').style.display = e.target.checked ? 'block' : 'none';
    });
  },
async guardar(e, id) {
    e.preventDefault();
    const data = {
      nombre: document.getElementById('prodNombre').value,
      descripcion: document.getElementById('prodDescripcion').value,
      categoria_id: parseInt(document.getElementById('prodCategoria').value),
      es_plato: document.getElementById('prodTipo').value === '1',
      precio_venta: parseFloat(document.getElementById('prodPrecio').value),
      costo: parseFloat(document.getElementById('prodCosto').value || 0),
      unidad: document.getElementById('prodUnidad').value,
      stock_minimo: parseInt(document.getElementById('prodStockMin').value || 0),
      tracking_stock: document.getElementById('prodTracking').checked ? 1 : 0,
      orden: parseInt(document.getElementById('prodOrden').value || 0),
      recomendado: document.getElementById('prodRecomendado').checked ? 1 : 0,
      nuevo: document.getElementById('prodNuevo').checked ? 1 : 0,
      traducciones: this.leerTraducciones('prod', true)
    };
    if (data.tracking_stock && !id) {
      data.stock_actual = parseInt(document.getElementById('prodStockInicial').value || 0);
    }
    try {
      if (id) {
        await API.updateProducto(id, data);
        App.showToast('Producto actualizado', 'success');
      } else {
        await API.createProducto(data);
        App.showToast('Producto creado', 'success');
      }
      App.closeModal();
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  // Carta QR en ingl\u00e9s y portugu\u00e9s (src/traducciones.js). Lo que se deja vac\u00edo se muestra en espa\u00f1ol.
  IDIOMAS: { en: 'Ingl\u00e9s', pt: 'Portugu\u00e9s' },
  htmlTraducciones(prefijo, guardadas, conDescripcion) {
    let t = {};
    try { t = typeof guardadas === 'string' ? JSON.parse(guardadas) || {} : guardadas || {}; } catch (e) { t = {}; }
    const algo = Object.keys(t).length > 0;
    const filas = Object.entries(this.IDIOMAS).map(([k, nombre]) => `
      <div class="form-group">
        <label>${nombre}: nombre</label>
        <input type="text" id="${prefijo}Tr_${k}_nombre" maxlength="120" value="${esc((t[k] && t[k].nombre) || '')}">
      </div>
      ${conDescripcion ? `<div class="form-group">
        <label>${nombre}: descripci\u00f3n</label>
        <textarea id="${prefijo}Tr_${k}_descripcion" maxlength="500">${esc((t[k] && t[k].descripcion) || '')}</textarea>
      </div>` : ''}`).join('');
    return `<details class="form-group" ${algo ? 'open' : ''}>
        <summary><i class="fas fa-language"></i> Carta QR en otros idiomas (opcional)</summary>
        <small class="form-hint">Los clientes eligen ES / EN / PT en la carta del QR. Lo que dejes vac\u00edo se ve en espa\u00f1ol.</small>
        ${filas}
      </details>`;
  },
  leerTraducciones(prefijo, conDescripcion) {
    const t = {};
    for (const k of Object.keys(this.IDIOMAS)) {
      const valor = campo => { const el = document.getElementById(`${prefijo}Tr_${k}_${campo}`); return el ? el.value.trim() : ''; };
      t[k] = { nombre: valor('nombre') };
      if (conDescripcion) t[k].descripcion = valor('descripcion');
    }
    return t;
  },

  async eliminar(id) {
    if (!confirm('\u00bfSeguro que deseas eliminar este producto?')) return;
    try {
      await API.deleteProducto(id);
      App.showToast('Producto eliminado', 'success');
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  // ===== Momentos de la carta (Desayuno, Brunch, Almuerzo, Merienda) =====
  momentos: [],
  htmlMomentos() {
    const botones = this.momentos.map(m => `
      <button class="pos-cat-btn" onclick="Productos.formMomento(${Number(m.id)})" title="Editar">
        ${m.icono ? esc(m.icono) + ' ' : ''}${esc(m.nombre)} <span class="pos-cat-count">${esc(m.desde)}–${esc(m.hasta)}</span>${m.activo ? '' : ' (apagado)'}
      </button>`).join('');
    return `
      <div class="card mb-20">
        <div class="card-header">
          <span class="card-title"><i class="fas fa-clock"></i> Momentos de la carta</span>
          <button class="btn btn-outline btn-sm" onclick="Productos.formMomento(null)"><i class="fas fa-plus"></i> Momento</button>
        </div>
        <p class="text-muted">La carta del QR abre en el momento de la hora (por ejemplo, a las 9 en el Desayuno) y muestra los otros a un toque.</p>
        <div class="pos-categories">${botones || '<span class="text-muted">Todavía no hay momentos: la carta muestra todo junto.</span>'}</div>
      </div>`;
  },

  formMomento(id) {
    const m = this.momentos.find(x => x.id === id) || null;
    const elegidas = m ? m.categorias : [];
    const t = (m && m.traducciones) || {};
    // Primero las elegidas, en su orden; después las demás
    const cats = [...elegidas.map(i => this.categorias.find(c => c.id === i)).filter(Boolean), ...this.categorias.filter(c => !elegidas.includes(c.id))];
    App.showModal(`
      <form onsubmit="Productos.guardarMomento(event, ${m ? Number(m.id) : 'null'})">
        <div class="grid grid-2">
          <div class="form-group"><label>Nombre</label><input type="text" id="momNombre" maxlength="40" value="${m ? esc(m.nombre) : ''}" placeholder="Ej.: Desayuno" required></div>
          <div class="form-group"><label>Ícono (emoji)</label><input type="text" id="momIcono" maxlength="8" value="${m ? esc(m.icono) : ''}" placeholder="🌅"></div>
        </div>
        <div class="grid grid-2">
          <div class="form-group"><label>Desde</label><input type="time" id="momDesde" value="${m ? esc(m.desde) : '08:00'}" required></div>
          <div class="form-group"><label>Hasta</label><input type="time" id="momHasta" value="${m ? esc(m.hasta) : '12:00'}" required></div>
        </div>
        <div class="form-group">
          <label>Categorías de este momento (en este orden)</label>
          <div class="cierre-dias">${cats.map(c => `<label class="checkbox-label"><input type="checkbox" class="momCat" value="${Number(c.id)}" ${elegidas.includes(c.id) ? 'checked' : ''}> ${esc(c.nombre)}</label>`).join('')}</div>
          <small class="form-hint">Una categoría puede estar en varios momentos (por ejemplo, los cafés en el desayuno y en la merienda).</small>
        </div>
        <div class="grid grid-2">
          <div class="form-group"><label>Inglés: nombre</label><input type="text" id="momEn" maxlength="40" value="${esc((t.en && t.en.nombre) || '')}" placeholder="Breakfast"></div>
          <div class="form-group"><label>Portugués: nombre</label><input type="text" id="momPt" maxlength="40" value="${esc((t.pt && t.pt.nombre) || '')}" placeholder="Café da manhã"></div>
        </div>
        <div class="form-group"><label class="checkbox-label"><input type="checkbox" id="momActivo" ${!m || m.activo ? 'checked' : ''}> Mostrar en la carta</label></div>
        <div class="modal-footer">
          ${m ? `<button type="button" class="btn btn-danger" onclick="Productos.borrarMomento(${Number(m.id)})"><i class="fas fa-trash"></i> Borrar</button>` : ''}
          <button type="button" class="btn btn-outline" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-success">Guardar</button>
        </div>
      </form>`, { title: m ? `Momento: ${m.nombre}` : 'Nuevo momento de la carta' });
  },

  async guardarMomento(e, id) {
    e.preventDefault();
    const data = {
      nombre: document.getElementById('momNombre').value,
      icono: document.getElementById('momIcono').value,
      desde: document.getElementById('momDesde').value,
      hasta: document.getElementById('momHasta').value,
      categorias: [...document.querySelectorAll('.momCat')].filter(x => x.checked).map(x => Number(x.value)),
      activo: document.getElementById('momActivo').checked ? 1 : 0,
      orden: id ? (this.momentos.find(x => x.id === id) || {}).orden : this.momentos.length,
      traducciones: { en: { nombre: document.getElementById('momEn').value }, pt: { nombre: document.getElementById('momPt').value } }
    };
    try {
      if (id) await API.actualizarMomento(id, data);
      else await API.crearMomento(data);
      App.closeModal();
      App.showToast('Momento guardado', 'success');
      this.render();
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  async borrarMomento(id) {
    if (!confirm('¿Borrar este momento de la carta? Las categorías y los productos no se borran.')) return;
    try {
      await API.borrarMomento(id);
      App.closeModal();
      App.showToast('Momento borrado', 'success');
      this.render();
    } catch (err) { App.showToast(err.message, 'error'); }
  },


  nuevaCategoria() {
    this.formCategoria(null);
  },

  editarCategoria(id) {
    const c = this.categorias.find(x => x.id === id);
    if (c) this.formCategoria(c);
  },

  // La descripci\u00f3n es una nota que se ve en la carta debajo del t\u00edtulo (opciones de leche, horarios de las promos...)
  formCategoria(c) {
    App.showModal(`
      <form onsubmit="Productos.guardarCategoria(event, ${c ? Number(c.id) : 'null'})">
        <div class="form-group">
          <label>Nombre</label>
          <input type="text" id="catNombre" value="${c ? esc(c.nombre) : ''}" required>
        </div>
        <div class="form-group">
          <label>Nota en la carta (opcional)</label>
          <textarea id="catDescripcion" rows="2" placeholder="Ej.: Opciones de leche: entera, descremada, deslactosada. Leche vegetal + $1300">${c ? esc(c.descripcion || '') : ''}</textarea>
          <small class="form-hint">Se ve en un recuadro debajo del t\u00edtulo de la categor\u00eda, como en una carta impresa.</small>
        </div>
        <div class="grid grid-2">
          <div class="form-group">
            <label>Color</label>
            <input type="color" id="catColor" value="${c ? esc(c.color || '#64748b') : '#64748b'}">
          </div>
          <div class="form-group">
            <label>Orden</label>
            <input type="number" id="catOrden" value="${c ? Number(c.orden) || 0 : 0}">
          </div>
        </div>
        ${this.htmlTraducciones('cat', c && c.traducciones, true)}
        <div class="modal-footer">
          <button type="button" class="btn btn-danger" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-success">Guardar</button>
        </div>
      </form>
    `, { title: c ? `Editar ${c.nombre}` : 'Nueva categor\u00eda' });
  },

  async guardarCategoria(e, id) {
    e.preventDefault();
    const data = {
      nombre: document.getElementById('catNombre').value,
      descripcion: document.getElementById('catDescripcion').value,
      color: document.getElementById('catColor').value,
      orden: parseInt(document.getElementById('catOrden').value) || 0,
      traducciones: this.leerTraducciones('cat', true)
    };
    try {
      if (id) await API.updateCategoria(id, data);
      else await API.createCategoria(data);
      App.closeModal();
      App.showToast(id ? 'Categor\u00eda actualizada' : 'Categor\u00eda creada', 'success');
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  async eliminarCategoria(id) {
    if (!confirm('\u00bfSeguro que deseas eliminar esta categor\u00eda?')) return;
    try {
      await API.deleteCategoria(id);
      App.showToast('Categor\u00eda eliminada', 'success');
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  // ===== Receta: ingredientes del plato, su costo y el margen =====
  _receta: null,

  async receta(id) {
    try {
      const [r, productos] = await Promise.all([API.getReceta(id), API.getProductos()]);
      // Ingredientes posibles: productos activos sin receta propia (sin recetas anidadas)
      this._ingredientes = productos.filter(x => x.id !== id && !x.ingredientes_receta);
      this._receta = { id, nombre: r.nombre, precio: r.precio_venta,
        lineas: r.lineas.map(l => ({ ingrediente_id: l.ingrediente_id, cantidad: l.cantidad })) };
      if (!this._receta.lineas.length) this._receta.lineas.push({ ingrediente_id: '', cantidad: '' });
      this.pintarReceta();
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  costoReceta() {
    const porId = Object.fromEntries(this._ingredientes.map(i => [i.id, i]));
    return this._receta.lineas.reduce((s, l) => s + (Number(l.cantidad) || 0) * ((porId[l.ingrediente_id] || {}).costo || 0), 0);
  },

  pintarReceta() {
    const r = this._receta;
    const porId = Object.fromEntries(this._ingredientes.map(i => [i.id, i]));
    const opciones = sel => '<option value="">Elegí un ingrediente</option>' + this._ingredientes.map(i =>
      `<option value="${i.id}" ${String(sel) === String(i.id) ? 'selected' : ''}>${esc(i.nombre)} (${esc(i.unidad || 'unidad')})</option>`).join('');
    const filas = r.lineas.map((l, n) => {
      const ing = porId[l.ingrediente_id];
      return `<div class="receta-linea">
        <select onchange="Productos.setLinea(${n}, 'ingrediente_id', this.value)">${opciones(l.ingrediente_id)}</select>
        <input type="number" min="0" step="0.001" value="${l.cantidad}" placeholder="Cantidad" aria-label="Cantidad"
          oninput="Productos.setLinea(${n}, 'cantidad', this.value)">
        <span class="text-muted">${ing ? esc(ing.unidad || 'unidad') + ' · ' + fmtMoneda((Number(l.cantidad) || 0) * (ing.costo || 0)) : ''}</span>
        <button type="button" class="btn btn-sm btn-outline" onclick="Productos.quitarLinea(${n})" aria-label="Quitar"><i class="fas fa-times"></i></button>
      </div>`;
    }).join('');
    const costo = this.costoReceta();
    const margen = r.precio > 0 ? Math.round((r.precio - costo) / r.precio * 1000) / 10 : null;
    const html = `
      <p class="text-muted">Al cobrar, se descuenta el stock de cada ingrediente según la cantidad vendida.
        La cantidad va en la unidad del ingrediente (ej. 0.15 kg de carne).</p>
      ${filas}
      <button type="button" class="btn btn-sm btn-outline mt-10" onclick="Productos.agregarLinea()"><i class="fas fa-plus"></i> Ingrediente</button>
      <div class="cobro-totales mt-20">
        <div><span>Costo del plato</span><strong>${fmtMoneda(costo)}</strong></div>
        <div><span>Precio de venta</span><strong>${fmtMoneda(r.precio)}</strong></div>
        <div class="cobro-saldo"><span>Margen</span><strong>${margen === null ? '-' : margen + ' %'}</strong></div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-danger" onclick="Productos.guardarReceta(true)">Quitar receta</button>
        <button type="button" class="btn btn-outline" onclick="App.closeModal()">Cancelar</button>
        <button type="button" class="btn btn-success" onclick="Productos.guardarReceta(false)"><i class="fas fa-save"></i> Guardar receta</button>
      </div>`;
    const cuerpo = document.getElementById('recetaCuerpo');
    if (cuerpo && cuerpo.dataset.producto === String(r.id)) { cuerpo.innerHTML = html; return; }
    App.showModal(`<div id="recetaCuerpo" data-producto="${r.id}">${html}</div>`, { title: `Receta: ${r.nombre}`, large: true });
  },

  setLinea(n, campo, valor) {
    this._receta.lineas[n][campo] = valor;
    // Al tipear la cantidad no se redibuja la fila (no se pierde el foco): solo los totales
    if (campo === 'ingrediente_id') return this.pintarReceta();
    const totales = document.querySelector('#recetaCuerpo .cobro-totales strong');
    if (totales) totales.textContent = fmtMoneda(this.costoReceta());
  },

  agregarLinea() { this._receta.lineas.push({ ingrediente_id: '', cantidad: '' }); this.pintarReceta(); },
  quitarLinea(n) { this._receta.lineas.splice(n, 1); this.pintarReceta(); },

  async guardarReceta(quitar) {
    const lineas = quitar ? [] : this._receta.lineas
      .filter(l => l.ingrediente_id && Number(l.cantidad) > 0)
      .map(l => ({ ingrediente_id: Number(l.ingrediente_id), cantidad: Number(l.cantidad) }));
    if (quitar && !confirm('¿Quitar la receta? El producto vuelve a descontar su propio stock.')) return;
    try {
      const r = await API.guardarReceta(this._receta.id, lineas);
      App.closeModal();
      App.showToast(r.costo !== null && r.costo !== undefined ? `${r.message}. Costo: ${fmtMoneda(r.costo)}` : r.message, 'success');
      this.render();
    } catch (err) { App.showToast(err.message, 'error'); }
  }
};
