// =============================================
// FADIDO - Stock / Inventario
// Movimientos de stock y niveles
// =============================================

const Stock = {
  stock: [],
  movimientos: [],

  async render() {
    const view = document.getElementById('view-stock');
    view.innerHTML = '<div class="text-center mt-20"><i class="fas fa-spinner fa-spin fa-3x"></i></div>';
    try {
      const [stock, movimientos, conteos] = await Promise.all([API.getStock(), API.getMovimientosStock(), API.getConteos()]);
      this.stock = stock;
      this.movimientos = movimientos;
      this.conteos = conteos;
      this.paint(view);
    } catch (err) {
      view.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error: ${esc(err.message)}</p></div>`;
    }
  },

  nivelBadge(nivel) {
    if (nivel === 'bajo') return '<span class="badge badge-red">Bajo</span>';
    if (nivel === 'medio') return '<span class="badge badge-orange">Medio</span>';
    return '<span class="badge badge-green">OK</span>';
  },

  paint(view) {
    const rows = this.stock.map(p => `
      <tr>
        <td>${esc(p.nombre)}</td>
        <td>${esc(p.categoria_nombre || '-')}</td>
        <td class="font-bold">${p.stock_actual} ${esc(p.unidad || '')}</td>
        <td>${p.stock_minimo} ${esc(p.unidad || '')}</td>
        <td>${this.nivelBadge(p.nivel)}</td>
        <td>${App.puede('stock.mover') ? `
          <button class="btn btn-success btn-sm" onclick="Stock.movimiento(${p.id}, 'entrada')">
            <i class="fas fa-arrow-up"></i> Entrada
          </button>
          <button class="btn btn-warning btn-sm" onclick="Stock.movimiento(${p.id}, 'salida')">
            <i class="fas fa-arrow-down"></i> Salida
          </button>` : ''}
        </td>
      </tr>
    `).join('');

    view.innerHTML = `
      <div class="page-header">
        <div>
          <h2><i class="fas fa-boxes"></i> Inventario</h2>
          <p>Control de stock y movimientos</p>
        </div>
        ${App.puede('stock.mover') ? `<div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn btn-success" onclick="Stock.contar()" ${this.stock.length ? '' : 'disabled'}>
            <i class="fas fa-clipboard-check"></i> Contar inventario
          </button>
          <button class="btn btn-primary" onclick="Stock.movimiento()">
            <i class="fas fa-exchange-alt"></i> Registrar movimiento
          </button>
        </div>` : ''}
      </div>

      <div class="card mb-20">
        <div class="card-header">
          <span class="card-title"><i class="fas fa-box"></i> Niveles de stock</span>
        </div>
        ${
          this.stock.length > 0 ? `
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>Producto</th><th>Categor\u00eda</th><th>Stock actual</th><th>M\u00ednimo</th><th>Nivel</th><th>Movimientos</th></tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          ` : `<div class="empty-state"><i class="fas fa-box-open"></i><p>Sin productos con control de stock</p></div>`
        }
      </div>
    `;

    const movRows = this.movimientos.map(m => `
      <tr>
        <td>${fmtFechaHora(m.fecha)}</td>
        <td>${esc(m.producto_nombre)}</td>
        <td>${m.tipo === 'entrada' ? '<span class="text-success font-bold">Entrada</span>' : '<span class="text-danger font-bold">Salida</span>'}</td>
        <td class="font-bold">${m.cantidad > 0 ? '+' : ''}${m.cantidad}</td>
        <td>${esc(m.motivo || '-')}</td>
        <td>${esc(m.usuario_nombre || '-')}</td>
      </tr>
    `).join('');

    const conteoRows = (this.conteos || []).map(c => `
      <tr>
        <td>${fmtFechaHora(c.fecha)}</td>
        <td>${c.productos}</td>
        <td>${c.con_diferencia}</td>
        <td class="font-bold ${c.valor_diferencia < 0 ? 'text-danger' : c.valor_diferencia > 0 ? 'text-success' : ''}">${fmtMoneda(c.valor_diferencia)}</td>
        <td>${esc(c.notas || '-')}</td>
        <td>${esc(c.usuario_nombre || '-')}</td>
        <td><button class="btn btn-outline btn-sm" onclick="Stock.verConteo(${c.id})"><i class="fas fa-eye"></i> Ver</button></td>
      </tr>`).join('');
    if (conteoRows) view.innerHTML += `
      <div class="card mb-20">
        <div class="card-header">
          <span class="card-title"><i class="fas fa-clipboard-check"></i> Conteos de inventario</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Fecha</th><th>Productos</th><th>Con diferencia</th><th>Diferencia en plata</th><th>Notas</th><th>Usuario</th><th></th></tr></thead>
            <tbody>${conteoRows}</tbody>
          </table>
        </div>
      </div>`;

    view.innerHTML += `
      <div class="card">
        <div class="card-header">
          <span class="card-title"><i class="fas fa-history"></i> \u00daltimos movimientos</span>
        </div>
        ${
          this.movimientos.length > 0 ? `
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>Fecha</th><th>Producto</th><th>Tipo</th><th>Cantidad</th><th>Motivo</th><th>Usuario</th></tr>
              </thead>
              <tbody>${movRows}</tbody>
            </table>
          </div>
          ` : `<div class="empty-state"><i class="fas fa-history"></i><p>Sin movimientos registrados</p></div>`
        }
      </div>
    `;
  },

  // ===== Conteo de inventario =====
  // Se anota lo que hay; lo que quede vacío no se cuenta (no se toca). La diferencia con el sistema se ve al escribir.
  contar() {
    const filas = this.stock.map(p => `
      <tr>
        <td>${esc(p.nombre)}</td>
        <td class="text-right">${p.stock_actual} ${esc(p.unidad || '')}</td>
        <td><input type="number" class="conteo-input" data-id="${p.id}" data-sistema="${p.stock_actual}" min="0" step="any"
          placeholder="Sin contar" oninput="Stock.verDiferencia(this)" style="max-width:130px"> ${esc(p.unidad || '')}</td>
        <td class="text-right" id="conteoDif${p.id}">-</td>
      </tr>`).join('');
    App.showModal(`
      <form onsubmit="Stock.guardarConteo(event)">
        <p class="text-muted mb-10">Anotá cuánto hay de cada producto. Lo que dejes vacío no se cuenta. Al guardar, el stock pasa a ser lo contado y la diferencia queda registrada.</p>
        <div class="table-wrap" style="max-height:55vh;overflow:auto">
          <table>
            <thead><tr><th>Producto</th><th class="text-right">Sistema</th><th>Contado</th><th class="text-right">Diferencia</th></tr></thead>
            <tbody>${filas}</tbody>
          </table>
        </div>
        <div class="form-group mt-10">
          <label>Notas</label>
          <input type="text" id="conteoNotas" maxlength="300" placeholder="Ej: conteo del domingo a la noche">
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-danger" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-success">Guardar conteo</button>
        </div>
      </form>
    `, { title: 'Contar inventario', large: true, fijo: true });
  },

  verDiferencia(input) {
    const celda = document.getElementById('conteoDif' + input.dataset.id);
    if (input.value === '') { celda.textContent = '-'; celda.className = 'text-right'; return; }
    const dif = Math.round((Number(input.value) - Number(input.dataset.sistema)) * 10000) / 10000;
    celda.textContent = (dif > 0 ? '+' : '') + dif;
    celda.className = 'text-right font-bold ' + (dif < 0 ? 'text-danger' : dif > 0 ? 'text-success' : '');
  },

  guardarConteo(e) {
    e.preventDefault();
    return App.sinDobleEnvio('stock.conteo', () => this._guardarConteo());
  },

  async _guardarConteo() {
    const items = [...document.querySelectorAll('.conteo-input')]
      .filter(i => i.value !== '')
      .map(i => ({ producto_id: Number(i.dataset.id), contado: Number(i.value) }));
    if (!items.length) return App.showToast('Anotá lo contado de al menos un producto', 'warning');
    try {
      const r = await API.registrarConteo({ items, notas: document.getElementById('conteoNotas').value });
      App.closeModal();
      App.showToast(r.con_diferencia
        ? `Conteo guardado: ${r.con_diferencia} con diferencia (${fmtMoneda(r.valor_diferencia)})`
        : 'Conteo guardado: todo coincide', 'success');
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  async verConteo(id) {
    try {
      const c = await API.getConteo(id);
      const filas = c.items.map(i => `
        <tr>
          <td>${esc(i.nombre)}</td>
          <td class="text-right">${i.sistema} ${esc(i.unidad || '')}</td>
          <td class="text-right">${i.contado} ${esc(i.unidad || '')}</td>
          <td class="text-right font-bold ${i.diferencia < 0 ? 'text-danger' : i.diferencia > 0 ? 'text-success' : ''}">${i.diferencia > 0 ? '+' : ''}${i.diferencia}</td>
          <td class="text-right">${fmtMoneda(i.valor)}</td>
        </tr>`).join('');
      App.showModal(`
        <p class="mb-10">${fmtFechaHora(c.fecha)} · ${esc(c.usuario_nombre || '-')}${c.notas ? ' · ' + esc(c.notas) : ''}</p>
        <p class="mb-10">Diferencia total: <strong class="${c.valor_diferencia < 0 ? 'text-danger' : ''}">${fmtMoneda(c.valor_diferencia)}</strong>
          <small class="text-muted">(valorizada al costo de ese día)</small></p>
        <div class="table-wrap" style="max-height:60vh;overflow:auto">
          <table>
            <thead><tr><th>Producto</th><th class="text-right">Sistema</th><th class="text-right">Contado</th><th class="text-right">Diferencia</th><th class="text-right">En plata</th></tr></thead>
            <tbody>${filas}</tbody>
          </table>
        </div>
      `, { title: `Conteo #${c.id}`, large: true });
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  movimiento(productoId = null, tipoFijo = null) {
    API.getProductos().then(productos => {
      const conStock = productos.filter(p => p.tracking_stock);
      const options = conStock.map(p =>
        `<option value="${p.id}" ${p.id === productoId ? 'selected' : ''}>${esc(p.nombre)} (stock: ${p.stock_actual})</option>`
      ).join('');
      App.showModal(`
        <form onsubmit="Stock.guardarMovimiento(event)">
          <div class="form-group">
            <label>Producto</label>
            <select id="movProducto">${options || '<option value="">Sin productos con stock</option>'}</select>
          </div>
          <div class="form-group">
            <label>Tipo</label>
            <select id="movTipo">
              <option value="entrada" ${tipoFijo === 'entrada' ? 'selected' : ''}>Entrada</option>
              <option value="salida" ${tipoFijo === 'salida' ? 'selected' : ''}>Salida</option>
            </select>
          </div>
          <div class="form-group">
            <label>Cantidad</label>
            <input type="number" id="movCantidad" min="0.0001" step="any" value="1" required>
          </div>
          <div class="form-group">
            <label>Motivo</label>
            <input type="text" id="movMotivo" placeholder="Ej: compra a proveedor, ajuste, merma">
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-danger" onclick="App.closeModal()">Cancelar</button>
            <button type="submit" class="btn btn-success">Registrar</button>
          </div>
        </form>
      `, { title: 'Registrar movimiento de stock' });
    }).catch(err => App.showToast(err.message, 'error'));
  },

  guardarMovimiento(e) {
    e.preventDefault();
    return App.sinDobleEnvio('stock.movimiento', () => this._guardarMovimiento(e));
  },

  async _guardarMovimiento(e) {
    e.preventDefault();
    const data = {
      producto_id: parseInt(document.getElementById('movProducto').value),
      tipo: document.getElementById('movTipo').value,
      cantidad: Number(document.getElementById('movCantidad').value),
      motivo: document.getElementById('movMotivo').value
    };
    try {
      await API.registrarMovimientoStock(data);
      App.closeModal();
      App.showToast('Movimiento registrado', 'success');
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  }
};