// =============================================
// FADIDO - Productos
// CRUD de productos y categor\u00edas
// =============================================

const Productos = {
  productos: [],
  categorias: [],

  async render() {
    const view = document.getElementById('view-productos');
    view.innerHTML = '<div class="text-center mt-20"><i class="fas fa-spinner fa-spin fa-3x"></i></div>';
    try {
      const [productos, categorias, momentos, grupos] = await Promise.all([API.getProductos(), API.getCategorias(), API.getMomentos().catch(() => []),
        API.getGruposOpciones().catch(() => [])]);
      this.gruposOpciones = grupos;
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

  // Tipo de producto: 'venta' (carta y POS), 'insumo' o 'elaboracion' (sub-receta); los dos últimos no se venden
  clase(p) { return p.clase || 'venta'; },
  unidadDe(p) { return this.clase(p) === 'elaboracion' ? 'presentación' : (p.unidad || 'unidad'); },

  // Filtro de la vista: categoría elegida ('todas' o su id) y texto buscado
  filtroCat: 'todas',
  busqueda: '',

  paint(view) {
    const esAdmin = this.esAdmin();
    const venta = this.productos.filter(p => this.clase(p) === 'venta');
    const deClase = clase => this.productos.filter(p => this.clase(p) === clase).length;
    const cuenta = id => venta.filter(p => p.categoria_id === id).length;
    const sinCat = venta.filter(p => !this.categorias.some(c => c.id === p.categoria_id)).length;
    const chip = (id, nombre, n, color, icono) => `
      <button class="pos-cat-btn ${String(this.filtroCat) === String(id) ? 'active' : ''}" onclick="Productos.verCategoria('${id}')"
        ${color ? `style="--cat-color:${esc(color)}"` : ''}>
        ${icono ? `<i class="fas ${icono}"></i> ` : `<span class="prod-cat-punto" style="background:${esc(color || '#64748b')}"></span>`}${esc(nombre)}
        <span class="pos-cat-count">${n}</span>
      </button>`;
    const chips = [
      chip('todas', 'Todas', this.productos.length, '', 'fa-th-large'),
      ...this.categorias.map(c => chip(c.id, c.nombre, cuenta(c.id), c.color)),
      ...(sinCat ? [chip('sin', 'Sin categoría', sinCat, '#94a3b8')] : []),
      ...(esAdmin || deClase('insumo') ? [chip('insumo', 'Insumos', deClase('insumo'), '#0f766e', 'fa-carrot')] : []),
      ...(esAdmin || deClase('elaboracion') ? [chip('elaboracion', 'Sub-recetas', deClase('elaboracion'), '#9333ea', 'fa-blender')] : [])
    ].join('');

    view.innerHTML = `
      <div class="page-header">
        <div>
          <h2><i class="fas fa-hamburger"></i> Productos</h2>
          <p>${venta.length} productos en ${this.categorias.length} categorías${venta.length < this.productos.length
            ? ` · ${deClase('insumo')} insumos y ${deClase('elaboracion')} sub-recetas` : ''}</p>
        </div>
        <div>
          ${
            esAdmin ? `
            <button class="btn btn-primary" onclick="Productos.nuevaCategoria()"><i class="fas fa-tag"></i> Categoría</button>
            <button class="btn btn-outline" onclick="Productos.verRecetario()"><i class="fas fa-book"></i> Recetario</button>
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
      ${esAdmin ? this.htmlGruposOpciones() : ''}

      <div id="prodListado">${this.htmlListado(esAdmin)}</div>
    `;
  },

  // Productos agrupados por categoría, en el orden de la carta; cada grupo con su color y cantidad
  htmlListado(esAdmin = this.esAdmin()) {
    if (!this.productos.length) return `<div class="card"><div class="empty-state"><i class="fas fa-box-open"></i><p>Sin productos</p></div></div>`;
    const texto = this.busqueda.trim().toLowerCase();
    const coincide = p => !texto || p.nombre.toLowerCase().includes(texto) || String(p.descripcion || '').toLowerCase().includes(texto);
    const venta = this.productos.filter(p => this.clase(p) === 'venta');
    const grupos = [
      ...this.categorias.map(c => ({ id: c.id, nombre: c.nombre, color: c.color, nota: c.descripcion, productos: venta.filter(p => p.categoria_id === c.id) })),
      { id: 'sin', nombre: 'Sin categoría', color: '#94a3b8', productos: venta.filter(p => !this.categorias.some(c => c.id === p.categoria_id)) },
      // Lo que no se vende va aparte, sin importar la categoría
      { id: 'insumo', nombre: 'Insumos', color: '#0f766e', interna: 'No se venden: son los ingredientes de las recetas. El costo va por unidad (ej. por g).',
        productos: this.productos.filter(p => this.clase(p) === 'insumo') },
      { id: 'elaboracion', nombre: 'Sub-recetas', color: '#9333ea', interna: 'Salsas, cremas y preparaciones de la cocina. No se venden: los platos las usan por presentación.',
        productos: this.productos.filter(p => this.clase(p) === 'elaboracion') }
    ].filter(g => this.filtroCat === 'todas' || String(g.id) === String(this.filtroCat))
      .map(g => ({ ...g, productos: g.productos.filter(coincide) }))
      .filter(g => g.productos.length);
    if (!grupos.length) return `<div class="card"><div class="empty-state"><i class="fas fa-search"></i><p>No hay productos${texto ? ` que coincidan con "${esc(this.busqueda.trim())}"` : ' en esta categoría'}</p></div></div>`;

    const tipo = p => ({
      insumo: '<span class="badge badge-gray">Insumo</span>',
      elaboracion: `<span class="badge badge-blue">Sub-receta</span><br><small class="text-muted">rinde ${Number(p.rendimiento) || 1}</small>`
    }[this.clase(p)] || (p.es_plato ? '<span class="badge badge-blue">Plato</span>' : '<span class="badge badge-gray">Producto</span>'));
    const fila = p => `
      <tr>
        <td>${p.foto ? `<img class="prod-foto-mini" src="/api/publico/fotos/${Number(p.id)}?v=${Number(p.foto)}" alt="" loading="lazy">` : ''}<div class="font-bold">${esc(p.nombre)}${p.para_llevar ? ' <span class="badge badge-gray" title="En el menú Take Away">Take Away</span>' : ''}</div>${p.descripcion ? `<small class="text-muted prod-desc">${esc(p.descripcion)}</small>` : ''}</td>
        <td class="font-bold">${this.clase(p) === 'venta' ? fmtMoneda(p.precio_venta) : '<span class="text-muted">No se vende</span>'}</td>
        <td>${fmtMoneda(p.costo)}${this.clase(p) !== 'venta' ? `<br><small class="text-muted">por ${esc(this.unidadDe(p))}</small>` : ''}</td>
        <td>${p.tracking_stock
          ? `<span class="${p.stock_actual <= p.stock_minimo ? 'text-danger font-bold' : ''}">${p.stock_actual} ${esc(p.unidad || '')}</span>`
          : '<span class="text-muted">Sin control</span>'}</td>
        <td>${tipo(p)}</td>
        ${esAdmin ? `
          <td class="prod-acciones">
            ${this.clase(p) === 'insumo' ? '' : `<button class="btn btn-outline btn-sm" onclick="Productos.receta(${p.id})" title="Receta e ingredientes">
              <i class="fas fa-blender"></i>${p.ingredientes_receta ? ` ${p.ingredientes_receta}` : ''}</button>`}
            <button class="btn btn-outline btn-sm" onclick="Productos.editar(${p.id})" title="Editar"><i class="fas fa-edit"></i></button>
            <button class="btn btn-danger btn-sm" onclick="Productos.eliminar(${p.id})" title="Eliminar"><i class="fas fa-trash"></i></button>
          </td>` : ''}
      </tr>`;
    return grupos.map(g => `
      <div class="card mb-20 prod-grupo" style="--cat-color:${esc(g.color || '#64748b')}">
        <div class="card-header">
          <span class="card-title"><span class="prod-cat-punto"></span> ${esc(g.nombre)}</span>
          <span>
            ${esAdmin && Number.isInteger(g.id) ? `<button class="btn btn-outline btn-sm" onclick="Productos.editarCategoria(${Number(g.id)})" title="Editar categoría"><i class="fas fa-edit"></i></button>` : ''}
            <span class="pos-cat-count">${g.productos.length}</span>
          </span>
        </div>
        ${g.nota ? `<div class="prod-nota-categoria"><i class="fas fa-info-circle"></i> ${esc(g.nota)} <small>(se ve en la carta)</small></div>` : ''}
        ${g.interna ? `<div class="prod-nota-categoria"><i class="fas fa-info-circle"></i> ${esc(g.interna)}</div>` : ''}
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
    const tipo = p && this.clase(p) !== 'venta' ? this.clase(p) : (!p || p.es_plato ? 'plato' : 'simple');
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
            <label>Tipo</label>
            <select id="prodTipo" onchange="Productos.ajustarFormulario()">
              ${[['plato', 'Plato'], ['simple', 'Producto simple'], ['insumo', 'Insumo (ingrediente, no se vende)'], ['elaboracion', 'Sub-receta (salsa, crema... no se vende)']]
                .map(([v, t]) => `<option value="${v}" ${tipo === v ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" id="prodCategoriaGrupo">
            <label>Categor\u00eda</label>
            <select id="prodCategoria">${catOptions}</select>
          </div>
          <div class="form-group" id="prodRindeGrupo">
            <label>Rinde (presentaciones)</label>
            <input type="number" id="prodRendimiento" min="0.01" step="0.01" value="${p ? Number(p.rendimiento) || 1 : 1}">
            <small class="form-hint">Cuántas porciones salen de la receta: el costo de la receta se divide por este número.</small>
          </div>
        </div>
        <div id="prodSoloCarta">
        <div class="form-group">
          <label>Foto para la carta</label>
          <div class="prod-foto-campo">
            <div class="prod-foto-vista" id="prodFotoVista">${p && p.foto ? `<img src="/api/publico/fotos/${Number(p.id)}?v=${Number(p.foto)}" alt="">` : '<i class="fas fa-camera"></i>'}</div>
            <div>
              <label class="btn btn-secondary btn-sm"><i class="fas fa-upload"></i> ${p && p.foto ? 'Cambiar foto' : 'Elegir foto'}
                <input type="file" id="prodFoto" accept="image/jpeg,image/png,image/webp,image/heic" hidden onchange="Productos.elegirFoto(this)"></label>
              <button type="button" class="btn btn-outline btn-sm" id="prodFotoQuitar" onclick="Productos.quitarFoto()" ${p && p.foto ? '' : 'hidden'}>Quitar</button>
              <small class="form-hint">Se ve en la carta del QR. Mejor horizontal y con buena luz; se achica sola antes de subirla.</small>
            </div>
          </div>
        </div>
        <div class="form-group">
          <label>Orden en la carta</label>
          <input type="number" id="prodOrden" min="0" step="1" value="${p && p.orden ? p.orden : ''}" placeholder="Ej: 1 = primero de su categoría">
          <small class="form-hint">Posición dentro de su categoría, como en la carta impresa. Vacío: va después, por nombre.</small>
        </div>
        </div>
        <div class="grid grid-2">
          <div class="form-group" id="prodPrecioGrupo">
            <label>Precio de venta ($)</label>
            <input type="number" id="prodPrecio" min="0" step="0.01" value="${p ? p.precio_venta : ''}" required>
          </div>
          <div class="form-group">
            <label>Costo ($)</label>
            <input type="number" id="prodCosto" min="0" step="0.01" value="${p ? p.costo : '0'}" ${p && p.ingredientes_receta ? 'readonly' : ''}>
            ${p && p.ingredientes_receta ? '<small class="form-hint">Lo calcula la receta: se actualiza solo cuando cambian los ingredientes.</small>'
              : '<small class="form-hint" id="prodCostoAyuda"></small>'}
          </div>
        </div>
        <div class="grid grid-2">
          <div class="form-group">
            <label>Unidad</label>
            <input type="text" id="prodUnidad" value="${p ? esc(p.unidad || '') : ''}" placeholder="Ej: unidad, g, kg, ml">
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
        <div class="form-group" id="prodDestacar">
          <label>Destacar en la carta</label>
          <label class="checkbox-label"><input type="checkbox" id="prodRecomendado" ${p && p.recomendado ? 'checked' : ''}> Recomendado de la casa</label>
          <label class="checkbox-label"><input type="checkbox" id="prodNuevo" ${p && p.nuevo ? 'checked' : ''}> Nuevo</label>
          <label class="checkbox-label"><input type="checkbox" id="prodParaLlevar" ${p && p.para_llevar ? 'checked' : ''}> En el menú Take Away (para llevar)</label>
          <small class="form-hint">"Lo más pedido" se marca solo con las ventas de las últimas 4 semanas.</small>
        </div>
        <div class="form-group" id="stockInicialGroup" ${(!p && 'style="display:none"') || ''}>
          <label>Stock inicial</label>
          <input type="number" id="prodStockInicial" min="0" value="${p ? p.stock_actual : '0'}">
        </div>
        <div id="prodSoloCarta2">
        ${this.htmlVentaCruzada(p)}
        ${this.htmlTraducciones('prod', p && p.traducciones, true)}
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-danger" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-success">Guardar</button>
        </div>
      </form>
    `, { title: p ? `Editar ${p.nombre}` : 'Nuevo producto' });
    // La foto se sube al guardar (un producto nuevo todavía no tiene id): null = sin cambios, 'quitar' o la foto nueva
    this._foto = null;
    this.ajustarFormulario();

    document.getElementById('prodTracking').addEventListener('change', (e) => {
      document.getElementById('stockInicialGroup').style.display = e.target.checked ? 'block' : 'none';
    });
  },
// Insumos y sub-recetas no se venden: sin precio, categoría ni datos de la carta; la sub-receta dice cuánto rinde
  ajustarFormulario() {
    const tipo = document.getElementById('prodTipo').value;
    const seVende = tipo === 'plato' || tipo === 'simple';
    const ver = (id, si) => { const el = document.getElementById(id); if (el) el.style.display = si ? '' : 'none'; };
    ['prodCategoriaGrupo', 'prodPrecioGrupo', 'prodSoloCarta', 'prodSoloCarta2', 'prodDestacar'].forEach(id => ver(id, seVende));
    ver('prodRindeGrupo', tipo === 'elaboracion');
    document.getElementById('prodPrecio').required = seVende;
    const ayuda = document.getElementById('prodCostoAyuda');
    if (ayuda) ayuda.textContent = tipo === 'insumo' ? 'Por unidad de medida: si la unidad es g, el costo de 1 g.'
      : tipo === 'elaboracion' ? 'Al cargarle la receta, se calcula solo (por presentación).' : '';
  },

  async guardar(e, id) {
    e.preventDefault();
    const tipo = document.getElementById('prodTipo').value;
    const seVende = tipo === 'plato' || tipo === 'simple';
    const data = {
      nombre: document.getElementById('prodNombre').value,
      descripcion: document.getElementById('prodDescripcion').value,
      categoria_id: seVende ? parseInt(document.getElementById('prodCategoria').value) : null,
      es_plato: tipo === 'plato',
      clase: seVende ? 'venta' : tipo,
      ...(tipo === 'elaboracion' ? { rendimiento: parseFloat(document.getElementById('prodRendimiento').value || 1) } : {}),
      precio_venta: seVende ? parseFloat(document.getElementById('prodPrecio').value) : 0,
      costo: parseFloat(document.getElementById('prodCosto').value || 0),
      unidad: document.getElementById('prodUnidad').value,
      stock_minimo: parseInt(document.getElementById('prodStockMin').value || 0),
      tracking_stock: document.getElementById('prodTracking').checked ? 1 : 0,
      orden: parseInt(document.getElementById('prodOrden').value || 0),
      recomendado: document.getElementById('prodRecomendado').checked ? 1 : 0,
      nuevo: document.getElementById('prodNuevo').checked ? 1 : 0,
      para_llevar: seVende && document.getElementById('prodParaLlevar').checked ? 1 : 0,
      ...this.leerVentaCruzada(id),
      traducciones: this.leerTraducciones('prod', true)
    };
    if (data.tracking_stock && !id) {
      data.stock_actual = parseInt(document.getElementById('prodStockInicial').value || 0);
    }
    const nuevo = !id;
    try {
      if (id) {
        await API.updateProducto(id, data);
      } else {
        id = (await API.createProducto(data)).id;
      }
      // El producto ya quedó guardado: si la foto falla se avisa, pero no se pierde lo demás
      let errorFoto = '';
      if (this._foto && seVende) {
        try {
          if (this._foto === 'quitar') await API.borrarFotoProducto(id);
          else await API.subirFotoProducto(id, this._foto);
        } catch (err) { errorFoto = err.message; }
      }
      if (errorFoto) App.showToast(`Producto guardado, pero la foto no: ${errorFoto}`, 'error');
      else App.showToast(nuevo ? 'Producto creado' : 'Producto actualizado', 'success');
      App.closeModal();
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  // Foto del plato: se achica en el navegador (lado mayor 1200 px, JPG) y se muestra antes de guardar
  async elegirFoto(input) {
    const original = input.files && input.files[0];
    input.value = '';
    if (!original) return;
    const url = URL.createObjectURL(original);
    try {
      const img = await new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = url; });
      const escala = Math.min(1, 1200 / Math.max(img.naturalWidth, img.naturalHeight));
      const lienzo = document.createElement('canvas');
      lienzo.width = Math.round(img.naturalWidth * escala);
      lienzo.height = Math.round(img.naturalHeight * escala);
      const ctx = lienzo.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, lienzo.width, lienzo.height);
      ctx.drawImage(img, 0, 0, lienzo.width, lienzo.height);
      const jpg = await new Promise(ok => lienzo.toBlob(ok, 'image/jpeg', 0.82));
      if (!jpg) throw new Error();
      this._foto = jpg;
      document.getElementById('prodFotoVista').innerHTML = `<img src="${lienzo.toDataURL('image/jpeg', 0.6)}" alt="">`;
      document.getElementById('prodFotoQuitar').hidden = false;
    } catch (e) {
      App.showToast('No se pudo abrir la foto. Probá con una JPG o PNG.', 'error');
    } finally {
      URL.revokeObjectURL(url);
    }
  },
  quitarFoto() {
    this._foto = 'quitar';
    document.getElementById('prodFotoVista').innerHTML = '<i class="fas fa-camera"></i>';
    document.getElementById('prodFotoQuitar').hidden = true;
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

  // ===== Venta cruzada en el formulario de producto: versión grande, horario y qué incluye un combo =====
  DIAS_CORTOS: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'],
  leerJSON(t) { try { return t ? (typeof t === 'string' ? JSON.parse(t) : t) : null; } catch (e) { return null; } },

  htmlVentaCruzada(p) {
    const h = this.leerJSON(p && p.horario);
    const combo = this.leerJSON(p && p.combo);
    const otros = this.productos.filter(x => !p || x.id !== p.id);
    const algo = !!(p && (p.version_grande_id || h || combo));
    return `<details class="form-group" ${algo ? 'open' : ''}>
        <summary><i class="fas fa-bullhorn"></i> Para vender más (opcional)</summary>
        <div class="form-group mt-10">
          <label>Versión grande</label>
          <select id="prodGrande"><option value="">— Ninguna —</option>${otros.map(x => `<option value="${Number(x.id)}" ${p && p.version_grande_id === x.id ? 'selected' : ''}>${esc(x.nombre)} (${fmtMoneda(x.precio_venta)})</option>`).join('')}</select>
          <small class="form-hint">Al agregarlo, la carta y el punto de venta ofrecen "¿Lo querés grande?" por la diferencia.</small>
        </div>
        <div class="form-group">
          <label class="checkbox-label"><input type="checkbox" id="prodHorarioOn" ${h ? 'checked' : ''} onchange="document.getElementById('prodHorario').style.display = this.checked ? '' : 'none'"> Solo en un horario (por ejemplo, promos de 8 a 12)</label>
          <div id="prodHorario" style="${h ? '' : 'display:none'}">
            <div class="cierre-dias">${this.DIAS_CORTOS.map((d, i) => `<label class="checkbox-label"><input type="checkbox" class="prodDia" value="${i}" ${!h ? (i >= 1 && i <= 5 ? 'checked' : '') : (h.dias.includes(i) ? 'checked' : '')}> ${d}</label>`).join('')}</div>
            <div class="grid grid-2 mt-10">
              <input type="time" id="prodDesde" value="${h ? esc(h.desde) : '08:00'}">
              <input type="time" id="prodHasta" value="${h ? esc(h.hasta) : '12:00'}">
            </div>
            <small class="form-hint">Fuera de horario el cliente lo ve pero no lo puede pedir; en el punto de venta solo avisa.</small>
          </div>
        </div>
        <div class="form-group">
          <label>Si es un combo: qué incluye</label>
          <div id="prodCombo">${(combo ? combo.componentes : []).map(c => this.filaCombo(c, p)).join('')}</div>
          <button type="button" class="btn btn-outline btn-sm mt-10" onclick="document.getElementById('prodCombo').insertAdjacentHTML('beforeend', Productos.filaCombo(null, null))"><i class="fas fa-plus"></i> Agregar parte del combo</button>
          <small class="form-hint">Ej.: 1 de "Cafetería caliente" + 2 "Medialuna". Si el cliente lo arma suelto y el combo sale más barato, se le avisa.</small>
        </div>
      </details>`;
  },

  // Una parte del combo: cantidad + "cualquiera de una categoría" o un producto
  filaCombo(c, p) {
    let valor = '';
    if (c) {
      const cat = this.categorias.find(k => {
        const ids = this.productos.filter(x => x.categoria_id === k.id && (!p || x.id !== p.id)).map(x => x.id).sort();
        return ids.length && ids.join(',') === c.productos.slice().sort().join(',');
      });
      valor = cat ? 'c:' + cat.id : c.productos.length === 1 ? 'p:' + c.productos[0] : 'l:' + c.productos.join(',');
    }
    const opcionesCat = this.categorias.map(k => `<option value="c:${Number(k.id)}" ${valor === 'c:' + k.id ? 'selected' : ''}>Cualquiera de: ${esc(k.nombre)}</option>`).join('');
    const opcionesProd = this.productos.filter(x => !p || x.id !== p.id).map(x => `<option value="p:${Number(x.id)}" ${valor === 'p:' + x.id ? 'selected' : ''}>${esc(x.nombre)}</option>`).join('');
    return `<div class="opcion-fila combo-fila">
        <input type="number" class="comboCant" min="1" max="10" value="${c ? Number(c.cantidad) : 1}" title="Cantidad">
        <select class="comboQue">
          ${valor.startsWith('l:') ? `<option value="${esc(valor)}" selected>${c.productos.length} productos elegidos</option>` : ''}
          <optgroup label="Categorías">${opcionesCat}</optgroup><optgroup label="Productos">${opcionesProd}</optgroup>
        </select>
        <button type="button" class="btn btn-outline btn-sm" onclick="this.closest('.combo-fila').remove()" title="Quitar"><i class="fas fa-times"></i></button>
      </div>`;
  },

  leerVentaCruzada(id) {
    const on = document.getElementById('prodHorarioOn').checked;
    const componentes = [...document.querySelectorAll('#prodCombo .combo-fila')].map(f => {
      const [tipo, valor] = f.querySelector('.comboQue').value.split(':');
      const productos = tipo === 'c' ? this.productos.filter(x => x.categoria_id === Number(valor) && x.id !== id).map(x => x.id)
        : String(valor).split(',').map(Number);
      return { productos, cantidad: Number(f.querySelector('.comboCant').value) || 1 };
    }).filter(c => c.productos.length);
    return {
      version_grande_id: Number(document.getElementById('prodGrande').value) || null,
      horario: on ? { dias: [...document.querySelectorAll('.prodDia')].filter(x => x.checked).map(x => Number(x.value)),
        desde: document.getElementById('prodDesde').value, hasta: document.getElementById('prodHasta').value } : '',
      combo: componentes.length ? { componentes } : ''
    };
  },

  // ===== Opciones y adicionales ("¿Qué leche?", "Adicionales") =====
  gruposOpciones: [],
  htmlGruposOpciones() {
    const botones = this.gruposOpciones.map(g => `
      <button class="pos-cat-btn" onclick="Productos.formGrupo(${Number(g.id)})" title="Editar">
        <i class="fas ${g.tipo === 'una' ? 'fa-dot-circle' : 'fa-plus-square'}"></i> ${esc(g.nombre)}
        <span class="pos-cat-count">${g.opciones.length} opc. · ${g.productos.length} prod.</span>${g.activo ? '' : ' (apagado)'}
      </button>`).join('');
    return `
      <div class="card mb-20">
        <div class="card-header">
          <span class="card-title"><i class="fas fa-sliders-h"></i> Opciones y adicionales</span>
          <button class="btn btn-outline btn-sm" onclick="Productos.formGrupo(null)"><i class="fas fa-plus"></i> Grupo</button>
        </div>
        <p class="text-muted">Lo que se pregunta al agregar un producto: "¿Qué leche?" (se elige una) o "Adicionales" (se eligen varios, cada uno con su precio).</p>
        <div class="pos-categories">${botones || '<span class="text-muted">Todavía no hay opciones.</span>'}</div>
      </div>`;
  },

  filaOpcion(o = {}) {
    const t = o.traducciones || {};
    return `
      <div class="opcion-fila" data-id="${o.id ? Number(o.id) : ''}">
        <input type="text" class="opNombre" maxlength="60" placeholder="Ej.: Leche vegetal" value="${esc(o.nombre || '')}" required>
        <input type="number" class="opPrecio" min="0" step="0.01" placeholder="+ $" value="${o.precio ? Number(o.precio) : ''}" title="Recargo (vacío = sin cargo)">
        <input type="text" class="opEn" maxlength="60" placeholder="Inglés" value="${esc((t.en && t.en.nombre) || '')}">
        <input type="text" class="opPt" maxlength="60" placeholder="Portugués" value="${esc((t.pt && t.pt.nombre) || '')}">
        <button type="button" class="btn btn-outline btn-sm" onclick="this.closest('.opcion-fila').remove()" title="Quitar"><i class="fas fa-times"></i></button>
      </div>`;
  },

  formGrupo(id) {
    const g = this.gruposOpciones.find(x => x.id === id) || null;
    const t = (g && g.traducciones) || {};
    const elegidos = new Set(g ? g.productos : []);
    const porCategoria = [...this.categorias.map(c => ({ id: c.id, nombre: c.nombre, productos: this.productos.filter(p => p.categoria_id === c.id) })),
      { id: 0, nombre: 'Sin categoría', productos: this.productos.filter(p => !this.categorias.some(c => c.id === p.categoria_id)) }]
      .filter(c => c.productos.length);
    App.showModal(`
      <form onsubmit="Productos.guardarGrupo(event, ${g ? Number(g.id) : 'null'})">
        <div class="form-group"><label>Nombre (lo que se pregunta)</label>
          <input type="text" id="grNombre" maxlength="60" value="${g ? esc(g.nombre) : ''}" placeholder="Ej.: ¿Qué leche?" required></div>
        <div class="grid grid-2">
          <div class="form-group"><label>Tipo</label>
            <select id="grTipo" onchange="Productos.tipoGrupo()">
              <option value="una" ${!g || g.tipo === 'una' ? 'selected' : ''}>Se elige una (tipo de leche, sabor)</option>
              <option value="varias" ${g && g.tipo === 'varias' ? 'selected' : ''}>Adicionales (se pueden elegir varios)</option>
            </select></div>
          <div class="form-group" id="grUnaOpc"><label class="checkbox-label"><input type="checkbox" id="grObligatorio" ${!g || g.obligatorio ? 'checked' : ''}> Siempre hay que elegir (la primera va por defecto)</label></div>
          <div class="form-group" id="grVariasOpc"><label>Máximo (0 = sin tope)</label><input type="number" id="grMaximo" min="0" value="${g ? Number(g.maximo) || 0 : 0}"></div>
        </div>
        <div class="form-group">
          <label>Opciones (nombre, recargo y traducciones)</label>
          <div id="grOpciones">${(g ? g.opciones : [{}]).map(o => this.filaOpcion(o)).join('')}</div>
          <button type="button" class="btn btn-outline btn-sm mt-10" onclick="document.getElementById('grOpciones').insertAdjacentHTML('beforeend', Productos.filaOpcion())"><i class="fas fa-plus"></i> Agregar opción</button>
        </div>
        <div class="form-group">
          <label>Productos que lo usan</label>
          <div class="grupo-productos">${porCategoria.map(c => `
            <div class="grupo-cat">
              <label class="checkbox-label font-bold"><input type="checkbox" onchange="this.closest('.grupo-cat').querySelectorAll('.grProd').forEach(x => { x.checked = this.checked; })"> ${esc(c.nombre)} (toda)</label>
              <div class="cierre-dias">${c.productos.map(p => `<label class="checkbox-label"><input type="checkbox" class="grProd" value="${Number(p.id)}" ${elegidos.has(p.id) ? 'checked' : ''}> ${esc(p.nombre)}</label>`).join('')}</div>
            </div>`).join('')}</div>
        </div>
        <div class="grid grid-2">
          <div class="form-group"><label>Inglés: pregunta</label><input type="text" id="grEn" maxlength="60" value="${esc((t.en && t.en.nombre) || '')}" placeholder="Which milk?"></div>
          <div class="form-group"><label>Portugués: pregunta</label><input type="text" id="grPt" maxlength="60" value="${esc((t.pt && t.pt.nombre) || '')}" placeholder="Qual leite?"></div>
        </div>
        <div class="form-group"><label class="checkbox-label"><input type="checkbox" id="grActivo" ${!g || g.activo ? 'checked' : ''}> Activo</label></div>
        <div class="modal-footer">
          ${g ? `<button type="button" class="btn btn-danger" onclick="Productos.borrarGrupo(${Number(g.id)})"><i class="fas fa-trash"></i> Borrar</button>` : ''}
          <button type="button" class="btn btn-outline" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-success">Guardar</button>
        </div>
      </form>`, { title: g ? `Opciones: ${g.nombre}` : 'Nuevo grupo de opciones', large: true });
    this.tipoGrupo();
  },

  tipoGrupo() {
    const una = document.getElementById('grTipo').value === 'una';
    document.getElementById('grUnaOpc').style.display = una ? '' : 'none';
    document.getElementById('grVariasOpc').style.display = una ? 'none' : '';
  },

  async guardarGrupo(e, id) {
    e.preventDefault();
    const opciones = [...document.querySelectorAll('#grOpciones .opcion-fila')].map(f => ({
      id: Number(f.dataset.id) || undefined,
      nombre: f.querySelector('.opNombre').value,
      precio: f.querySelector('.opPrecio').value || 0,
      traducciones: { en: { nombre: f.querySelector('.opEn').value }, pt: { nombre: f.querySelector('.opPt').value } }
    }));
    const data = {
      nombre: document.getElementById('grNombre').value,
      tipo: document.getElementById('grTipo').value,
      obligatorio: document.getElementById('grObligatorio').checked,
      maximo: Number(document.getElementById('grMaximo').value) || 0,
      activo: document.getElementById('grActivo').checked ? 1 : 0,
      opciones,
      productos: [...document.querySelectorAll('.grProd')].filter(x => x.checked).map(x => Number(x.value)),
      orden: id ? (this.gruposOpciones.find(x => x.id === id) || {}).orden : this.gruposOpciones.length,
      traducciones: { en: { nombre: document.getElementById('grEn').value }, pt: { nombre: document.getElementById('grPt').value } }
    };
    try {
      if (id) await API.actualizarGrupoOpciones(id, data);
      else await API.crearGrupoOpciones(data);
      App.closeModal();
      App.showToast('Opciones guardadas', 'success');
      this.render();
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  async borrarGrupo(id) {
    if (!confirm('¿Borrar este grupo de opciones? Los pedidos ya hechos no cambian.')) return;
    try {
      await API.borrarGrupoOpciones(id);
      App.closeModal();
      App.showToast('Grupo borrado', 'success');
      this.render();
    } catch (err) { App.showToast(err.message, 'error'); }
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
        <div class="form-group">
          <label class="checkbox-label"><input type="checkbox" id="momParaLlevar" ${m && m.solo_para_llevar ? 'checked' : ''}> Menú Take Away: solo los productos marcados "para llevar"</label>
          <small class="form-hint">Las categorías muestran su nombre para llevar si tienen uno (por ejemplo, "Cafetería mediana").</small>
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
      solo_para_llevar: document.getElementById('momParaLlevar').checked ? 1 : 0,
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
        <div class="form-group">
          <label>Nombre en el menú Take Away (opcional)</label>
          <input type="text" id="catNombreLlevar" maxlength="60" value="${c ? esc(c.nombre_para_llevar || '') : ''}" placeholder="Ej.: Cafetería mediana">
          <small class="form-hint">Así se llama la categoría en el momento Take Away de la carta. Vacío: el nombre de siempre.</small>
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
        <div class="form-group">
          <label>Acompañalo con (sugerencias al agregar algo de esta categoría)</label>
          <div class="cierre-dias">${this.categorias.filter(k => !c || k.id !== c.id).map(k => `<label class="checkbox-label"><input type="checkbox" class="catSugerir" value="${Number(k.id)}" ${c && String(c.sugerir || '').split(',').map(Number).includes(k.id) ? 'checked' : ''}> ${esc(k.nombre)}</label>`).join('')}</div>
          <small class="form-hint">Ej.: a los cafés, laminados y pastelería. La carta y el punto de venta los ofrecen (primero los recomendados).</small>
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
      nombre_para_llevar: document.getElementById('catNombreLlevar').value,
      color: document.getElementById('catColor').value,
      orden: parseInt(document.getElementById('catOrden').value) || 0,
      traducciones: this.leerTraducciones('cat', true),
      sugerir: [...document.querySelectorAll('.catSugerir')].filter(x => x.checked).map(x => Number(x.value))
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
  // Una sub-receta (Salsa Ranch) se carga entera y rinde N presentaciones; un plato la usa por presentación.
  _receta: null,

  async receta(id) {
    try {
      const [r, productos] = await Promise.all([API.getReceta(id), API.getProductos()]);
      const esSub = r.clase === 'elaboracion';
      // Ingredientes posibles: sin receta propia (sin recetas anidadas); un plato también puede usar sub-recetas
      this._ingredientes = productos.filter(x => x.id !== id &&
        (this.clase(x) === 'elaboracion' ? !esSub : !x.ingredientes_receta));
      this._receta = { id, nombre: r.nombre, precio: r.precio_venta, clase: r.clase, rendimiento: Number(r.rendimiento) || 1,
        lineas: r.lineas.map(l => ({ ingrediente_id: l.ingrediente_id, cantidad: l.cantidad })) };
      if (!this._receta.lineas.length) this._receta.lineas.push({ ingrediente_id: '', cantidad: '' });
      this.pintarReceta();
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  costoReceta() {
    const porId = Object.fromEntries(this._ingredientes.map(i => [i.id, i]));
    return this._receta.lineas.reduce((s, l) => s + (Number(l.cantidad) || 0) * ((porId[l.ingrediente_id] || {}).costo || 0), 0);
  },

  htmlTotalesReceta() {
    const r = this._receta;
    const costo = this.costoReceta();
    if (r.clase === 'elaboracion') return `
      <div><span>Costo de la receta</span><strong>${fmtMoneda(costo)}</strong></div>
      <div><span>Rinde</span><strong>${r.rendimiento} presentaciones</strong></div>
      <div class="cobro-saldo"><span>Costo por presentación</span><strong>${fmtMoneda(costo / r.rendimiento)}</strong></div>`;
    const margen = r.precio > 0 ? Math.round((r.precio - costo) / r.precio * 1000) / 10 : null;
    return `
      <div><span>Costo del plato</span><strong>${fmtMoneda(costo)}</strong></div>
      <div><span>Precio de venta</span><strong>${fmtMoneda(r.precio)}</strong></div>
      <div class="cobro-saldo"><span>Margen</span><strong>${margen === null ? '-' : margen + ' %'}</strong></div>`;
  },

  pintarReceta() {
    const r = this._receta;
    const porId = Object.fromEntries(this._ingredientes.map(i => [i.id, i]));
    // Agrupados: insumos, sub-recetas y el resto de los productos
    const grupos = [['insumo', 'Insumos'], ['elaboracion', 'Sub-recetas'], ['venta', 'Productos de la carta']]
      .map(([clase, titulo]) => [titulo, this._ingredientes.filter(i => this.clase(i) === clase)]).filter(([, l]) => l.length);
    const opciones = sel => '<option value="">Elegí un ingrediente</option>' + grupos.map(([titulo, lista]) => `<optgroup label="${titulo}">${lista.map(i =>
      `<option value="${i.id}" ${String(sel) === String(i.id) ? 'selected' : ''}>${esc(i.nombre)} (${esc(this.unidadDe(i))})</option>`).join('')}</optgroup>`).join('');
    const filas = r.lineas.map((l, n) => {
      const ing = porId[l.ingrediente_id];
      return `<div class="receta-linea">
        <select onchange="Productos.setLinea(${n}, 'ingrediente_id', this.value)">${opciones(l.ingrediente_id)}</select>
        <input type="number" min="0" step="0.001" value="${l.cantidad}" placeholder="Cantidad" aria-label="Cantidad"
          oninput="Productos.setLinea(${n}, 'cantidad', this.value)">
        <span class="text-muted">${ing ? esc(this.unidadDe(ing)) + ' · ' + fmtMoneda((Number(l.cantidad) || 0) * (ing.costo || 0)) : ''}</span>
        <button type="button" class="btn btn-sm btn-outline" onclick="Productos.quitarLinea(${n})" aria-label="Quitar"><i class="fas fa-times"></i></button>
      </div>`;
    }).join('');
    const ayuda = r.clase === 'elaboracion'
      ? `Cargá la receta entera (lo que lleva una tanda) y cuántas presentaciones rinde: se cambia en Editar producto.
        Los platos la usan por presentación y, al venderlos, se descuentan estos ingredientes en proporción.`
      : `Al cobrar, se descuenta el stock de cada ingrediente según la cantidad vendida.
        La cantidad va en la unidad del ingrediente (ej. 0.15 kg de carne); una sub-receta, en presentaciones.`;
    const html = `
      <p class="text-muted">${ayuda}</p>
      ${filas}
      <button type="button" class="btn btn-sm btn-outline mt-10" onclick="Productos.agregarLinea()"><i class="fas fa-plus"></i> Ingrediente</button>
      <div class="cobro-totales mt-20" id="recetaTotales">${this.htmlTotalesReceta()}</div>
      <div class="modal-footer">
        <button type="button" class="btn btn-danger" onclick="Productos.guardarReceta(true)">Quitar receta</button>
        <button type="button" class="btn btn-outline" onclick="App.closeModal()">Cancelar</button>
        <button type="button" class="btn btn-success" onclick="Productos.guardarReceta(false)"><i class="fas fa-save"></i> Guardar receta</button>
      </div>`;
    const cuerpo = document.getElementById('recetaCuerpo');
    if (cuerpo && cuerpo.dataset.producto === String(r.id)) { cuerpo.innerHTML = html; return; }
    App.showModal(`<div id="recetaCuerpo" data-producto="${r.id}">${html}</div>`,
      { title: `${r.clase === 'elaboracion' ? 'Sub-receta' : 'Receta'}: ${r.nombre}`, large: true });
  },

  setLinea(n, campo, valor) {
    this._receta.lineas[n][campo] = valor;
    // Al tipear la cantidad no se redibuja la fila (no se pierde el foco): solo los totales
    if (campo === 'ingrediente_id') return this.pintarReceta();
    const totales = document.getElementById('recetaTotales');
    if (totales) totales.innerHTML = this.htmlTotalesReceta();
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
  },

  // ===== Recetario: fichas técnicas de las recetas y sub-recetas, para consultar e imprimir =====
  _recetario: [],
  filtroRecetario: 'todas',

  async verRecetario() {
    try {
      this._recetario = await API.getRecetario();
      this.pintarRecetario();
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  recetarioFiltrado() {
    const f = this.filtroRecetario;
    return this._recetario.filter(r => f === 'todas' || (f === 'sub' ? r.clase === 'elaboracion' : r.clase !== 'elaboracion'));
  },

  htmlFicha(r) {
    const esSub = r.clase === 'elaboracion';
    const total = r.lineas.reduce((s, l) => s + l.subtotal, 0);
    return `
      <div class="ficha-tecnica">
        <div class="ficha-titulo"><strong>${esc(r.nombre)}</strong> <span class="badge ${esSub ? 'badge-blue' : 'badge-gray'}">${esSub ? 'Sub-receta' : 'Receta'}</span></div>
        ${esSub ? `<div class="text-muted">Rendimiento: ${Number(r.rendimiento) || 1} presentaciones</div>` : ''}
        <table>
          <tbody>${r.lineas.map(l => `<tr><td>${esc(l.nombre)}</td><td class="text-right">${Number(l.cantidad)} ${esc(this.unidadDe(l))}</td>
            <td class="text-right text-muted">${fmtMoneda(l.subtotal)}</td></tr>`).join('')}</tbody>
        </table>
        <div class="text-muted">Costo: ${fmtMoneda(total)}${esSub ? ` · por presentación ${fmtMoneda(r.costo)}` : r.precio_venta > 0 ? ` · precio ${fmtMoneda(r.precio_venta)}` : ''}</div>
      </div>`;
  },

  pintarRecetario() {
    const boton = (id, texto) => `<button class="pos-cat-btn ${this.filtroRecetario === id ? 'active' : ''}"
      onclick="Productos.filtroRecetario = '${id}'; Productos.pintarRecetario()">${texto}</button>`;
    const lista = this.recetarioFiltrado();
    const html = `
      <div class="pos-categories mb-20">${boton('todas', 'Todas')}${boton('recetas', 'Recetas')}${boton('sub', 'Sub-recetas')}</div>
      ${lista.length ? `<div class="recetario">${lista.map(r => this.htmlFicha(r)).join('')}</div>`
        : '<div class="empty-state"><i class="fas fa-book"></i><p>Todavía no hay recetas. Se cargan con el botón <i class="fas fa-blender"></i> de cada producto.</p></div>'}
      <div class="modal-footer">
        <button type="button" class="btn btn-outline" onclick="App.closeModal()">Cerrar</button>
        ${lista.length ? '<button type="button" class="btn btn-primary" onclick="Productos.imprimirRecetario()"><i class="fas fa-print"></i> Imprimir</button>' : ''}
      </div>`;
    const cuerpo = document.getElementById('recetarioCuerpo');
    if (cuerpo) { cuerpo.innerHTML = html; return; }
    App.showModal(`<div id="recetarioCuerpo">${html}</div>`, { title: 'Recetario y fichas técnicas', large: true });
  },

  imprimirRecetario() {
    const win = window.open('', '_blank', 'width=800,height=900');
    if (!win) { App.showToast('Habilita las ventanas emergentes', 'warning'); return; }
    const negocio = (App && App.nombreNegocio) ? App.nombreNegocio : 'Fadido';
    win.document.write(`
      <!DOCTYPE html><html><head><meta charset="UTF-8"><title>Recetario</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 30px; color:#222; }
        h1 { margin: 0 0 20px; font-size: 20px; }
        .ficha-tecnica { border: 1px solid #ccc; border-radius: 6px; padding: 12px; margin-bottom: 14px; page-break-inside: avoid; }
        .ficha-titulo { font-size: 16px; margin-bottom: 4px; }
        .badge { font-size: 11px; color: #555; border: 1px solid #ccc; border-radius: 4px; padding: 1px 6px; }
        .text-muted { color: #666; font-size: 12px; }
        .text-right { text-align: right; }
        table { width: 100%; border-collapse: collapse; margin: 8px 0; }
        td { border-bottom: 1px solid #eee; padding: 4px 6px; font-size: 13px; }
      </style></head><body>
      <h1>${esc(negocio)} · Recetario</h1>
      ${this.recetarioFiltrado().map(r => this.htmlFicha(r)).join('')}
      <script>window.onload = function(){ window.print(); };<\/script>
      </body></html>`);
    win.document.close();
    win.focus();
  }
};
