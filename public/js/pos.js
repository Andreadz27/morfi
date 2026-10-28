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

    const productBtns = filtered.map(p => `
      <button class="pos-product-btn" onclick="POS.addToCart(${p.id}, ${jsArg(p.nombre)}, ${Number(p.precio_venta) || 0})">
        <div class="product-icon"><i class="fas ${p.grupos && p.grupos.length ? 'fa-sliders-h' : 'fa-utensils'}"></i></div>
        <div class="product-name">${esc(p.nombre)}</div>
        <div class="product-price">${fmtMoneda(p.precio_venta)}</div>
      </button>
    `).join('');

    view.innerHTML = `
      <div class="pos-layout">
        <div class="pos-products">
          <div class="pos-products-head">
            <h3><i class="fas fa-utensils"></i> Productos</h3>
            ${App.puede('pedidos.ver') ? `<button class="btn btn-outline btn-sm" onclick="POS.verRetiro()" title="Pedidos de mostrador y barra: en preparación, listos y cobro"><i class="fas fa-bell-concierge"></i> Para retirar <span class="pos-action-badge" id="posRetiroBadge"></span></button>` : ''}
            <span class="pos-products-count">${filtered.length} disponibles</span>
          </div>
          <div class="pos-buscador">
            <i class="fas fa-search"></i>
            <input type="search" id="posBuscar" placeholder="Buscar producto... (Enter agrega el primero)" value="${esc(this.busqueda)}"
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
              <span class="pos-cart-count">${this.cart.reduce((s,i)=>s+i.cantidad,0)} items</span>
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
  },

  renderCartItems() {
    if (this.cart.length === 0) {
      return '<div class="empty-state"><i class="fas fa-shopping-cart"></i><p>Agreg\u00e1 productos al pedido</p></div>';
    }
    return this.cart.map((item, idx) => `
      <div class="pos-cart-item">
        <div class="pos-cart-item-info">
          <div class="pos-cart-item-name">${esc(item.nombre)}</div>
          <div class="pos-cart-item-price">${fmtMoneda(item.precio)} c/u</div>
        </div>
        <div class="pos-qty-controls">
          <button class="pos-qty-btn" onclick="POS.changeQty(${idx}, -1)">-</button>
          <span class="pos-qty">${item.cantidad}</span>
          <button class="pos-qty-btn" onclick="POS.changeQty(${idx}, 1)">+</button>
        </div>
        <div class="font-bold">${fmtMoneda(item.precio * item.cantidad)}</div>
        <button class="pos-qty-btn" onclick="POS.removeItem(${idx})"><i class="fas fa-times"></i></button>
      </div>
    `).join('');
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
      this.refreshCart();
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
    if (q) return this.productos.filter(p => p.nombre.toLowerCase().includes(q) || String(p.descripcion || '').toLowerCase().includes(q));
    if (this.categoriaActiva === 'para_llevar') return this.productos.filter(p => p.para_llevar);
    return this.categoriaActiva === 'todas' ? this.productos : this.productos.filter(p => p.categoria_id == this.categoriaActiva);
  },
  buscar(texto) {
    this.busqueda = texto;
    const grid = document.querySelector('#view-pos .pos-product-grid');
    if (!grid) return;
    const lista = this.filtrados();
    grid.innerHTML = lista.map(p => `
      <button class="pos-product-btn" onclick="POS.addToCart(${p.id}, ${jsArg(p.nombre)}, ${Number(p.precio_venta) || 0})">
        <div class="product-icon"><i class="fas ${p.grupos && p.grupos.length ? 'fa-sliders-h' : 'fa-utensils'}"></i></div>
        <div class="product-name">${esc(p.nombre)}</div>
        <div class="product-price">${fmtMoneda(p.precio_venta)}</div>
      </button>`).join('') || '<div class="empty-state"><i class="fas fa-search"></i><p>No hay productos con ese nombre</p></div>';
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

  refreshCart() {
    const itemsEl = document.getElementById('posCartItems');
    if (itemsEl) itemsEl.innerHTML = this.htmlCombo() + this.renderCartItems();
    if (!this.cart.length) { const s = document.getElementById('posSugerencias'); if (s) s.innerHTML = ''; }

    const countEl = document.querySelector('#view-pos .pos-cart-count');
    if (countEl) countEl.textContent = `${this.cart.reduce((s,i)=>s+i.cantidad,0)} items`;

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
          <option value="salon">Sal\u00f3n</option>
          <option value="mostrador">Mostrador</option>
          <option value="delivery">Delivery</option>
          <option value="takeaway">Take Away</option>
        </select>
      </div>
      <div class="form-group" id="checkoutMesaGroup">
        <label>Mesa</label>
        <select id="checkoutMesa"></select>
      </div>
      <div class="form-group" id="checkoutClienteGroup" style="display:none">
        <label>Cliente</label>
        <input type="text" id="checkoutCliente" placeholder="Nombre del cliente">
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
            <input type="number" id="checkoutCostoEnvio" min="0" step="0.01" value="0">
          </div>
        </div>
      </div>
      <div class="form-group">
        <label>Notas para cocina</label>
        <textarea id="checkoutNotas" placeholder="Ej: sin cebolla, bien cocida..."></textarea>
      </div>
      <div class="modal-footer">
        <button class="btn btn-danger" onclick="App.closeModal()">Cancelar</button>
        <button class="btn btn-success" onclick="POS.confirmCheckout()">
          <i class="fas fa-check"></i> Confirmar pedido
        </button>
      </div>
    `, { title: 'Confirmar pedido', large: true });

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
      document.getElementById('checkoutClienteGroup').style.display =
        (tipo === 'delivery' || tipo === 'takeaway') ? 'block' : 'none';
      const esDelivery = tipo === 'delivery';
      document.getElementById('checkoutTelLlevarGroup').style.display = tipo === 'takeaway' ? 'block' : 'none';
      document.getElementById('checkoutDeliveryGroup').style.display = esDelivery ? 'grid' : 'none';
      document.getElementById('checkoutDeliveryExtra').style.display = esDelivery ? 'block' : 'none';
    });

    // Desde el área Take Away el pedido sale como Take Away
    if (this.categoriaActiva === 'para_llevar') {
      const sel = document.getElementById('checkoutTipo');
      sel.value = 'takeaway';
      sel.dispatchEvent(new Event('change'));
    }

    // Forzar selección de tipo si hay mesa preseleccionada (salón)
    const tipoInit = document.getElementById('checkoutTipo').value;
    if (tipoInit === 'delivery') {
      document.getElementById('checkoutDeliveryGroup').style.display = 'grid';
      document.getElementById('checkoutDeliveryExtra').style.display = 'block';
    }
  },

  // ===== Cobrar y enviar en un toque (mostrador / barra) =====
  // Un solo paso: se crea el pedido de mostrador, va a la cocina y se cobra. Para mesas, delivery o take away con
  // teléfono sigue "Procesar pedido".
  htmlBotonesCobro() {
    const vacio = this.cart.length === 0 ? 'disabled' : '';
    return `${App.puede('pedidos.cobrar') ? `<button class="pos-rapido-btn" onclick="POS.cobroRapido()" ${vacio}>
        <i class="fas fa-bolt"></i> Cobrar y enviar (mostrador)
      </button>` : ''}
      <button class="pos-checkout-btn" onclick="POS.checkout()" ${vacio} ${App.puede('pedidos.cobrar') ? 'style="background:#475569"' : ''}>
        <i class="fas fa-check-circle"></i> Procesar pedido
      </button>`;
  },

  cobroRapido() {
    if (this.cart.length === 0) return;
    const metodos = Object.entries(Cobro.METODOS).filter(([v]) => v !== 'giftcard');
    const total = this.cartFinal();
    const alias = App.config && App.config.alias_transferencia;
    App.showModal(`
      <form onsubmit="POS.confirmarCobroRapido(event)">
        <p class="cont-total-form mb-10">Total: <strong>${fmtMoneda(total)}</strong></p>
        <div class="form-group">
          <label>Nombre <small class="text-muted">(con él lo llaman cuando está listo; opcional)</small></label>
          <input type="text" id="rapidoNombre" maxlength="40" placeholder="Ej.: Ana">
        </div>
        <div class="form-group">
          <label>Cómo paga</label>
          <div style="display:flex;flex-wrap:wrap;gap:6px" id="rapidoMetodos">
            ${metodos.map(([v, t], i) => `<label class="btn btn-outline btn-sm" style="cursor:pointer"><input type="radio" name="rapidoMetodo" value="${v}" ${i === 0 ? 'checked' : ''} onchange="POS.cambiarMetodoRapido()"> ${esc(t)}</label>`).join('')}
          </div>
        </div>
        <div class="form-group" id="rapidoEfectivo">
          <label>Recibido <small class="text-muted">(para calcular el vuelto; opcional)</small></label>
          <input type="number" id="rapidoRecibido" min="0" step="0.01" placeholder="${total}" oninput="POS.vueltoRapido()">
          <small id="rapidoVuelto" class="text-muted"></small>
        </div>
        ${alias ? `<p class="text-muted" id="rapidoAlias" style="display:none"><i class="fas fa-university"></i> Alias: <strong>${esc(alias)}</strong></p>` : ''}
        <div class="form-group">
          <label>Notas para cocina</label>
          <input type="text" id="rapidoNotas" maxlength="300" placeholder="Ej.: sin hielo">
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-danger" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-success"><i class="fas fa-bolt"></i> Cobrar y enviar a cocina</button>
        </div>
      </form>`, { title: 'Cobrar y enviar' });
    this.cambiarMetodoRapido();
    setTimeout(() => { const i = document.getElementById('rapidoNombre'); if (i) i.focus(); }, 50);
  },

  metodoRapido() {
    const r = document.querySelector('input[name="rapidoMetodo"]:checked');
    return r ? r.value : 'efectivo';
  },

  cambiarMetodoRapido() {
    const m = this.metodoRapido();
    const ef = document.getElementById('rapidoEfectivo');
    if (ef) ef.style.display = m === 'efectivo' ? '' : 'none';
    const al = document.getElementById('rapidoAlias');
    if (al) al.style.display = m === 'transferencia' ? '' : 'none';
  },

  vueltoRapido() {
    const recibido = Number(document.getElementById('rapidoRecibido').value) || 0;
    const v = Math.round((recibido - this.cartFinal()) * 100) / 100;
    document.getElementById('rapidoVuelto').textContent = recibido ? (v >= 0 ? `Vuelto: ${fmtMoneda(v)}` : `Faltan ${fmtMoneda(-v)}`) : '';
  },

  confirmarCobroRapido(e) {
    e.preventDefault();
    return App.sinDobleEnvio('pos.cobroRapido', () => this._cobroRapido());
  },

  async _cobroRapido() {
    const metodo = this.metodoRapido();
    const cliente = document.getElementById('rapidoNombre').value.trim();
    const notas = document.getElementById('rapidoNotas').value.trim();
    const recibidoTxt = metodo === 'efectivo' ? document.getElementById('rapidoRecibido').value : '';
    if (recibidoTxt && Number(recibidoTxt) < this.cartFinal() - 0.009) return App.showToast('El efectivo recibido no cubre el total', 'warning');
    const items = this.cart.map(item => ({ producto_id: item.producto_id, nombre: item.nombre, cantidad: item.cantidad, precio: item.precio, opciones: item.opciones || [] }));
    let pedido;
    try {
      pedido = await API.createPedido({ tipo: 'mostrador', cliente, items, notas, descuento: this.descuento, propina: this.propina },
        `Pedido ${cliente}`.trim());
    } catch (err) { return App.showToast(err.message, 'error'); }
    this.cart = []; this.descuento = 0; this.propina = 0;
    App.closeModal();
    this.paint(document.getElementById('view-pos'));
    if (pedido.encolado) return App.showToast('Sin WiFi: el pedido quedó guardado y se envía solo al volver la conexión. Cobralo desde Pedidos.', 'warning', 9000);
    try {
      const r = await API.cobrarEnMesa(pedido.id, { pagos: [{ metodo, monto: pedido.total, ...(recibidoTxt ? { recibido: Number(recibidoTxt) } : {}) }] });
      App.showToast(`Pedido ${pedido.numero_pedido} cobrado y en la cocina${r && r.vuelto > 0 ? ` · vuelto ${fmtMoneda(r.vuelto)}` : ''}`, 'success', 7000);
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

  async verRetiro() {
    try {
      const t = await API.getRetiro();
      const fila = (p, listo) => `<tr>
        <td><strong>#${esc(p.numero_corto)}</strong> ${esc(p.nombre || '')} <small class="text-muted">${esc(p.numero_pedido)}</small>${p.origen === 'barra' ? ' <span class="badge badge-orange">QR</span>' : ''}</td>
        <td>${listo ? '<span class="badge badge-green">Listo</span>' : '<span class="badge badge-gray">En preparación</span>'}</td>
        <td>${p.pagado ? '<span class="text-success">Pagado</span>' : `Falta ${fmtMoneda(p.saldo)}${p.aviso_pago === 'transferencia' ? ' <span class="badge badge-red">Avisó transferencia</span>' : ''}`}</td>
        <td style="white-space:nowrap">
          ${!p.pagado && p.aviso_pago === 'transferencia' && App.puede('pedidos.cobrar') ? `<button class="btn btn-success btn-sm" onclick="POS.transferenciaRecibida(${p.id})"><i class="fas fa-university"></i> Transferencia recibida</button>` : ''}
          ${!p.pagado && App.puede('pedidos.cobrar') ? `<button class="btn btn-outline btn-sm" onclick="App.closeModal();Cobro.abrir(${p.id})"><i class="fas fa-cash-register"></i> Cobrar</button>` : ''}
          <button class="btn btn-primary btn-sm" onclick="POS.entregado(${p.id}, ${p.pagado})"><i class="fas fa-check"></i> Entregado</button>
        </td></tr>`;
      const filas = t.listos.map(p => fila(p, true)).join('') + t.preparando.map(p => fila(p, false)).join('');
      App.showModal(filas ? `<div class="table-wrap"><table>
        <thead><tr><th>Pedido</th><th>Estado</th><th>Pago</th><th></th></tr></thead><tbody>${filas}</tbody></table></div>
        <p class="text-muted mt-10">Los listos salen de la pantalla de retiro al tocar <strong>Entregado</strong> (o solos a los 45 minutos).</p>`
        : '<div class="empty-state"><i class="fas fa-bell-concierge"></i><p>No hay pedidos de mostrador ni de barra pendientes</p></div>',
        { title: 'Para retirar', large: true });
    } catch (err) { App.showToast(err.message, 'error'); }
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

    try {
      const pedido = await API.createPedido({
        tipo,
        // El selector de mesa se oculta al cambiar a otro tipo, pero conserva el valor (DEF-003)
        mesa_id: tipo === 'salon' ? mesaId || null : null,
        cliente: cliente,
        items,
        notas,
        descuento: this.descuento,
        propina: this.propina,
        plataforma,
        codigo_externo,
        direccion,
        telefono,
        costo_envio
      }, this.descripcionPedido(tipo, mesaId, cliente));
      App.closeModal();
      if (pedido.encolado) {
        App.showToast('Sin WiFi: el pedido quedó guardado en este celular y se envía solo al volver la conexión', 'warning', 8000);
        this.cart = [];
        this.descuento = 0;
        this.propina = 0;
        this.paint(document.getElementById('view-pos'));
        return;
      }
      App.showToast(`Pedido ${pedido.numero_pedido} creado`, 'success');

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