// =============================================
// FADIDO - Pedidos
// Listado, detalle y operaciones de pedidos
// =============================================

const Pedidos = {
  pedidos: [],
  filtro: 'abiertos',
  fecha: null, // día que se mira (AAAA-MM-DD); null = hoy

  // Los abiertos se ven siempre todos (aunque sean de otro día: hay que cobrarlos); el resto, del día elegido
  async render() {
    const view = document.getElementById('view-pedidos');
    view.innerHTML = '<div class="text-center mt-20"><i class="fas fa-spinner fa-spin fa-3x"></i></div>';
    try {
      this.pedidos = await API.getPedidos(this.filtro, this.filtro === 'abiertos' ? null : this.diaElegido());
      this.paint(view);
    } catch (err) {
      view.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error: ${esc(err.message)}</p></div>`;
    }
  },

  setFiltro(filtro) {
    this.filtro = filtro;
    this.render();
  },

  diaElegido() { return this.fecha || hoyLocal(); },
  diaAntes(fecha, n = 1) { return new Date(Date.parse(fecha + 'T12:00:00Z') - n * 86400000).toISOString().slice(0, 10); },

  // Hoy / Ayer / un día del calendario. Si estaba en "Abiertos", pasa a "Todos" para ver lo de ese día
  setFecha(fecha) {
    const hoy = hoyLocal();
    this.fecha = !fecha || fecha >= hoy ? null : fecha;
    if (this.filtro === 'abiertos' && this.fecha) this.filtro = 'todos';
    this.render();
  },

  htmlFechas() {
    const hoy = hoyLocal(), ayer = this.diaAntes(hoy), dia = this.diaElegido();
    const abiertos = this.filtro === 'abiertos';
    const nombre = dia === hoy ? 'hoy' : dia === ayer ? 'ayer' : fmtFecha(dia);
    return `
      <div class="filter-bar mb-10 pedidos-fechas">
        <span class="text-muted"><i class="fas fa-calendar-day"></i> Día:</span>
        <button class="btn btn-sm ${!abiertos && dia === hoy ? 'btn-primary' : 'btn-outline'}" onclick="Pedidos.setFecha('${hoy}')">Hoy</button>
        <button class="btn btn-sm ${!abiertos && dia === ayer ? 'btn-primary' : 'btn-outline'}" onclick="Pedidos.setFecha('${ayer}')">Ayer</button>
        <input type="date" id="pedidosFecha" value="${dia}" max="${hoy}" aria-label="Elegir día" onchange="Pedidos.setFecha(this.value)">
        <span class="text-muted">${abiertos ? 'Abiertos: se ven todos, de cualquier día' : `Mostrando los pedidos de <strong>${nombre}</strong>`}</span>
      </div>`;
  },

  paint(view) {
    const rows = this.pedidos.map(p => `
      <tr onclick="Pedidos.verDetalle(${p.id})" style="cursor:pointer">
        <td class="font-bold">${esc(p.numero_pedido)}</td>
        <td>${esc(p.tipo)}</td>
        <td>${esc(p.mesa_nombre || '-')}</td>
        <td>${esc(p.cliente || '-')}</td>
        <td>${Pedidos.fmtOrigen(p.origen)}</td>
        <td>${fmtEstado(p.estado)}</td>
        <td class="font-bold">${fmtMoneda(p.total)}</td>
        <td>${fmtFechaHora(p.creado_en)}</td>
      </tr>
    `).join('');

    view.innerHTML = `
      <div class="page-header">
        <div>
          <h2><i class="fas fa-receipt"></i> Pedidos</h2>
          <p>Historial y gesti\u00f3n de pedidos: hoy o cualquier d\u00eda anterior</p>
        </div>
        <button class="btn btn-success" onclick="App.navigateTo('pos')">
          <i class="fas fa-plus"></i> Nuevo pedido
        </button>
      </div>

      ${this.htmlFechas()}
      <div class="filter-bar mb-20">
        <button class="btn ${this.filtro === 'abiertos' ? 'btn-primary' : 'btn-outline'}" onclick="Pedidos.setFiltro('abiertos')">Abiertos</button>
        <button class="btn ${this.filtro === 'todos' ? 'btn-primary' : 'btn-outline'}" onclick="Pedidos.setFiltro('todos')">Todos</button>
        <button class="btn ${this.filtro === 'pagado' ? 'btn-primary' : 'btn-outline'}" onclick="Pedidos.setFiltro('pagado')">Pagados</button>
        <button class="btn ${this.filtro === 'cancelado' ? 'btn-primary' : 'btn-outline'}" onclick="Pedidos.setFiltro('cancelado')">Cancelados</button>
      </div>

      <div class="card">
        ${
          this.pedidos.length > 0 ? `
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>N\u00b0</th><th>Tipo</th><th>Mesa</th><th>Cliente</th>
                  <th>Origen</th><th>Estado</th><th>Total</th><th>Fecha</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          ` : `<div class="empty-state"><i class="fas fa-receipt"></i><p>No hay pedidos</p></div>`
        }
      </div>
    `;
  },
  fmtOrigen(origen) {
    if (!origen) return '';
    const map = {
      whatsapp:  '<span class="origen-badge wa"><i class="fab fa-whatsapp"></i> WhatsApp</span>',
      instagram: '<span class="origen-badge ig"><i class="fab fa-instagram"></i> Instagram</span>',
      web:       '<span class="origen-badge web"><i class="fas fa-globe"></i> Web</span>'
    };
    return map[origen] || '';
  },

  async cargarPedido(id) {
    return API.getPedido(id);
  },

  async verDetalle(id) {
    try {
      const p = await this.cargarPedido(id);
      this.mostrarDetalle(p);
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  mostrarDetalle(p) {
    this.ultimoPedido = p;
    const puedeQuitar = p.estado === 'abierto' && App.puede('admin');
    const items = p.items.map(i => `
      <tr>
        <td>${i.cantidad} x</td>
        <td>${esc(i.nombre_producto)}</td>
        <td class="text-right">${fmtMoneda(i.precio_unitario)}</td>
        <td class="font-bold">${fmtMoneda(i.subtotal)}</td>
        ${puedeQuitar ? `<td><button class="btn btn-sm btn-outline btn-quitar-item" onclick="Pedidos.quitarItem(${p.id}, ${i.id})" title="Quitar del pedido" aria-label="Quitar ${esc(i.nombre_producto)}"><i class="fas fa-trash-alt"></i></button></td>` : ''}
      </tr>
    `).join('');

    const pagos = p.pagos.map(pg => `
      <tr>
        <td>${fmtFechaHora(pg.fecha)}</td>
        <td>${esc(Cobro.METODOS[pg.metodo] || pg.metodo)}
          ${App.puede('admin') && pg.metodo !== 'giftcard' && p.estado !== 'cancelado'
            ? `<button class="btn btn-sm btn-outline" onclick="Pedidos.cambiarMedio(${p.id}, ${pg.id})" title="Se cargó mal el medio de pago"><i class="fas fa-pen"></i> Cambiar</button>` : ''}
          ${App.puede('admin') && pg.metodo !== 'giftcard' && p.estado === 'pagado'
            ? `<button class="btn btn-sm btn-outline" onclick="Pedidos.propinaDeMas(${p.id}, ${pg.id})" title="Pagó de más y es propina"><i class="fas fa-hand-holding-usd"></i> + Propina</button>` : ''}</td>
        <td class="font-bold">${fmtMoneda(pg.monto)}</td>
      </tr>
    `).join('');

    const esAbierto = p.estado === 'abierto';

    App.showModal(`
      <div class="form-group">
        <div class="grid grid-2">
          <div class="card sub-card">
            <div class="card-header"><span class="card-title"><i class="fas fa-receipt"></i> Pedido</span></div>
            <p><strong>N\u00b0:</strong> ${esc(p.numero_pedido)}</p>
            <p><strong>Fecha:</strong> ${fmtFechaHora(p.creado_en)}</p>
            <p><strong>Tipo:</strong> ${esc(p.tipo)}</p>
            <p><strong>Mesa:</strong> ${esc(p.mesa_nombre || '-')}</p>
            <p><strong>Cliente:</strong> ${esc(p.cliente || '-')}</p>
            <p><strong>Vendedor:</strong> ${esc(p.usuario_nombre || '-')}</p>
            <p><strong>Estado:</strong> ${fmtEstado(p.estado)}</p>
            <p><strong>Notas:</strong> ${esc(p.notas || '-')}</p>
            ${(p.comprobantes || []).map(c => Pedidos.htmlComprobante(c, p.comprobantes)).join('')}
          </div>
          <div class="card sub-card">
            <div class="card-header"><span class="card-title"><i class="fas fa-list"></i> Items</span></div>
            <table>
              <thead><tr><th>Cant</th><th>Producto</th><th>Precio</th><th>Subtotal</th>${puedeQuitar ? '<th></th>' : ''}</tr></thead>
              <tbody>${items || '<tr><td colspan="4">Sin items</td></tr>'}</tbody>
            </table>
            <div class="text-right mt-10">
              <p><strong>Subtotal:</strong> ${fmtMoneda(p.subtotal)}</p>
              ${p.descuento ? `<p><strong>Descuento:</strong> -${fmtMoneda(p.descuento)}</p>` : ''}
              ${p.propina ? `<p><strong>Propina:</strong> ${fmtMoneda(p.propina)}</p>` : ''}
              <p class="font-bold text-success"><strong>TOTAL:</strong> ${fmtMoneda(p.total)}</p>
              ${esAbierto && p.pagado > 0 ? `<p><strong>Ya cobrado:</strong> ${fmtMoneda(p.pagado)} &middot; <strong>Falta:</strong> ${fmtMoneda(p.saldo)}</p>` : ''}
            </div>
          </div>
        </div>
      </div>

      <div class="form-group">
        <h4><i class="fas fa-credit-card"></i> Pagos</h4>
        <table>
          <thead><tr><th>Fecha</th><th>M\u00e9todo</th><th>Monto</th></tr></thead>
          <tbody>${pagos || '<tr><td colspan="3">Sin pagos</td></tr>'}</tbody>
        </table>
      </div>

      <div class="modal-footer">
        ${p.estado !== 'cancelado' && App.puede('admin') ? `<button class="btn btn-danger" onclick="Pedidos.eliminar(${p.id})"><i class="fas fa-trash-alt"></i> Eliminar pedido</button>` : ''}
        <button class="btn btn-outline" onclick="App.closeModal()">Cerrar</button>
        ${p.estado === 'pagado' && Cobro.puedeCobrar(p) ? `<button class="btn btn-outline" onclick="Cobro.compartir(${p.id})"><i class="fab fa-whatsapp"></i> WhatsApp</button>` : ''}
        ${App.puede('pedidos.tomar') ? `<button class="btn btn-primary" onclick="Pedidos.imprimirTicket(${p.id})"><i class="fas fa-print"></i> ${p.estado === 'pagado' ? 'Imprimir ticket' : 'Precuenta'}</button>` : ''}
        ${p.estado !== 'cancelado' && App.puede('pedidos.tomar') ? `<button class="btn btn-outline" onclick="Pedidos.reimprimirComanda(${p.id})"><i class="fas fa-utensils"></i> Reimprimir comanda</button>` : ''}
        ${
          esAbierto ? `
          ${App.puede('pedidos.tomar') ? `<button class="btn btn-primary" onclick="Pedidos.agregarItem(${p.id})"><i class="fas fa-plus"></i> Item</button>` : ''}
          ${App.puede('pedidos.descuento') ? `<button class="btn btn-warning" onclick="Pedidos.aplicarDescuentoModal(${p.id})"><i class="fas fa-percent"></i> Descuento</button>` : ''}
          ${App.puede('pedidos.cobrar') ? `
          <button class="btn btn-outline" onclick="Pedidos.linkMercadoPago(${p.id})"><i class="fas fa-link"></i> Link Mercado Pago</button>` : ''}
          ${Cobro.puedeCobrar(p) ? `
          <button class="btn btn-success" onclick="Cobro.abrir(${p.id})"><i class="fas fa-dollar-sign"></i> Cobrar</button>` : ''}
          ` : ''
        }
        ${
          p.estado === 'pagado' && !Pedidos.facturaVigente(p) && Cobro.puedeCobrar(p)
            ? `<button class="btn btn-primary" onclick="Integraciones.abrirModalFacturar(${p.id}, ${Number(p.total) || 0})"><i class="fas fa-file-invoice"></i> Facturar AFIP</button>`
            : ''
        }
      </div>
    `, { title: `Detalle de pedido ${p.numero_pedido}`, large: true });
  },

  // Factura sin nota de crédito que la anule (si se anuló, el pedido se puede volver a facturar)
  facturaVigente(p) {
    const comps = p.comprobantes || [];
    return comps.find(c => [1, 6, 11].includes(c.tipo_comprobante) && !comps.some(nc => nc.comprobante_asociado_id === c.id));
  },

  htmlComprobante(c, todos) {
    const numero = `${String(c.punto_venta || '').padStart(4, '0')}-${String(c.numero_comprobante || '').padStart(8, '0')}`;
    const anulada = todos.find(nc => nc.comprobante_asociado_id === c.id);
    const esFactura = [1, 6, 11].includes(c.tipo_comprobante);
    const receptor = c.razon_social_receptor || c.cuit_receptor
      ? `<br><small class="text-muted">${esc(c.razon_social_receptor || '')} ${c.cuit_receptor ? 'CUIT ' + esc(c.cuit_receptor) : ''}</small>` : '';
    return `<p class="${anulada ? 'comprobante-anulado' : ''}"><strong>${esc(c.tipo_comprobante_nombre)}</strong> ${numero} &mdash; ${esc(c.autorizacion || 'CAE')} ${esc(c.cae)}
      ${anulada ? '<span class="badge badge-red">Anulada</span>' : ''}
      ${c.comprobante_asociado_id ? `<br><small class="text-muted">Motivo: ${esc(c.motivo || '-')}</small>` : ''}${receptor}
      ${esFactura && !anulada && App.puede('pedidos.cancelar')
        ? `<br><button class="btn btn-sm btn-outline" onclick="Integraciones.abrirNotaCredito(${c.id}, ${c.tipo_comprobante}, ${c.tipo_comprobante === 1 && !c.cuit_receptor})">
            <i class="fas fa-file-excel"></i> Anular con nota de crédito</button>` : ''}</p>`;
  },

  // Genera un link de pago de Mercado Pago; al aprobarse, el pedido se cierra solo
  // Ticket en la impresora térmica; si no hay ninguna configurada, impresión del navegador
  async imprimirTicket(pedidoId) {
    try {
      const r = await API.imprimirTicket(pedidoId);
      const fallas = r.resultados.filter(x => !x.ok);
      if (fallas.length) App.showToast(`No se pudo imprimir en ${fallas.map(f => f.impresora).join(', ')}: ${fallas[0].error}`, 'error', 8000);
      else App.showToast('Ticket enviado a la impresora', 'success');
    } catch (err) {
      if (/No hay impresoras/.test(err.message)) App.imprimirRecibo(this.ultimoPedido);
      else App.showToast(err.message, 'error');
    }
  },

  async reimprimirComanda(pedidoId) {
    try {
      const r = await API.imprimirComanda(pedidoId);
      const fallas = r.resultados.filter(x => !x.ok);
      if (fallas.length) App.showToast(`No se pudo imprimir en ${fallas.map(f => f.impresora).join(', ')}: ${fallas[0].error}`, 'error', 8000);
      else App.showToast(`Comanda reimpresa en ${r.resultados.map(x => x.impresora).join(', ')}`, 'success');
    } catch (err) {
      App.showToast(/No hay impresoras/.test(err.message)
        ? 'No hay impresoras de comandas configuradas (Configuración → Impresoras)' : err.message, 'error');
    }
  },

  async linkMercadoPago(pedidoId) {
    try {
      const r = await API.crearLinkMercadoPago(pedidoId);
      try { await navigator.clipboard.writeText(r.link); } catch (e) {}
      window.open(r.link, '_blank', 'noopener');
      App.showToast(r.notificaciones
        ? 'Link de pago copiado. El pedido se cerrará automáticamente al aprobarse el pago.'
        : 'Link de pago copiado. Sin BASE_URL pública HTTPS, el cobro deberá registrarse a mano.',
        r.notificaciones ? 'success' : 'warning');
    } catch (err) { App.showToast(err.message, 'error'); }
  },

async abrirPedidoDeMesa(mesaId) {
    try {
      const pedidos = await API.getPedidos('abiertos');
      const pedidoDeMesa = pedidos.find(p => p.mesa_id == mesaId);
      if (pedidoDeMesa) {
        this.verDetalle(pedidoDeMesa.id);
      } else {
        // Ocupada sin pedido (ej. se sentó a alguien y no pidió): se libera para poder usarla
        await API.cambiarEstadoMesa(mesaId, 'libre');
        App.showToast('La mesa no tenía pedido abierto: quedó libre', 'info');
        App.navigateTo('mesas');
      }
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  // "+ Item": se busca, se toca el producto y queda agregado al instante. La ventana sigue abierta para agregar
  // más (con la lista de lo agregado) hasta tocar "Listo".
  agregarItem(pedidoId) {
    Promise.all([API.getProductos(), Opciones.cargar()]).then(([todos]) => {
      this._productosItem = todos.filter(p => (p.clase || 'venta') === 'venta'); // insumos y sub-recetas no se venden
      this._itemPedido = { id: pedidoId, agregados: [] };
      this.abrirAgregarItem();
    }).catch(err => App.showToast(err.message, 'error'));
  },

  abrirAgregarItem() {
    const { id, agregados } = this._itemPedido;
    const listaAgregados = agregados.length
      ? `<strong><i class="fas fa-check-circle text-success"></i> Agregado:</strong> ${agregados.map(a => esc(a)).join(' · ')}` : '';
    // Si la ventana sigue abierta (producto sin opciones) se limpia en el lugar, sin volver a abrirla
    const yaAbierta = document.getElementById('itemAgregados');
    if (yaAbierta) {
      yaAbierta.innerHTML = listaAgregados;
      document.getElementById('itemBuscar').value = '';
      document.getElementById('itemCantidad').value = '1';
      document.getElementById('itemNotas').value = '';
      this.filtrarItem('');
      document.getElementById('itemBuscar').focus();
      return;
    }
    App.showModal(`
      <div class="form-group">
        <label for="itemBuscar">Buscá y tocá el producto para agregarlo</label>
        <input type="search" id="itemBuscar" placeholder="Buscar: nombre o categoría" autocomplete="off"
          oninput="Pedidos.filtrarItem(this.value)" onkeydown="Pedidos.teclaBuscarItem(event)" aria-label="Buscar producto">
        <div id="itemProducto" class="item-lista" role="listbox" aria-label="Productos"></div>
        <small class="text-muted" id="itemCuantos"></small>
      </div>
      <div class="grid grid-2">
        <div class="form-group">
          <label for="itemCantidad">Cantidad</label>
          <input type="number" id="itemCantidad" min="1" value="1">
        </div>
        <div class="form-group">
          <label for="itemNotas">Notas para cocina</label>
          <input type="text" id="itemNotas" maxlength="200" placeholder="Ej.: sin azúcar">
        </div>
      </div>
      <div id="itemAgregados" class="item-agregados">${listaAgregados}</div>
      <div class="modal-footer">
        <button type="button" class="btn btn-success" onclick="Pedidos.verDetalle(${id})"><i class="fas fa-check"></i> Listo</button>
      </div>
    `, { title: 'Agregar al pedido' });
    this.filtrarItem('');
    const buscar = document.getElementById('itemBuscar');
    if (buscar) buscar.focus();
  },

  // Buscador del "+ Item": sin acentos ni mayúsculas; primero los que lo tienen en el nombre, después por
  // categoría o descripción. El primero queda marcado: Enter lo agrega.
  _sinAcentos(t) {
    return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  },
  filtrarItem(texto) {
    const lista = document.getElementById('itemProducto');
    if (!lista) return;
    const q = this._sinAcentos(texto).trim();
    const todos = this._productosItem || [];
    let encontrados = todos;
    if (q) {
      const enNombre = todos.filter(p => this._sinAcentos(p.nombre).includes(q));
      const resto = todos.filter(p => !enNombre.includes(p) &&
        this._sinAcentos(`${p.categoria_nombre || ''} ${p.descripcion || ''}`).includes(q));
      encontrados = enNombre.concat(resto);
    }
    this._itemMarcado = 0;
    lista.innerHTML = encontrados.map((p, i) => `<button type="button" class="item-opcion${i === 0 ? ' marcado' : ''}" role="option" data-id="${p.id}"
      onclick="Pedidos.elegirItem(${p.id})">${esc(p.nombre)} <span>${fmtMoneda(p.precio_venta)}</span></button>`).join('');
    const cuantos = document.getElementById('itemCuantos');
    if (cuantos) cuantos.textContent = q ? (encontrados.length ? `${encontrados.length} de ${todos.length} productos` : 'No hay productos con ese nombre') : `${todos.length} productos`;
  },
  // Enter: agrega el marcado (el primero). Flechas: moverse por la lista. Escape: borrar la búsqueda
  teclaBuscarItem(e) {
    if (e.key === 'Escape' && e.target.value) { e.preventDefault(); e.stopPropagation(); e.target.value = ''; this.filtrarItem(''); return; }
    const botones = [...document.querySelectorAll('#itemProducto .item-opcion')];
    if (!botones.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      this._itemMarcado = Math.max(0, Math.min(botones.length - 1, (this._itemMarcado || 0) + (e.key === 'ArrowDown' ? 1 : -1)));
      botones.forEach((b, i) => b.classList.toggle('marcado', i === this._itemMarcado));
      botones[this._itemMarcado].scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      this.elegirItem(Number(botones[this._itemMarcado || 0].dataset.id));
    }
  },

  elegirItem(productoId) {
    return App.sinDobleEnvio('pedidos.item', () => this._agregarElegido(productoId));
  },

  async _agregarElegido(productoId) {
    const prod = (this._productosItem || []).find(p => p.id === productoId);
    if (!prod) return;
    const cantidad = Math.max(1, parseInt(document.getElementById('itemCantidad').value, 10) || 1);
    const data = { producto_id: prod.id, nombre: prod.nombre, cantidad, precio: prod.precio_venta, notas: document.getElementById('itemNotas').value };
    const agregar = async (opciones = [], sufijo = '') => {
      try {
        await API.addItemToPedido(this._itemPedido.id, { ...data, opciones });
        this._itemPedido.agregados.push(`${cantidad} x ${prod.nombre}${sufijo}`);
        App.showToast(`Agregado: ${cantidad} x ${prod.nombre}${sufijo}`, 'success');
      } catch (err) { App.showToast(err.message, 'error'); }
      // Vuelve a la búsqueda limpia para seguir agregando
      this.abrirAgregarItem();
    };
    // Con opciones ("¿Qué leche?", adicionales) se eligen antes de agregar
    if (Opciones.gruposDe(prod).length) {
      return Opciones.elegir(prod, ({ opciones, sufijo }) => agregar(opciones, sufijo || ''));
    }
    return agregar();
  },

  aplicarDescuentoModal(pedidoId) {
    App.showModal(`
      <form onsubmit="Pedidos.aplicarDescuento(event, ${pedidoId})">
        <div class="form-group">
          <label>Descuento ($)</label>
          <input type="number" id="descuentoMonto" min="0" step="0.01" placeholder="0" required>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-danger" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-success">Aplicar</button>
        </div>
      </form>
    `, { title: 'Aplicar descuento' });
  },

  async aplicarDescuento(e, pedidoId) {
    e.preventDefault();
    const descuento = parseFloat(document.getElementById('descuentoMonto').value);
    try {
      await API.aplicarDescuento(pedidoId, descuento);
      App.closeModal();
      App.showToast('Descuento aplicado', 'success');
      this.verDetalle(pedidoId);
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  async cancelar(id) {
    if (!confirm('\u00bfSeguro que deseas cancelar este pedido?')) return;
    try {
      await API.cancelarPedido(id);
      App.closeModal();
      App.showToast('Pedido cancelado', 'success');
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  // ===== Quitar un producto de un pedido abierto (administrador) =====
  quitarItem(pedidoId, itemId) {
    const p = this.ultimoPedido;
    const i = p && p.items.find(x => x.id === itemId);
    if (!i) return;
    const varios = Number.isInteger(Number(i.cantidad)) && Number(i.cantidad) > 1;
    App.showModal(`
      <p>¿Quitar <strong>${esc(i.nombre_producto)}</strong> (${i.cantidad} x ${fmtMoneda(i.precio_unitario)}) del pedido ${esc(p.numero_pedido)}?</p>
      <p class="text-muted">El total del pedido se actualiza solo.</p>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline" onclick="Pedidos.verDetalle(${pedidoId})">No, volver</button>
        ${varios ? `<button type="button" class="btn btn-warning" onclick="Pedidos.confirmarQuitarItem(${pedidoId}, ${itemId}, 1)"><i class="fas fa-minus"></i> Quitar uno</button>` : ''}
        <button type="button" class="btn btn-danger" onclick="Pedidos.confirmarQuitarItem(${pedidoId}, ${itemId})"><i class="fas fa-trash-alt"></i> ${varios ? `Quitar los ${i.cantidad}` : 'Quitar'}</button>
      </div>`, { title: 'Quitar producto' });
  },

  async confirmarQuitarItem(pedidoId, itemId, cantidad) {
    try {
      const r = await API.quitarItemPedido(pedidoId, itemId, cantidad);
      App.showToast(`Quitado: ${r.quitado}. Total ${fmtMoneda(r.total)}`, 'success');
      this.verDetalle(pedidoId);
      if (App.currentView === 'pedidos') this.render();
    } catch (err) {
      App.showToast(err.message, 'error', 8000);
    }
  },

  // ===== Pagó de más con tarjeta o transferencia: lo que entró de más es propina =====
  propinaDeMas(pedidoId, pagoId) {
    const p = this.ultimoPedido;
    const pg = p && p.pagos.find(x => x.id === pagoId);
    if (!pg) return;
    App.showModal(`
      <form onsubmit="event.preventDefault(); Pedidos.guardarPropinaDeMas(${pedidoId}, ${pagoId})">
        <p>Cobro de <strong>${fmtMoneda(pg.monto)}</strong> (${esc(Cobro.METODOS[pg.metodo] || pg.metodo)}). Si en realidad entró más plata, escribí cuánto entró:</p>
        <div class="form-group">
          <label for="propinaEntro">Lo que entró en total</label>
          <input type="number" id="propinaEntro" min="${pg.monto}" step="0.01" placeholder="Ej.: ${pg.monto + 5000}" oninput="Pedidos.textoPropinaDeMas(${pg.monto})" autofocus>
          <p class="text-success mt-10" id="propinaDeMasTxt"></p>
        </div>
        <p class="text-muted">La diferencia queda como propina: es del personal, no suma a las ventas ni a la ganancia.</p>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline" onclick="Pedidos.verDetalle(${pedidoId})">Volver</button>
          <button type="submit" class="btn btn-success"><i class="fas fa-hand-holding-usd"></i> Cargar propina</button>
        </div>
      </form>`, { title: `Propina · ${p.numero_pedido}` });
    this._montoCobro = pg.monto;
  },

  textoPropinaDeMas(cobrado) {
    const entro = Number(document.getElementById('propinaEntro').value) || 0;
    const t = document.getElementById('propinaDeMasTxt');
    t.textContent = entro > cobrado ? `Propina: ${fmtMoneda(Math.round((entro - cobrado) * 100) / 100)}` : '';
  },

  async guardarPropinaDeMas(pedidoId, pagoId) {
    const entro = Number(document.getElementById('propinaEntro').value) || 0;
    const monto = Math.round((entro - this._montoCobro) * 100) / 100;
    if (!(monto > 0)) return App.showToast('Escribí cuánto entró en total (más que el cobro)', 'warning');
    try {
      await API.propinaACobro(pedidoId, pagoId, monto);
      App.showToast(`Listo: ${fmtMoneda(monto)} de propina`, 'success');
      this.verDetalle(pedidoId);
      if (App.currentView === 'pedidos') this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  // ===== Corregir el medio de pago: un toque en el medio correcto =====
  cambiarMedio(pedidoId, pagoId) {
    const p = this.ultimoPedido;
    const pg = p && p.pagos.find(x => x.id === pagoId);
    if (!pg) return;
    const botones = Object.entries(Cobro.METODOS).filter(([v]) => v !== 'giftcard').map(([v, t]) => v === pg.metodo
      ? `<button type="button" class="btn btn-primary" disabled>${esc(t)} (actual)</button>`
      : `<button type="button" class="btn btn-outline" onclick="Pedidos.guardarMedio(${pedidoId}, ${pagoId}, '${v}')">${esc(t)}</button>`).join('');
    App.showModal(`
      <p>Cobro de <strong>${fmtMoneda(pg.monto)}</strong> del ${fmtFechaHora(pg.fecha)}. ¿Con qué pagó en realidad?</p>
      <div class="cobro-chips corregir-medios">${botones}</div>
      <p class="text-muted mt-10">La caja, el cierre y los reportes se corrigen solos.</p>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline" onclick="Pedidos.verDetalle(${pedidoId})"><i class="fas fa-arrow-left"></i> Volver</button>
      </div>`, { title: `Corregir medio de pago · ${p.numero_pedido}` });
  },

  async guardarMedio(pedidoId, pagoId, metodo) {
    try {
      await API.corregirMedioPago(pedidoId, pagoId, metodo);
      App.showToast(`Listo: el cobro quedó como ${Cobro.METODOS[metodo] || metodo}`, 'success');
      this.verDetalle(pedidoId);
      if (App.currentView === 'pedidos') this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  // ===== Eliminar un pedido (también cobrado): se elige el motivo con un toque =====
  MOTIVOS_ELIMINAR: ['Cargado por error', 'Pedido duplicado', 'Era una prueba', 'El cliente se fue', 'Otro'],

  eliminar(id) {
    const p = this.ultimoPedido;
    if (!p || p.id !== id) return;
    this._motivo = null;
    const cobrado = (p.pagos || []).reduce((s, x) => s + (Number(x.monto) || 0), 0);
    const efectivo = (p.pagos || []).filter(x => x.metodo === 'efectivo').reduce((s, x) => s + (Number(x.monto) || 0), 0);
    App.showModal(`
      <p>¿Por qué se elimina el pedido <strong>${esc(p.numero_pedido)}</strong> (${fmtMoneda(p.total)})?</p>
      <div class="cobro-chips" id="eliminarMotivos">
        ${this.MOTIVOS_ELIMINAR.map((m, i) => `<button type="button" class="btn btn-outline" data-i="${i}" onclick="Pedidos.elegirMotivo(${i})">${esc(m)}</button>`).join('')}
      </div>
      <input type="text" id="eliminarDetalle" maxlength="200" placeholder="Contá qué pasó" class="mt-10" style="display:none">
      ${cobrado > 0 ? `<p class="text-warning mt-10"><i class="fas fa-exclamation-triangle"></i> Ya se cobró ${fmtMoneda(cobrado)}: el cobro se quita de la caja y de las ventas${efectivo > 0 ? ` (en la caja tiene que haber ${fmtMoneda(efectivo)} menos de efectivo)` : ''}.
        Si hay que devolverle plata al cliente, hacelo aparte${cobrado > efectivo ? ' (tarjeta o transferencia: desde Mercado Pago)' : ''}.</p>` : ''}
      <p class="text-muted">El pedido queda en "Cancelados" con el motivo, y vuelve el stock.</p>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline" onclick="Pedidos.verDetalle(${id})">No, volver</button>
        <button type="button" class="btn btn-danger" id="eliminarBtn" disabled onclick="Pedidos.confirmarEliminar(${id})"><i class="fas fa-trash-alt"></i> Eliminar pedido</button>
      </div>`, { title: 'Eliminar pedido' });
  },

  elegirMotivo(i) {
    this._motivo = this.MOTIVOS_ELIMINAR[i];
    document.querySelectorAll('#eliminarMotivos button').forEach(b => {
      b.classList.toggle('btn-primary', Number(b.dataset.i) === i);
      b.classList.toggle('btn-outline', Number(b.dataset.i) !== i);
    });
    const d = document.getElementById('eliminarDetalle');
    d.style.display = this._motivo === 'Otro' ? '' : 'none';
    if (this._motivo === 'Otro') d.focus();
    document.getElementById('eliminarBtn').disabled = false;
  },

  async confirmarEliminar(id) {
    const detalle = document.getElementById('eliminarDetalle').value.trim();
    if (!this._motivo) return App.showToast('Elegí por qué se elimina', 'warning');
    if (this._motivo === 'Otro' && !detalle) return App.showToast('Escribí el motivo', 'warning');
    const btn = document.getElementById('eliminarBtn');
    btn.disabled = true;
    try {
      const r = await API.eliminarPedido(id, { motivo: this._motivo, detalle: this._motivo === 'Otro' ? detalle : '' });
      App.closeModal();
      App.showToast(`Pedido eliminado${r.cobrado > 0 ? ` · se quitaron ${fmtMoneda(r.cobrado)} de la caja` : ''}`, 'success', 7000);
      if (App.currentView === 'pedidos') this.render();
    } catch (err) {
      btn.disabled = false;
      App.showToast(err.message, 'error', 8000);
    }
  }
};