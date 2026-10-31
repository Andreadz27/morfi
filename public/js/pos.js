// =============================================
// FADIDO - Punto de Venta (POS)
// Interfaz r\u00e1pida para tomar pedidos
// =============================================

const POS = {
  productos: [],
  categorias: [],
  cart: [],
  categoriaActiva: 'todas',
  busqueda: '',
  descuento: 0,
  propina: 0,
  promociones: [],

  catIcon(nombre) {
    const n = (nombre || '').toLowerCase();
    if (n.includes('entrada') || n.includes('entrante')) return 'fa-utensils';
    if (n.includes('plato') || n.includes('principal') || n.includes('parrilla')) return 'fa-drumstick-bite';
    if (n.includes('alcoh') || n.includes('vino') || n.includes('cerveza')) return 'fa-wine-glass';
    if (n.includes('bebida') || n.includes('gaseosa') || n.includes('jugo') || n.includes('refresco')) return 'fa-glass-martini-alt';
    if (n.includes('postre') || n.includes('dulce') || n.includes('torta') || n.includes('helado')) return 'fa-ice-cream';
    if (n.includes('delivery') || n.includes('domicilio') || n.includes('llevar') || n.includes('take')) return 'fa-motorcycle';
    if (n.includes('ensalada') || n.includes('verdura') || n.includes('saludable')) return 'fa-leaf';
    if (n.includes('desayuno') || n.includes('cafe') || n.includes('café')) return 'fa-mug-hot';
    return 'fa-tag';
  },

  async render() {
    const view = document.getElementById('view-pos');
    view.innerHTML = '<div class="text-center mt-20"><i class="fas fa-spinner fa-spin fa-3x"></i></div>';
    try {
      this.categorias = await API.getCategorias();
      // Los insumos y las sub-recetas no se venden
      this.productos = (await API.getProductos()).filter(p => (p.clase || 'venta') === 'venta');
      await Opciones.cargar();
      this.busqueda = '';
      this.cart = [];
      this.descuento = 0;
      this.propina = 0;
      this.categoriaActiva = 'todas';
      this.promociones = [];
      // Cargar promociones para ofrecer descuentos rápidos
      API.getPromociones().then(promos => { this.promociones = promos || []; }).catch(() => {});
      this.paint(view);
    } catch (err) {
      view.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error: ${esc(err.message)}</p></div>`;
    }
  },

  // Nota de la categoría elegida (la misma de la carta: opciones de leche, horarios de las promos...)
  htmlNotaCategoria() {
    const c = this.categorias.find(x => x.id === this.categoriaActiva);
    return c && c.descripcion ? `<div class="pos-nota-categoria"><i class="fas fa-info-circle"></i> ${esc(c.descripcion)}</div>` : '';
  },

  paint(view) {
    const paraLlevar = this.productos.filter(p => p.para_llevar).length;
    const catBtns = [
      `<button class="pos-cat-btn ${this.categoriaActiva === 'todas' ? 'active' : ''}" onclick="POS.setCategoria('todas')"><i class="fas fa-th-large"></i> Todas <span class="pos-cat-count">${this.productos.length}</span></button>`,
      // Take Away: los productos del menú para llevar (se marcan en Productos)
      ...(paraLlevar ? [`<button class="pos-cat-btn ${this.categoriaActiva === 'para_llevar' ? 'active' : ''}" onclick="POS.setCategoria('para_llevar')" style="--cat-color:#ea580c"><i class="fas fa-shopping-bag"></i> Take Away <span class="pos-cat-count">${paraLlevar}</span></button>`] : [])
    ].concat(this.categorias.map(c => {
      const icon = POS.catIcon(c.nombre);
      const count = this.productos.filter(p => p.categoria_id == c.id).length;
      const isActive = this.categoriaActiva === c.id;
      return `<button class="pos-cat-btn ${isActive ? 'active' : ''}" onclick="POS.setCategoria(${c.id})" ${c.color ? `style="--cat-color:${esc(c.color)}"` : ''}>
        <i class="fas ${icon}"></i> ${esc(c.nombre)} <span class="pos-cat-count">${count}</span>
      </button>`;
    })).join('');

    const filtered = this.filtrados();
    const productBtns = filtered.map(p => this.tarjeta(p)).join('');

    view.innerHTML = `
      <div class="pos-layout">
        <div class="pos-products">
          <div class="pos-products-head">
            <h3><i class="fas fa-utensils"></i> Productos</h3>
            ${App.puede('pedidos.ver') ? `<button class="btn btn-outline btn-sm" onclick="App.callarPedidos();POS.verRetiro()" title="Pedidos de mostrador y barra: en preparación, listos y cobro"><i class="fas fa-bell-concierge"></i> Para retirar <span class="pos-action-badge" id="posRetiroBadge"></span></button>` : ''}
            <span class="pos-products-count">${filtered.length} disponibles</span>
          </div>
          <div class="pos-buscador">
            <i class="fas fa-search"></i>
            <input type="search" id="posBuscar" placeholder="Buscar producto ( / )  ·  Enter agrega el primero" value="${esc(this.busqueda)}"
              oninput="POS.buscar(this.value)" onkeydown="POS.teclaBuscar(event)" aria-label="Buscar producto" autocomplete="off">
          </div>
          <div class="pos-categories">${catBtns}</div>
          ${this.htmlNotaCategoria()}
          <div class="pos-product-grid">
            ${productBtns || '<div class="empty-state"><i class="fas fa-box-open"></i><p>Sin productos en esta categor\u00eda</p></div>'}
          </div>
        </div>

        <div class="pos-cart">
          <div class="pos-cart-header">
            <h3><i class="fas fa-shopping-cart"></i> Pedido actual</h3>
            <div class="pos-cart-header-right">
              <span class="pos-cart-count">${this.textoItems()}</span>
              <button class="pos-cart-clear" onclick="POS.clearCart()" title="Vaciar pedido" ${this.cart.length === 0 ? 'disabled' : ''}><i class="fas fa-trash"></i></button>
            </div>
          </div>
          <div class="pos-sugerencias" id="posSugerencias"></div>
          <div class="pos-cart-items" id="posCartItems">
            ${this.htmlCombo()}${this.renderCartItems()}
          </div>
          <div class="pos-cart-footer">
            <div class="pos-cart-actions">
              ${App.puede('pedidos.descuento') ? `<button class="pos-action-btn" onclick="POS.promocionModal()">
                <i class="fas fa-percent"></i> Descuento <span class="pos-action-badge">${this.descuento > 0 ? 'ON' : ''}</span>
              </button>` : ''}
              <button class="pos-action-btn" onclick="POS.propinaModal()">
                <i class="fas fa-hand-holding-usd"></i> Propina <span class="pos-action-badge">${this.propina > 0 ? 'ON' : ''}</span>
              </button>
            </div>
            <div class="pos-totals">
              <div class="pos-total-row">
                <span>Subtotal</span>
                <span id="posSubtotal" class="pos-subtotal-val">${fmtMoneda(this.cartTotal())}</span>
              </div>
              ${this.descuento > 0 ? `
              <div class="pos-total-row pos-row-discount">
                <span>Descuento</span>
                <span id="posDescuento">-${fmtMoneda(this.cartDescuento())}</span>
              </div>` : ''}
              ${this.propina > 0 ? `
              <div class="pos-total-row pos-row-tip">
                <span>Propina</span>
                <span id="posPropina">+${fmtMoneda(this.cartPropina())}</span>
              </div>` : ''}
              <div class="pos-total-sep"></div>
              <div class="pos-total-grand">
                <span>TOTAL</span>
                <span id="posTotal">${fmtMoneda(this.cartFinal())}</span>
              </div>
            </div>
            ${this.htmlBotonesCobro()}
          </div>
        </div>
      </div>
    `;
    this.actualizarBadgeRetiro();
    // "/" lleva al buscador; el escuchador se registra una sola vez
    if (!this._atajo) {
      this._atajo = true;
      document.addEventListener('keydown', e => {
        const v = document.getElementById('view-pos');
        if (e.key !== '/' || !v || v.offsetParent === null || /input|textarea|select/i.test(e.target.tagName)) return;
        e.preventDefault();
        const b = document.getElementById('posBuscar');
        if (b) b.focus();
      });
    }
  },

  // ===== Tarjeta del producto: la foto (Productos → "Foto para la carta") o el color e ícono de su categoría,
  // y cuántos hay en el pedido. Tocarla lo agrega. =====
  foto(p) {
    return p && p.foto ? `/api/publico/fotos/${Number(p.id)}?v=${encodeURIComponent(p.foto)}` : '';
  },
  colorDe(p) {
    const c = String((p && p.categoria_color) || '');
    return /^#[0-9a-f]{3,8}$/i.test(c) ? c : '#64748b';
  },
  textoItems() {
    const n = this.cart.reduce((s, i) => s + i.cantidad, 0);
    return n === 1 ? '1 ítem' : `${n} ítems`;
  },
  enCarrito(id) {
    return this.cart.filter(i => i.producto_id === id).reduce((s, i) => s + i.cantidad, 0);
  },
  tarjeta(p) {
    const foto = this.foto(p);
    const q = this.enCarrito(p.id);
    const sinStock = p.tracking_stock && Number(p.stock_actual) <= 0;
    const cat = this.categorias.find(c => c.id == p.categoria_id);
    return `<button class="pos-product-btn${foto ? ' con-foto' : ''}${q ? ' en-pedido' : ''}${sinStock ? ' sin-stock' : ''}" data-id="${p.id}"
        style="--prod-color:${this.colorDe(p)}" onclick="POS.addToCart(${p.id}, ${jsArg(p.nombre)}, ${Number(p.precio_venta) || 0})"
        aria-label="Agregar ${esc(p.nombre)}">
      <span class="pos-prod-media">${foto
        ? `<img src="${foto}" alt="" loading="lazy" decoding="async" onerror="this.closest('.pos-product-btn').classList.remove('con-foto');this.remove()">`
        : ''}<i class="fas ${this.catIcon(cat ? cat.nombre : '')}"></i></span>
      <span class="pos-prod-qty" aria-hidden="true">${q || ''}</span>
      ${p.grupos && p.grupos.length ? '<span class="pos-prod-tag" title="Tiene opciones"><i class="fas fa-sliders-h"></i></span>' : ''}
      ${sinStock ? '<span class="pos-prod-agotado">Sin stock</span>' : ''}
      <span class="pos-prod-info">
        <span class="product-name">${esc(p.nombre)}</span>
        <span class="product-price">${fmtMoneda(p.precio_venta)}</span>
      </span>
    </button>`;
  },
  // Actualiza los contadores de las tarjetas sin volver a dibujar la grilla
  marcarEnCarrito(animarId) {
    document.querySelectorAll('#view-pos .pos-product-btn[data-id]').forEach(b => {
      const id = Number(b.dataset.id);
      const q = this.enCarrito(id);
      b.classList.toggle('en-pedido', q > 0);
      const el = b.querySelector('.pos-prod-qty');
      if (el) el.textContent = q || '';
      if (id === animarId && q) { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }
    });
  },

  renderCartItems() {
    if (this.cart.length === 0) {
      return '<div class="empty-state"><i class="fas fa-shopping-cart"></i><p>Agreg\u00e1 productos al pedido</p></div>';
    }
    return this.cart.map((item, idx) => {
      const p = this.productos.find(x => x.id === item.producto_id);
      const foto = this.foto(p);
      return `
      <div class="pos-cart-item" style="--prod-color:${this.colorDe(p)}">
        <span class="pos-cart-thumb">${foto ? `<img src="${foto}" alt="" loading="lazy">` : esc((item.nombre || '?').trim().charAt(0).toUpperCase())}</span>
        <div class="pos-cart-item-info">
          <div class="pos-cart-item-name">${esc(item.nombre)}</div>
          <div class="pos-cart-item-price">${fmtMoneda(item.precio)} c/u</div>
        </div>
        <div class="pos-qty-controls">
          <button class="pos-qty-btn" onclick="POS.changeQty(${idx}, -1)" aria-label="${item.cantidad === 1 ? 'Quitar' : 'Uno menos'}">${item.cantidad === 1 ? '<i class="fas fa-trash-alt"></i>' : '&#8722;'}</button>
          <span class="pos-qty">${item.cantidad}</span>
          <button class="pos-qty-btn" onclick="POS.changeQty(${idx}, 1)" aria-label="Uno más">+</button>
        </div>
        <div class="pos-cart-item-total">${fmtMoneda(item.precio * item.cantidad)}</div>
      </div>`;
    }).join('');
  },
setCategoria(id) {
    this.busqueda = '';
    this.categoriaActiva = id;
    this.paint(document.getElementById('view-pos'));
  },

  // Con opciones ("¿Qué leche?", adicionales) pregunta antes de agregar; cada combinación es una línea
  addToCart(id, nombre, precio) {
    const prod = this.productos.find(p => p.id === id) || { id, nombre, precio_venta: precio, grupos: [] };
    if (!VentaCruzada.disponible(prod.horario)) App.showToast(`${nombre} está fuera de su horario (como promo, se ofrece en otro momento)`, 'warning', 6000);
    Opciones.elegir(prod, ({ opciones, extra, sufijo }) => {
      const clave = id + ':' + opciones.slice().sort((a, b) => a - b).join(',');
      const existing = this.cart.find(i => (i.clave || i.producto_id + ':') === clave);
      if (existing) {
        existing.cantidad++;
      } else {
        this.cart.push({ producto_id: id, nombre: nombre + sufijo, precio: precio + extra, cantidad: 1, opciones, clave });
      }
      this.refreshCart(id);
      this.sugerir(prod, this.cart.findIndex(i => (i.clave || i.producto_id + ':') === clave));
    });
  },

  // ===== Venta cruzada (js/venta-cruzada.js): qué ofrecer, ¿grande?, te conviene la promo =====
  sugerir(prod, linea) {
    const el = document.getElementById('posSugerencias');
    if (!el) return;
    const grande = VentaCruzada.grande(prod, this.productos);
    const acompa = VentaCruzada.acompanar(prod, this.productos, this.categorias, this.cart.map(i => i.producto_id));
    if (!grande && !acompa.length) { el.innerHTML = ''; return; }
    el.innerHTML = `<span class="pos-sug-titulo"><i class="fas fa-lightbulb"></i> Ofrecé:</span>
      ${grande ? `<button class="pos-sug-btn pos-sug-grande" onclick="POS.cambiarAGrande(${linea})">Grande +${fmtMoneda(grande.precio_venta - prod.precio_venta)}</button>` : ''}
      ${acompa.map(p => `<button class="pos-sug-btn" onclick="POS.addToCart(${p.id}, ${jsArg(p.nombre)}, ${Number(p.precio_venta) || 0})">${esc(p.nombre)}</button>`).join('')}`;
  },

  // Una unidad de la línea pasa a la versión grande (con las opciones que la grande también tiene)
  cambiarAGrande(idx) {
    const l = this.cart[idx];
    if (!l) return;
    const grande = VentaCruzada.grande(this.productos.find(p => p.id === l.producto_id), this.productos);
    if (!grande) return;
    const grupos = Opciones.gruposDe(grande);
    const opciones = (l.opciones || []).filter(id => grupos.some(g => g.opciones.some(o => o.id === id)));
    const elegidas = grupos.flatMap(g => g.opciones.filter(o => opciones.includes(o.id)));
    l.cantidad--;
    if (l.cantidad <= 0) this.cart.splice(idx, 1);
    const clave = grande.id + ':' + opciones.slice().sort((a, b) => a - b).join(',');
    const ya = this.cart.find(i => (i.clave || i.producto_id + ':') === clave);
    if (ya) ya.cantidad++;
    else this.cart.push({ producto_id: grande.id, nombre: grande.nombre + (elegidas.length ? ' · ' + elegidas.map(o => o.nombre).join(', ') : ''),
      precio: grande.precio_venta + elegidas.reduce((s, o) => s + (Number(o.precio) || 0), 0), cantidad: 1, opciones, clave });
    document.getElementById('posSugerencias').innerHTML = '';
    this.refreshCart();
  },

  htmlCombo() {
    const c = VentaCruzada.comboConveniente(this.cart, this.productos);
    return c ? `<div class="pos-combo-conviene"><span><i class="fas fa-tags"></i> Conviene <strong>${esc(c.combo.nombre)}</strong>: ahorra ${fmtMoneda(c.ahorro)}</span>
      <button class="btn btn-sm btn-primary" onclick="POS.cambiarACombo()">Cambiar</button></div>` : '';
  },

  // Saca lo que arma el combo y agrega el combo (si tiene opciones, se eligen)
  cambiarACombo() {
    const c = VentaCruzada.comboConveniente(this.cart, this.productos);
    if (!c) return;
    for (const u of c.usar) this.cart[u.linea].cantidad -= u.cantidad;
    this.cart = this.cart.filter(i => i.cantidad > 0);
    this.refreshCart();
    this.addToCart(c.combo.id, c.combo.nombre, Number(c.combo.precio_venta) || 0);
  },

  // Buscador: filtra en todas las categorías mientras se escribe; Enter agrega el primero
  filtrados() {
    const q = this.busqueda.trim().toLowerCase();
    // Primero los que lo tienen en el nombre ("papas" → Papas fritas antes que la hamburguesa "con papas")
    if (q) {
      const enNombre = this.productos.filter(p => p.nombre.toLowerCase().includes(q));
      return enNombre.concat(this.productos.filter(p => !enNombre.includes(p) && String(p.descripcion || '').toLowerCase().includes(q)));
    }
    if (this.categoriaActiva === 'para_llevar') return this.productos.filter(p => p.para_llevar);
    return this.categoriaActiva === 'todas' ? this.productos : this.productos.filter(p => p.categoria_id == this.categoriaActiva);
  },
  buscar(texto) {
    this.busqueda = texto;
    const grid = document.querySelector('#view-pos .pos-product-grid');
    if (!grid) return;
    const lista = this.filtrados();
    grid.innerHTML = lista.map(p => this.tarjeta(p)).join('') || '<div class="empty-state"><i class="fas fa-search"></i><p>No hay productos con ese nombre</p></div>';
    const c = document.querySelector('#view-pos .pos-products-count');
    if (c) c.textContent = `${lista.length} disponibles`;
  },
  teclaBuscar(e) {
    if (e.key === 'Escape') { e.target.value = ''; this.buscar(''); return; }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const p = this.filtrados()[0];
    if (!p) return;
    this.addToCart(p.id, p.nombre, Number(p.precio_venta) || 0);
    e.target.value = '';
    this.buscar('');
  },

  changeQty(idx, delta) {
    const item = this.cart[idx];
    if (!item) return;
    item.cantidad += delta;
    if (item.cantidad <= 0) {
      this.cart.splice(idx, 1);
    }
    this.refreshCart();
  },

  removeItem(idx) {
    this.cart.splice(idx, 1);
    this.refreshCart();
  },

  clearCart() {
    this.cart = [];
    this.descuento = 0;
    this.propina = 0;
    this.refreshCart();
  },

  promocionModal() {
    const self = this;
    let promoOpts = '<option value="manual">Descuento manual ($)</option>';
    (this.promociones || []).forEach(p => {
      const descripcion = p.tipo === 'porcentaje' ? `${p.valor}%` : `$${p.valor}`;
      promoOpts += `<option value="promo-${p.id}" data-tipo="${p.tipo}" data-valor="${p.valor}">${esc(p.nombre)} (${descripcion})</option>`;
    });
    App.showModal(`
      <form onsubmit="POS.aplicarPromo(event)">
        <div class="form-group">
          <label>Promoción</label>
          <select id="posPromoTipo" onchange="POS.actualizarCampoDescuento()">
            ${promoOpts}
          </select>
        </div>
        <div class="form-group" id="posPromoMontoGroup">
          <label>Monto de descuento ($)</label>
          <input type="number" id="posPromoMonto" min="0" step="0.01" value="${self.descuento}" placeholder="0">
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-danger" onclick="App.closeModal()">Cancelar</button>
          <button type="button" class="btn btn-warning" onclick="POS.quitarDescuento()">Sin descuento</button>
          <button type="submit" class="btn btn-success">Aplicar descuento</button>
        </div>
      </form>
    `, { title: 'Aplicar descuento / promoción' });
  },

  actualizarCampoDescuento() {
    const select = document.getElementById('posPromoTipo');
    const opt = select.options[select.selectedIndex];
    const group = document.getElementById('posPromoMontoGroup');
    if (opt && opt.value.startsWith('promo-') && opt.dataset.tipo === 'porcentaje') {
      group.style.display = 'none';
    } else {
      group.style.display = 'block';
    }
  },

  async aplicarPromo(e) {
    e.preventDefault();
    const select = document.getElementById('posPromoTipo');
    const opt = select.options[select.selectedIndex];
    if (opt.value === 'manual') {
      this.descuento = parseFloat(document.getElementById('posPromoMonto').value) || 0;
    } else {
      const tipo = opt.dataset.tipo;
      const valor = parseFloat(opt.dataset.valor);
      if (tipo === 'porcentaje') {
        // Porcentaje del subtotal
        const monto = (this.cartTotal() * valor) / 100;
        this.descuento = Math.round(monto);
      } else {
        this.descuento = valor;
      }
    }
    App.closeModal();
    this.refreshCart();
    App.showToast('Descuento aplicado', 'success');
  },

  quitarDescuento() {
    this.descuento = 0;
    App.closeModal();
    this.refreshCart();
  },

  propinaModal() {
    App.showModal(`
      <form onsubmit="POS.aplicarPropina(event)">
        <div class="form-group">
          <label>Propina</label>
          <select id="posPropinaValor">
            <option value="0" ${this.propina === 0 ? 'selected' : ''}>Sin propina</option>
            <option value="10" ${this.propina === Math.round(this.cartTotal()*0.10) ? 'selected' : ''}>10% (${fmtMoneda(Math.round(this.cartTotal()*0.10))})</option>
            <option value="15" ${this.propina === Math.round(this.cartTotal()*0.15) ? 'selected' : ''}>15% (${fmtMoneda(Math.round(this.cartTotal()*0.15))})</option>
            <option value="20" ${this.propina === Math.round(this.cartTotal()*0.20) ? 'selected' : ''}>20% (${fmtMoneda(Math.round(this.cartTotal()*0.20))})</option>
            <option value="manual" ${(this.propina > 0 && ![10,15,20].some(m => m === Math.round(this.cartTotal()*m/100))) ? 'selected' : ''}>Otro monto</option>
          </select>
        </div>
        <div class="form-group" id="posPropinaManualGroup" style="${this.propina > 0 && ![10,15,20].includes(Math.round(this.cartTotal()*this.propina/100)) ? 'display:block' : 'display:none'}">
          <label>Monto de propina ($)</label>
          <input type="number" id="posPropinaManual" min="0" step="0.01" value="${this.propina}">
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-danger" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-success">Aplicar propina</button>
        </div>
      </form>
    `, { title: 'Aplicar propina' });

    const sel = document.getElementById('posPropinaValor');
    if (sel) {
      sel.addEventListener('change', (ev) => {
        document.getElementById('posPropinaManualGroup').style.display = ev.target.value === 'manual' ? 'block' : 'none';
      });
    }
  },

  aplicarPropina(e) {
    e.preventDefault();
    const val = document.getElementById('posPropinaValor').value;
    if (val === 'manual') {
      this.propina = parseFloat(document.getElementById('posPropinaManual').value) || 0;
    } else {
      this.propina = Math.round((this.cartTotal() * parseFloat(val)) / 100);
    }
    App.closeModal();
    this.refreshCart();
    App.showToast('Propina aplicada', 'success');
  },


  cartTotal() {
    return this.cart.reduce((sum, item) => sum + (item.precio * item.cantidad), 0);
  },

  cartDescuento() {
    return Math.min(this.descuento || 0, this.cartTotal());
  },

  cartPropina() {
    return this.propina || 0;
  },

  cartFinal() {
    return Math.max(0, this.cartTotal() - this.cartDescuento() + this.cartPropina());
  },

  refreshCart(animarId) {
    this.marcarEnCarrito(animarId);
    const itemsEl = document.getElementById('posCartItems');
    if (itemsEl) itemsEl.innerHTML = this.htmlCombo() + this.renderCartItems();
    if (!this.cart.length) { const s = document.getElementById('posSugerencias'); if (s) s.innerHTML = ''; }

    const countEl = document.querySelector('#view-pos .pos-cart-count');
    if (countEl) countEl.textContent = this.textoItems();

    const btnCheckout = document.querySelector('#view-pos .pos-checkout-btn');
    if (btnCheckout) btnCheckout.disabled = this.cart.length === 0;

    const clearBtn = document.querySelector('#view-pos .pos-cart-clear');
    if (clearBtn) clearBtn.disabled = this.cart.length === 0;

    // Re-render del pie del carrito para reflejar descuento/propina y totales
    const footer = document.querySelector('#view-pos .pos-cart-footer');
    if (footer) {
      footer.innerHTML = `
        <div class="pos-cart-actions">
          ${App.puede('pedidos.descuento') ? `<button class="pos-action-btn" onclick="POS.promocionModal()">
            <i class="fas fa-percent"></i> Descuento <span class="pos-action-badge">${this.descuento > 0 ? 'ON' : ''}</span>
          </button>` : ''}
          <button class="pos-action-btn" onclick="POS.propinaModal()">
            <i class="fas fa-hand-holding-usd"></i> Propina <span class="pos-action-badge">${this.propina > 0 ? 'ON' : ''}</span>
          </button>
        </div>
        <div class="pos-totals">
          <div class="pos-total-row">
            <span>Subtotal</span>
            <span class="pos-subtotal-val">${fmtMoneda(this.cartTotal())}</span>
          </div>
          ${this.descuento > 0 ? `
          <div class="pos-total-row pos-row-discount">
            <span>Descuento</span>
            <span>-${fmtMoneda(this.cartDescuento())}</span>
          </div>` : ''}
          ${this.propina > 0 ? `
          <div class="pos-total-row pos-row-tip">
            <span>Propina</span>
            <span>+${fmtMoneda(this.cartPropina())}</span>
          </div>` : ''}
          <div class="pos-total-sep"></div>
          <div class="pos-total-grand">
            <span>TOTAL</span>
            <span>${fmtMoneda(this.cartFinal())}</span>
          </div>
        </div>
        ${this.htmlBotonesCobro()}
      `;
    }
  },
checkout() {
    if (this.cart.length === 0) return;

    App.showModal(`
      <div class="form-group">
        <label>Tipo de pedido</label>
        <select id="checkoutTipo">
          <option value="mostrador">Mostrador</option>
          <option value="salon">Sal\u00f3n (mesa)</option>
          <option value="takeaway">Take Away</option>
          <option value="delivery">Delivery</option>
        </select>
      </div>
      <div class="form-group" id="checkoutMesaGroup" style="display:none">
        <label>Mesa</label>
        <select id="checkoutMesa"></select>
      </div>
      <div class="form-group" id="checkoutClienteGroup">
        <label>Nombre <small class="text-muted">(con \u00e9l lo llaman cuando est\u00e1 listo; opcional)</small></label>
        <input type="text" id="checkoutCliente" placeholder="Ej.: Ana">
        <div id="checkoutTelLlevarGroup" style="display:none" class="mt-10">
          <label>Tel&eacute;fono (para avisarle por WhatsApp cuando est&eacute; listo)</label>
          <input type="text" id="checkoutTelefonoLlevar" placeholder="11-1234-5678">
        </div>
      </div>
      <div class="grid grid-2" id="checkoutDeliveryGroup" style="display:none">
        <div class="form-group">
          <label>Plataforma</label>
          <select id="checkoutPlataforma"></select>
        </div>
        <div class="form-group">
          <label>N&deg; pedido app</label>
          <input type="text" id="checkoutCodigoExt" placeholder="Ej: PY-123456">
        </div>
      </div>
      <div id="checkoutDeliveryExtra" style="display:none">
        <div class="form-group">
          <label>Direcci&oacute;n de entrega</label>
          <input type="text" id="checkoutDireccion" placeholder="Calle, n&uacute;mero, piso...">
        </div>
        <div class="grid grid-2">
          <div class="form-group">
            <label>Tel&eacute;fono</label>
            <input type="text" id="checkoutTelefono" placeholder="11-1234-5678">
          </div>
          <div class="form-group">
            <label>Costo de env&iacute;o ($)</label>
            <input type="number" id="checkoutCostoEnvio" min="0" step="0.01" value="0" oninput="POS.actualizarBotonCheckout()">
          </div>
        </div>
      </div>
      ${this.htmlPago()}
      <div class="form-group">
        <label>Notas para cocina</label>
        <textarea id="checkoutNotas" placeholder="Ej: sin cebolla, bien cocida..."></textarea>
      </div>
      <div class="modal-footer">
        <button class="btn btn-danger" onclick="App.closeModal()">Cancelar</button>
        <button class="btn btn-success" id="checkoutBtn" onclick="POS.confirmCheckout()">
          <i class="fas fa-check"></i> Confirmar pedido
        </button>
      </div>
    `, { title: 'Confirmar pedido', large: true });
    const conMesa = !!this.mesaPreseleccionada;
    this._propinaRapida = false;

    API.getMesas().then(mesas => {
      const select = document.getElementById('checkoutMesa');
      // Libres y reservadas (llegó el cliente de la reserva); la elegida desde Mesas aparece siempre
      const elegibles = mesas.filter(m => m.estado !== 'ocupada' || m.id == this.mesaPreseleccionada);
      select.innerHTML = '<option value="">Sin mesa</option>' +
        elegibles.map(m => `<option value="${m.id}">${esc(m.nombre)}${m.estado === 'reservada' ? ' (reservada)' : ''}</option>`).join('');
      if (this.mesaPreseleccionada) {
        select.value = this.mesaPreseleccionada;
        this.mesaPreseleccionada = null;
      }
    }).catch(() => {});

    // Cargar plataformas de delivery activas
    API.getPlataformasDelivery().then(plats => {
      const activas = (plats || []).filter(p => p.activa);
      const sel = document.getElementById('checkoutPlataforma');
      sel.innerHTML = activas.length
        ? activas.map(p => `<option value="${esc(p.nombre)}">${esc(p.nombre)}</option>`).join('')
        : '<option value="">Sin plataforma</option>';
    }).catch(() => {});

    document.getElementById('checkoutTipo').addEventListener('change', (e) => {
      const tipo = e.target.value;
      document.getElementById('checkoutMesaGroup').style.display = tipo === 'salon' ? 'block' : 'none';
      document.getElementById('checkoutClienteGroup').style.display = tipo === 'salon' ? 'none' : 'block';
      const esDelivery = tipo === 'delivery';
      document.getElementById('checkoutTelLlevarGroup').style.display = tipo === 'takeaway' ? 'block' : 'none';
      document.getElementById('checkoutDeliveryGroup').style.display = esDelivery ? 'grid' : 'none';
      document.getElementById('checkoutDeliveryExtra').style.display = esDelivery ? 'block' : 'none';
      // Mostrador y para llevar pagan al pedir; la mesa y el delivery, al final (se puede cambiar)
      this.setPagaAhora(tipo === 'mostrador' || tipo === 'takeaway');
    });

    // Desde Mesas el pedido es de esa mesa; desde el área Take Away, para llevar; si no, mostrador
    const sel = document.getElementById('checkoutTipo');
    sel.value = conMesa ? 'salon' : this.categoriaActiva === 'para_llevar' ? 'takeaway' : 'mostrador';
    sel.dispatchEvent(new Event('change'));
    this.cambiarMetodoRapido();
  },

  // ===== Un solo botón: se elige el tipo de pedido y si paga ahora (mostrador, para llevar) o al final (mesa) =====
  htmlBotonesCobro() {
    const vacio = this.cart.length === 0 ? 'disabled' : '';
    return `<button class="pos-checkout-btn" onclick="POS.checkout()" ${vacio}>
        <i class="fas fa-check-circle"></i> ${App.puede('pedidos.cobrar') ? 'Cobrar / enviar pedido' : 'Enviar pedido'}
      </button>`;
  },

  // Cómo paga (solo quien puede cobrar): medio, lo recibido (vuelto) y la propina en un toque
  htmlPago() {
    if (!App.puede('pedidos.cobrar')) return '';
    const metodos = Object.entries(Cobro.METODOS).filter(([v]) => v !== 'giftcard');
    const alias = App.config && App.config.alias_transferencia;
    return `
      <div class="form-group">
        <label>¿Cuándo paga?</label>
        <div class="cobro-chips pos-cuando-paga">
          <button type="button" class="btn" id="checkoutPagaAhora" onclick="POS.setPagaAhora(true)"><i class="fas fa-cash-register"></i> Paga ahora</button>
          <button type="button" class="btn" id="checkoutPagaDespues" onclick="POS.setPagaAhora(false)"><i class="fas fa-clock"></i> Paga al final</button>
        </div>
      </div>
      <div id="checkoutPago">
        <div class="form-group">
          <label>Cómo paga</label>
          <div style="display:flex;flex-wrap:wrap;gap:6px" id="rapidoMetodos">
            ${metodos.map(([v, t], i) => `<label class="btn btn-outline btn-sm" style="cursor:pointer"><input type="radio" name="rapidoMetodo" value="${v}" ${i === 0 ? 'checked' : ''} onchange="POS.cambiarMetodoRapido()"> ${esc(t)}</label>`).join('')}
          </div>
        </div>
        <div class="form-group">
          <label id="rapidoRecibidoTxt">Recibido</label>
          <input type="number" id="rapidoRecibido" min="0" step="0.01" oninput="POS.vueltoRapido()">
          <div id="rapidoVuelto" class="mt-10"></div>
        </div>
        ${alias ? `<p class="text-muted" id="rapidoAlias" style="display:none"><i class="fas fa-university"></i> Alias: <strong>${esc(alias)}</strong></p>` : ''}
      </div>`;
  },

  // Total a cobrar: el carrito más el envío del delivery
  totalCheckout() {
    const tipo = (document.getElementById('checkoutTipo') || {}).value;
    const envio = tipo === 'delivery' ? parseFloat((document.getElementById('checkoutCostoEnvio') || {}).value) || 0 : 0;
    return Math.round((this.cartFinal() + envio) * 100) / 100;
  },

  setPagaAhora(si) {
    this._pagaAhora = !!si && App.puede('pedidos.cobrar');
    const a = document.getElementById('checkoutPagaAhora'), d = document.getElementById('checkoutPagaDespues');
    if (a) a.className = `btn ${this._pagaAhora ? 'btn-success' : 'btn-outline'}`;
    if (d) d.className = `btn ${this._pagaAhora ? 'btn-outline' : 'btn-primary'}`;
    const pago = document.getElementById('checkoutPago');
    if (pago) pago.style.display = this._pagaAhora ? '' : 'none';
    this.actualizarBotonCheckout();
  },

  actualizarBotonCheckout() {
    const total = this.totalCheckout();
    const r = document.getElementById('rapidoRecibido');
    if (r) r.placeholder = total;
    const b = document.getElementById('checkoutBtn');
    if (b) b.innerHTML = this._pagaAhora
      ? `<i class="fas fa-check"></i> Cobrar ${fmtMoneda(total)} y enviar a cocina`
      : '<i class="fas fa-check"></i> Enviar a cocina (cobrar después)';
    this.vueltoRapido();
  },

  metodoRapido() {
    const r = document.querySelector('input[name="rapidoMetodo"]:checked');
    return r ? r.value : 'efectivo';
  },

  cambiarMetodoRapido() {
    const m = this.metodoRapido();
    const txt = document.getElementById('rapidoRecibidoTxt');
    if (txt) txt.innerHTML = m === 'efectivo'
      ? 'Recibido <small class="text-muted">(para calcular el vuelto; opcional)</small>'
      : 'Cobrado <small class="text-muted">(solo si pagó más que el total: la diferencia es propina)</small>';
    const al = document.getElementById('rapidoAlias');
    if (al) al.style.display = m === 'transferencia' ? '' : 'none';
    this.vueltoRapido();
  },

  // Lo que entregó/pagó por encima del total
  excedenteRapido() {
    const recibido = Number((document.getElementById('rapidoRecibido') || {}).value) || 0;
    return recibido ? Math.round((recibido - this.totalCheckout()) * 100) / 100 : 0;
  },

  // Vuelto (efectivo) o lo que pagó de más (tarjeta, transferencia): un toque y queda de propina
  vueltoRapido() {
    const el = document.getElementById('rapidoVuelto');
    if (!el) return;
    const recibido = Number(document.getElementById('rapidoRecibido').value) || 0;
    const v = this.excedenteRapido();
    if (v <= 0) this._propinaRapida = false;
    const efectivo = this.metodoRapido() === 'efectivo';
    el.innerHTML = !recibido ? ''
      : v < 0 ? `<span class="text-danger">Faltan ${fmtMoneda(-v)}</span>`
      : v === 0 ? '<span class="text-muted">Justo, sin vuelto</span>'
      : this._propinaRapida
        ? `<span class="text-success"><i class="fas fa-hand-holding-usd"></i> Propina ${fmtMoneda(v)}${efectivo ? ' · sin vuelto' : ''}</span>
           <button type="button" class="btn btn-sm btn-outline" onclick="POS.propinaRapida(false)">Deshacer</button>`
        : `<strong>${efectivo ? 'Vuelto' : 'Pagó de más'}: ${fmtMoneda(v)}</strong>
           <button type="button" class="btn btn-success btn-propina" onclick="POS.propinaRapida(true)"><i class="fas fa-hand-holding-usd"></i> ${efectivo ? 'No quiere el vuelto: es propina' : 'Es propina'}</button>`;
  },

  propinaRapida(si) {
    this._propinaRapida = !!si;
    this.vueltoRapido();
  },

  // "Paga ahora": lo que se cobra, validado antes de crear el pedido. null = no se puede (ya avisó por qué)
  datosCobroAhora() {
    const metodo = this.metodoRapido();
    const excedente = this.excedenteRapido();
    if (excedente < -0.009) { App.showToast(metodo === 'efectivo' ? 'El efectivo recibido no cubre el total' : 'Lo cobrado no cubre el total', 'warning'); return null; }
    if (excedente > 0 && metodo !== 'efectivo' && !this._propinaRapida) { App.showToast('Pagó de más: tocá «Es propina» o corregí el monto', 'warning'); return null; }
    // Si deja el vuelto (o lo que pagó de más) de propina, se suma a la propina del pedido
    const extra = this._propinaRapida && excedente > 0 ? excedente : 0;
    const recibido = metodo === 'efectivo' && !extra ? document.getElementById('rapidoRecibido').value : '';
    return { metodo, extra, recibido };
  },

  async cobrarAlEnviar(pedido, cobro) {
    try {
      const r = await API.cobrarEnMesa(pedido.id, { pagos: [{ metodo: cobro.metodo, monto: pedido.total, ...(cobro.recibido ? { recibido: Number(cobro.recibido) } : {}) }] });
      App.showToast(`Pedido ${pedido.numero_pedido} cobrado y en la cocina${r && r.vuelto > 0 ? ` · vuelto ${fmtMoneda(r.vuelto)}` : ''}${cobro.extra ? ` · propina ${fmtMoneda(cobro.extra)}` : ''}`, 'success', 7000);
    } catch (err) {
      // El pedido ya está en la cocina: el cobro se hace desde Pedidos (no se crea de nuevo)
      App.showToast(`Pedido ${pedido.numero_pedido} enviado a la cocina, pero no se pudo cobrar: ${err.message}. Cobralo desde Pedidos.`, 'error', 10000);
    }
    this.actualizarBadgeRetiro();
  },

  // ===== Para retirar: pedidos de mostrador y barra en preparación y listos =====
  async actualizarBadgeRetiro() {
    const b = document.getElementById('posRetiroBadge');
    if (!b) return;
    try {
      const t = await API.getRetiro();
      const avisos = [...t.preparando, ...t.listos].filter(p => p.aviso_pago).length;
      b.textContent = t.listos.length ? `${t.listos.length} listo${t.listos.length > 1 ? 's' : ''}` : (t.preparando.length || '');
      b.style.background = avisos ? '#dc2626' : '';
      if (avisos) b.textContent += ' · $';
    } catch (e) { b.textContent = ''; }
  },

  // Con una sola computadora este panel es la cocina, la caja y la pantalla de retiro: se ve qué preparar, se marca
  // Listo (avisa al celular del cliente), se cobra y se entrega. Mientras está abierto se actualiza solo (app.js).
  retiroAbierto() { return !!document.getElementById('panelRetiro'); },

  async verRetiro() {
    App.pedirPermisoNotificaciones();
    try {
      const t = await API.getRetiro();
      const items = p => (p.items || []).map(i => `${esc(i.cantidad)} × ${esc(i.nombre_producto)}${i.notas ? ` <em>(${esc(i.notas)})</em>` : ''}`).join(' · ');
      const fila = (p, listo) => `<tr>
        <td><strong>#${esc(p.numero_corto)}</strong> ${esc(p.nombre || '')} <small class="text-muted">${esc(p.numero_pedido)}</small>${p.origen === 'barra' ? ` <span class="badge badge-orange">${p.lugar ? esc(p.lugar) : 'QR'}</span>` : ''}${p.whatsapp ? ' <i class="fab fa-whatsapp text-success" title="Pidió aviso por WhatsApp"></i>' : ''}
          ${p.items && p.items.length ? `<div class="text-muted" style="font-size:13px;margin-top:2px">${items(p)}</div>` : ''}</td>
        <td>${listo ? '<span class="badge badge-green">Listo</span>' : '<span class="badge badge-gray">En preparación</span>'}</td>
        <td>${p.pagado ? '<span class="text-success">Pagado</span>' : `Falta ${fmtMoneda(p.saldo)}${p.aviso_pago === 'transferencia' ? ' <span class="badge badge-red">Avisó transferencia</span>' : ''}`}</td>
        <td style="white-space:nowrap">
          ${!p.pagado && p.aviso_pago === 'transferencia' && App.puede('pedidos.cobrar') ? `<button class="btn btn-success btn-sm" onclick="POS.transferenciaRecibida(${p.id})"><i class="fas fa-university"></i> Transferencia recibida</button>` : ''}
          ${!p.pagado && App.puede('pedidos.cobrar') ? `<button class="btn btn-outline btn-sm" onclick="App.closeModal();Cobro.abrir(${p.id})"><i class="fas fa-cash-register"></i> Cobrar</button>` : ''}
          ${!listo && App.puede('cocina') ? `<button class="btn btn-success btn-sm" onclick="POS.marcarListo(${p.id}, this)" title="Le avisa al cliente en su celular (y por WhatsApp si lo pidió)"><i class="fas fa-bell"></i> Listo</button>` : ''}
          ${listo ? `<button class="btn btn-outline btn-sm" onclick="POS.llamarDeNuevo(${p.id})" title="Vuelve a sonar en su celular, en la pantalla de retiro y por WhatsApp"><i class="fas fa-bullhorn"></i> Llamar de nuevo</button>` : ''}
          <button class="btn btn-primary btn-sm" onclick="POS.entregado(${p.id}, ${p.pagado})"><i class="fas fa-check"></i> Entregado</button>
        </td></tr>`;
      // Primero lo que hay que preparar (el más viejo arriba), después lo que espera que lo retiren
      const filas = t.preparando.map(p => fila(p, false)).join('') + t.listos.map(p => fila(p, true)).join('');
      App.showModal(`<div id="panelRetiro">${filas ? `<div class="table-wrap"><table>
        <thead><tr><th>Pedido</th><th>Estado</th><th>Pago</th><th></th></tr></thead><tbody>${filas}</tbody></table></div>
        <p class="text-muted mt-10">Dejá esta ventana abierta: se actualiza sola y suena cuando entra un pedido. <strong>Listo</strong> le avisa al
          cliente en su celular; <strong>Entregado</strong> lo saca de la lista (los listos salen solos a los 45 minutos).</p>`
        : '<div class="empty-state"><i class="fas fa-bell-concierge"></i><p>No hay pedidos de mostrador ni de barra pendientes</p><p class="text-muted">Dejá esta ventana abierta: suena cuando entra un pedido.</p></div>'}</div>`,
        { title: 'Para retirar', large: true });
      const panel = document.getElementById('panelRetiro');
      // Tocar el panel = alguien ya lo está viendo: deja de sonar
      panel.addEventListener('pointerdown', () => App.callarPedidos());
      panel.insertAdjacentHTML('beforeend', '<button class="btn btn-outline btn-sm mt-10" onclick="App.probarSonido()" title="Subí el volumen de la PC hasta que se escuche bien desde la caja"><i class="fas fa-volume-high"></i> Probar sonido</button>');
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  async marcarListo(id, btn) {
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
    try { await API.marcarListo(id); App.showToast('Listo: le avisamos al cliente', 'success'); } catch (err) { App.showToast(err.message, 'error'); }
    this.verRetiro();
    this.actualizarBadgeRetiro();
  },

  async transferenciaRecibida(id) {
    if (!confirm('¿Ya viste la transferencia en la cuenta? Se cobra lo que falta.')) return;
    try {
      const r = await API.cobrarTransferencia(id);
      App.showToast(`${r.numero_pedido}: cobrado ${fmtMoneda(r.monto)} por transferencia`, 'success');
    } catch (err) { App.showToast(err.message, 'error'); }
    this.verRetiro();
    this.actualizarBadgeRetiro();
  },

  async llamarDeNuevo(id) {
    try { await API.llamarDeNuevo(id); App.showToast('Lo estamos llamando de nuevo', 'success'); } catch (err) { App.showToast(err.message, 'error'); }
  },

  async entregado(id, pagado) {
    if (!pagado && !confirm('Este pedido todavía no está pago. ¿Lo entregás igual?')) return;
    try { await API.marcarRetirado(id); } catch (err) { App.showToast(err.message, 'error'); }
    this.verRetiro();
    this.actualizarBadgeRetiro();
  },

  confirmCheckout() {
    return App.sinDobleEnvio('pos.checkout', () => this._confirmCheckout());
  },

  // Nombre para los avisos de un pedido guardado sin WiFi ("Pedido de Mesa 3")
  descripcionPedido(tipo, mesaId, cliente) {
    const sel = document.getElementById('checkoutMesa');
    const mesa = tipo === 'salon' && mesaId && sel && sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex].text : '';
    return mesa ? `Pedido de ${mesa}` : `Pedido ${cliente || ''}`.trim();
  },

  async _confirmCheckout() {
    const tipo = document.getElementById('checkoutTipo').value;
    const mesaId = document.getElementById('checkoutMesa') ? document.getElementById('checkoutMesa').value : null;
    const cliente = document.getElementById('checkoutCliente') ? document.getElementById('checkoutCliente').value : '';
    const notas = document.getElementById('checkoutNotas') ? document.getElementById('checkoutNotas').value : '';

    // Datos de delivery
    const plataforma = document.getElementById('checkoutPlataforma') ? document.getElementById('checkoutPlataforma').value : '';
    const codigo_externo = document.getElementById('checkoutCodigoExt') ? document.getElementById('checkoutCodigoExt').value : '';
    const direccion = document.getElementById('checkoutDireccion') ? document.getElementById('checkoutDireccion').value : '';
    const campoTel = document.getElementById(tipo === 'takeaway' ? 'checkoutTelefonoLlevar' : 'checkoutTelefono');
    const telefono = campoTel ? campoTel.value : '';
    const costo_envio = document.getElementById('checkoutCostoEnvio') ? parseFloat(document.getElementById('checkoutCostoEnvio').value) || 0 : 0;

    const items = this.cart.map(item => ({
      producto_id: item.producto_id,
      nombre: item.nombre,
      cantidad: item.cantidad,
      precio: item.precio,
      opciones: item.opciones || []
    }));

    // "Paga ahora": se valida el cobro antes de mandar el pedido a la cocina
    const cobro = this._pagaAhora ? this.datosCobroAhora() : null;
    if (this._pagaAhora && !cobro) return;

    try {
      const pedido = await API.createPedido({
        tipo,
        // El selector de mesa se oculta al cambiar a otro tipo, pero conserva el valor (DEF-003)
        mesa_id: tipo === 'salon' ? mesaId || null : null,
        cliente: cliente,
        items,
        notas,
        descuento: this.descuento,
        propina: Math.round(((this.propina || 0) + (cobro ? cobro.extra : 0)) * 100) / 100,
        plataforma,
        codigo_externo,
        direccion,
        telefono,
        costo_envio
      }, this.descripcionPedido(tipo, mesaId, cliente));
      App.closeModal();
      if (pedido.encolado) {
        App.showToast(`Sin WiFi: el pedido quedó guardado en este celular y se envía solo al volver la conexión${cobro ? '. Cobralo desde Pedidos' : ''}`, 'warning', 8000);
        this.cart = [];
        this.descuento = 0;
        this.propina = 0;
        this.paint(document.getElementById('view-pos'));
        return;
      }
      if (cobro) await this.cobrarAlEnviar(pedido, cobro);
      else App.showToast(`Pedido ${pedido.numero_pedido} creado`, 'success');

      // Si el servidor mandó la comanda a una impresora térmica no hace falta nada más.
      // Sin impresoras configuradas, se usa la impresión del navegador (si está activada).
      const cfg = pedido.impresion_comanda ? null : await API.getConfig().catch(() => null);
      if (cfg && cfg.activar_impresion && cfg.activar_impresion !== 0) {
        const detalle = await API.getPedido(pedido.id).catch(() => null);
        if (detalle) {
          App.imprimirRecibo({ ...detalle, numero_pedido: pedido.numero_pedido, total: pedido.total });
        }
      }

      this.cart = [];
      this.descuento = 0;
      this.propina = 0;
      if (tipo === 'salon' && mesaId) {
        App.navigateTo('mesas');
      } else {
        this.paint(document.getElementById('view-pos'));
      }
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  }
};