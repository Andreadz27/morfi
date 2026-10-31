// =============================================
// FADIDO - Reportes
// Ventas, rentabilidad y auditoría del sistema
// =============================================

const Reportes = {
  ventas: { pedidos: [], total: 0, cantidad: 0, resumen: null },
  rentabilidad: [],
  auditoria: [],
  tab: 'ventas',
  desde: '',
  hasta: '',
  metodo: '',
  // Transferencias que entraron a Mercado Pago en el período (se piden aparte: MP puede tardar)
  transferencias: null,

  METODOS: { efectivo: 'Efectivo', tarjeta: 'Tarjeta', mercadopago: 'Mercado Pago', modo: 'MODO', cuentadni: 'Cuenta DNI', transferencia: 'Transferencia', giftcard: 'Gift card', otro: 'Otro' },
  TIPOS: { salon: 'Salón', mostrador: 'Mostrador', takeaway: 'Para llevar', delivery: 'Delivery' },

  nombreMetodo(m) { return this.METODOS[m] || m; },
  nombreTipo(t) { return this.TIPOS[t] || t || '-'; },

  esAdmin() {
    return App.puede('admin');
  },

  async render() {
    const view = document.getElementById('view-reportes');
    view.innerHTML = '<div class="text-center mt-20"><i class="fas fa-spinner fa-spin fa-3x"></i></div>';
    try {
      if (this.tab === 'ventas') {
        // Por defecto, lo de hoy
        if (!this.desde && !this.hasta) this.desde = this.hasta = hoyLocal();
        this.ventas = await API.getReporteVentas(this.desde || null, this.hasta || null, this.metodo);
        this.transferencias = null;
      } else if (this.tab === 'rentabilidad') {
        this.rentabilidad = await API.getRentabilidad();
      } else if (this.tab === 'auditoria') {
        this.auditoria = await API.getAuditoria();
      }
      this.paint(view);
      if (this.tab === 'ventas') this.cargarTransferencias();
    } catch (err) {
      view.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error: ${esc(err.message)}</p></div>`;
    }
  },

  setTab(tab) {
    this.tab = tab;
    this.render();
  },

  filtrar() {
    this.desde = document.getElementById('repDesde') ? document.getElementById('repDesde').value : '';
    this.hasta = document.getElementById('repHasta') ? document.getElementById('repHasta').value : '';
    this.metodo = document.getElementById('repMetodo') ? document.getElementById('repMetodo').value : '';
    this.render();
  },

  filtrarMetodo(metodo) {
    this.metodo = this.metodo === metodo ? '' : metodo;
    this.render();
  },

  // Atajos de período: hoy, ayer, últimos 7 días, este mes, mes pasado
  periodo(cual) {
    const hoy = hoyLocal();
    const dia = (fecha, dias) => {
      const d = new Date(fecha + 'T12:00:00Z');
      d.setUTCDate(d.getUTCDate() + dias);
      return d.toISOString().slice(0, 10);
    };
    const inicioMes = hoy.slice(0, 8) + '01';
    if (cual === 'hoy') { this.desde = hoy; this.hasta = hoy; }
    else if (cual === 'ayer') { this.desde = this.hasta = dia(hoy, -1); }
    else if (cual === 'semana') { this.desde = dia(hoy, -6); this.hasta = hoy; }
    else if (cual === 'mes') { this.desde = inicioMes; this.hasta = hoy; }
    else if (cual === 'mes_pasado') { this.hasta = dia(inicioMes, -1); this.desde = this.hasta.slice(0, 8) + '01'; }
    this.render();
  },

  async cargarTransferencias() {
    const caja = document.getElementById('repTransferencias');
    if (!caja) return;
    try {
      this.transferencias = await API.getTransferenciasMp(this.desde || hoyLocal(), this.hasta || hoyLocal());
    } catch (err) {
      this.transferencias = { error: err.message };
    }
    // Si mientras tanto cambió el período o la pestaña, no se pinta
    const actual = document.getElementById('repTransferencias');
    if (actual) actual.outerHTML = this.htmlTransferencias();
  },

  // Transferencias y cobros del Point en un mismo contenedor: al llegar la respuesta se reemplazan juntos
  htmlTransferencias() {
    return `<div id="repTransferencias">${this._htmlTransferencias()}${this._htmlPoint()}</div>`;
  },

  _htmlTransferencias() {
    const t = this.transferencias;
    const tarjeta = cuerpo => `
      <div class="card mt-10">
        <div class="card-header">
          <span class="card-title"><i class="fas fa-university"></i> Transferencias recibidas en Mercado Pago</span>
          ${t && t.disponible && t.transferencias.length ? (() => {
            const sin = t.transferencias.filter(x => !x.pedido);
            const total = t.transferencias.reduce((s, x) => s + x.monto, 0);
            return `<span class="badge badge-blue">${t.transferencias.length} · ${fmtMoneda(total)}</span>
              ${sin.length ? `<span class="badge badge-red" title="Entraron a la cuenta pero no están asociadas a ninguna venta">${sin.length} sin asociar · ${fmtMoneda(sin.reduce((s, x) => s + x.monto, 0))}</span>` : ''}`;
          })() : ''}
        </div>
        ${cuerpo}
      </div>`;
    if (!t) return tarjeta('<p class="text-muted"><i class="fas fa-spinner fa-spin"></i> Consultando Mercado Pago…</p>');
    if (t.error) return tarjeta(`<p class="text-muted">${esc(t.error)}</p>`);
    if (!t.disponible) return tarjeta('<p class="text-muted">Conectá Mercado Pago en Integraciones para ver acá las transferencias que entran a la cuenta y cobrar solos los pedidos que avisan que transfirieron.</p>');
    if (!t.transferencias.length) return tarjeta('<p class="text-muted">No entraron transferencias en el período.</p>');
    const filas = t.transferencias.map(x => `
      <tr>
        <td>${fmtFechaHora(x.fecha)}</td>
        <td class="text-right font-bold">${fmtMoneda(x.monto)}</td>
        <td>${x.pedido ? `<span class="badge badge-green">Venta ${esc(x.pedido.numero_pedido)}</span>${x.pedido.a_mano ? ' <span class="text-muted" title="Cobrada a mano como Transferencia; asociada por monto y hora">(cobrada a mano)</span>' : ''}` : '<span class="badge badge-red">Sin asociar</span>'}</td>
        <td class="text-muted">MP-${esc(x.id)}</td>
      </tr>`).join('');
    return tarjeta(`
      <p class="text-muted">Todo lo que entró a la cuenta por transferencia (al alias o al CVU). <strong>Sin asociar</strong> = la plata entró pero
        no hay ninguna venta cobrada como "Transferencia" por ese monto: puede ser una venta cobrada con otro medio o algo que no es del local.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Fecha</th><th class="text-right">Monto</th><th>Registrada en</th><th>Operación</th></tr></thead>
        <tbody>${filas}</tbody>
      </table></div>`);
  },

  // Cobros con tarjeta en el Point de Mercado Pago: lo mismo que el resumen del Point, con descuentos, neto y la venta
  _htmlPoint() {
    const t = this.transferencias;
    const lista = (t && t.disponible && t.point) || [];
    if (!lista.length) return '';
    const sumar = (filas, campo) => filas.reduce((s, x) => s + (Number(x[campo]) || 0), 0);
    const sin = lista.filter(x => !x.pedido);
    const marcas = { visa: 'Visa', debvisa: 'Visa débito', master: 'Mastercard', debmaster: 'Mastercard débito', maestro: 'Maestro',
      amex: 'American Express', cabal: 'Cabal', debcabal: 'Cabal débito', naranja: 'Naranja', argencard: 'Argencard', cencosud: 'Cencosud' };
    const filas = lista.map(x => `
      <tr>
        <td>${fmtFechaHora(x.fecha)}</td>
        <td>${esc(marcas[x.medio] || x.medio || 'Tarjeta')}${x.ultimos ? ` ··${esc(x.ultimos)}` : ''}${x.cuotas > 1 ? ` · ${x.cuotas} cuotas` : ''}</td>
        <td class="text-right font-bold">${fmtMoneda(x.monto)}</td>
        <td class="text-right text-muted">${fmtMoneda(x.comision + x.retenciones)}</td>
        <td class="text-right">${fmtMoneda(x.neto)}</td>
        <td>${x.pedido ? `<span class="badge badge-green">Venta ${esc(x.pedido.numero_pedido)}</span>${x.pedido.a_mano ? ' <span class="text-muted" title="Cobrada como Tarjeta; asociada por monto y hora">(por monto y hora)</span>' : ''}` : '<span class="badge badge-red">Sin asociar</span>'}${x.devuelto ? ` <span class="badge badge-orange">Devuelto ${fmtMoneda(x.devuelto)}</span>` : ''}</td>
        <td class="text-muted">MP-${esc(x.id)}</td>
      </tr>`).join('');
    return `
      <div class="card mt-10">
        <div class="card-header">
          <span class="card-title"><i class="fas fa-credit-card"></i> Cobros con tarjeta en el Point</span>
          <span class="badge badge-blue">${lista.length} · ${fmtMoneda(sumar(lista, 'monto'))}</span>
          ${sin.length ? `<span class="badge badge-red" title="Se cobraron en el Point pero no están en ninguna venta">${sin.length} sin asociar · ${fmtMoneda(sumar(sin, 'monto'))}</span>` : ''}
        </div>
        <p class="text-muted">Lo mismo que el resumen del Point. <strong>Descuentos</strong> = comisión de Mercado Pago (${fmtMoneda(sumar(lista, 'comision'))})
          más retenciones de impuestos (${fmtMoneda(sumar(lista, 'retenciones'))}). <strong>Neto</strong> = lo que queda en la cuenta (${fmtMoneda(sumar(lista, 'neto'))}).
          <strong>Sin asociar</strong> = se cobró con el Point pero no hay ninguna venta cobrada como "Tarjeta" por ese monto.</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Fecha</th><th>Tarjeta</th><th class="text-right">Bruto</th><th class="text-right">Descuentos</th><th class="text-right">Neto</th><th>Registrado en</th><th>Operación</th></tr></thead>
          <tbody>${filas}</tbody>
        </table></div>
      </div>`;
  },

  // Productos y cobros de una venta, en texto corto
  _textoItems(p) {
    return (p.items || []).map(i => {
      const extra = this._textoOpciones(i.opciones).filter(o => !i.nombre_producto.includes(o));
      return `${Number(i.cantidad)}× ${i.nombre_producto}${extra.length ? ` (${extra.join(', ')})` : ''}${i.notas ? ` - ${i.notas}` : ''}`;
    });
  },
  // Las opciones se guardan como JSON ([{grupo, nombre, precio}]); el nombre del producto ya suele traerlas ("Flat white · Entera")
  _textoOpciones(opciones) {
    if (!opciones) return [];
    try {
      const lista = JSON.parse(opciones);
      return Array.isArray(lista) ? lista.map(o => (o && o.nombre) || '').filter(Boolean) : [];
    } catch (e) {
      return [String(opciones)];
    }
  },
  _textoPagos(p) {
    return (p.pagos || []).map(pg => `${this.nombreMetodo(pg.metodo)} ${fmtMoneda(pg.monto)}`);
  },

  paint(view) {
    const esAdmin = this.esAdmin();

    const tabs = `
      <div class="filter-bar mb-20">
        <button class="btn ${this.tab === 'ventas' ? 'btn-primary' : 'btn-outline'}" onclick="Reportes.setTab('ventas')">
          <i class="fas fa-file-invoice-dollar"></i> Ventas
        </button>
        ${App.puede('reportes.costos') ? `
        <button class="btn ${this.tab === 'rentabilidad' ? 'btn-primary' : 'btn-outline'}" onclick="Reportes.setTab('rentabilidad')">
          <i class="fas fa-chart-pie"></i> Rentabilidad
        </button>` : ''}
        ${esAdmin ? `
        <button class="btn ${this.tab === 'auditoria' ? 'btn-primary' : 'btn-outline'}" onclick="Reportes.setTab('auditoria')">
          <i class="fas fa-clipboard-list"></i> Auditoría
        </button>
        ` : ''}
      </div>
    `;

    let content = '';

    if (this.tab === 'ventas') {
      const r = this.ventas.resumen || { por_metodo: [], por_tipo: [], por_usuario: [], productos: [], cancelados: { cantidad: 0, total: 0 } };
      const rows = this.ventas.pedidos.map(p => `
        <tr>
          <td class="font-bold">${esc(p.numero_pedido)}</td>
          <td>${fmtFechaHora(p.cerrado_en || p.creado_en)}</td>
          <td>${esc(this.nombreTipo(p.tipo))}${p.mesa_nombre ? `<br><span class="text-muted">${esc(p.mesa_nombre)}</span>` : ''}${p.lugar && !p.mesa_nombre ? `<br><span class="text-muted">${esc(p.lugar)}</span>` : ''}</td>
          <td>${esc(p.usuario_nombre || (p.origen ? 'Online / QR' : '-'))}${p.cliente ? `<br><span class="text-muted">${esc(p.cliente)}</span>` : ''}</td>
          <td>${this._textoItems(p).map(esc).join('<br>') || '-'}</td>
          <td>${this._textoPagos(p).map(esc).join('<br>') || '-'}</td>
          <td class="text-right">${Number(p.descuento) || Number(p.descuento_puntos) || Number(p.descuento_cupon) ? `<span class="text-muted">Desc. −${fmtMoneda((Number(p.descuento) || 0) + (Number(p.descuento_puntos) || 0) + (Number(p.descuento_cupon) || 0))}</span><br>` : ''}${Number(p.propina) ? `<span class="text-muted">Propina ${fmtMoneda(p.propina)}</span><br>` : ''}<span class="font-bold">${fmtMoneda(p.total)}</span></td>
        </tr>
      `).join('');

      const tablaResumen = (titulo, icono, cabecera, filas, vacio) => `
        <div class="cierre-bloque"><h4><i class="fas ${icono}"></i> ${titulo}</h4>
          ${filas ? `<table class="cierre-detalle"><thead><tr>${cabecera}</tr></thead><tbody>${filas}</tbody></table>` : `<p class="text-muted">${vacio}</p>`}</div>`;
      const filasMetodo = r.por_metodo.map(m => `
        <tr style="cursor:pointer" onclick="Reportes.filtrarMetodo('${esc(m.metodo)}')" title="Ver solo las ventas cobradas con ${esc(this.nombreMetodo(m.metodo))}">
          <td>${this.metodo === m.metodo ? '<i class="fas fa-filter"></i> ' : ''}${esc(this.nombreMetodo(m.metodo))}</td>
          <td class="text-right">${m.cantidad}</td><td class="text-right font-bold">${fmtMoneda(m.total)}</td><td class="text-right">${m.porcentaje}%</td>
        </tr>`).join('') + (r.por_metodo.length ? `<tr><td><strong>Total cobrado</strong></td><td></td><td class="text-right"><strong>${fmtMoneda(r.cobrado)}</strong></td><td></td></tr>` : '');
      const filasTipo = r.por_tipo.map(t => `<tr><td>${esc(this.nombreTipo(t.tipo))}</td><td class="text-right">${t.cantidad}</td><td class="text-right">${fmtMoneda(t.total)}</td></tr>`).join('');
      const filasUsuario = r.por_usuario.map(u => `<tr><td>${esc(u.nombre)}</td><td class="text-right">${u.cantidad}</td><td class="text-right">${fmtMoneda(u.total)}</td></tr>`).join('');
      const filasProductos = r.productos.map(x => `<tr><td>${esc(x.nombre_producto)}</td><td class="text-right">${Number(x.cantidad)}</td><td class="text-right">${fmtMoneda(x.total)}</td></tr>`).join('');
      const opcionesMetodo = Object.entries(this.METODOS).map(([k, v]) => `<option value="${k}" ${this.metodo === k ? 'selected' : ''}>${v}</option>`).join('');

      content = `
        <div class="card mb-20">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-calendar-alt"></i> Período y medio de pago</span>
          </div>
          <div class="filter-bar mb-10">
            <button class="btn btn-outline btn-sm" onclick="Reportes.periodo('hoy')">Hoy</button>
            <button class="btn btn-outline btn-sm" onclick="Reportes.periodo('ayer')">Ayer</button>
            <button class="btn btn-outline btn-sm" onclick="Reportes.periodo('semana')">Últimos 7 días</button>
            <button class="btn btn-outline btn-sm" onclick="Reportes.periodo('mes')">Este mes</button>
            <button class="btn btn-outline btn-sm" onclick="Reportes.periodo('mes_pasado')">Mes pasado</button>
          </div>
          <div class="grid grid-3">
            <div class="form-group">
              <label>Desde</label>
              <input type="date" id="repDesde" value="${this.desde}" onchange="Reportes.filtrar()">
            </div>
            <div class="form-group">
              <label>Hasta</label>
              <input type="date" id="repHasta" value="${this.hasta}" onchange="Reportes.filtrar()">
            </div>
            <div class="form-group">
              <label>Medio de pago</label>
              <select id="repMetodo" onchange="Reportes.filtrar()"><option value="">Todos</option>${opcionesMetodo}</select>
            </div>
          </div>
        </div>

        <div class="grid grid-4 mb-20">
          <div class="stat-card"><div class="stat-icon green"><i class="fas fa-dollar-sign"></i></div>
            <div class="stat-info"><h3>${fmtMoneda(this.ventas.total)}</h3><span>Total vendido${this.metodo ? ` (ventas con ${esc(this.nombreMetodo(this.metodo))})` : ''}</span></div></div>
          <div class="stat-card"><div class="stat-icon blue"><i class="fas fa-receipt"></i></div>
            <div class="stat-info"><h3>${this.ventas.cantidad}</h3><span>Ventas · promedio ${fmtMoneda(r.ticket_promedio || 0)}</span></div></div>
          <div class="stat-card"><div class="stat-icon purple"><i class="fas fa-hand-holding-usd"></i></div>
            <div class="stat-info"><h3>${fmtMoneda(r.propinas || 0)}</h3><span>Propinas (del personal)${(this.ventas.pedidos || []).some(p => Number(p.propina) > 0) ? ` · en ${(this.ventas.pedidos || []).filter(p => Number(p.propina) > 0).length} ventas` : ''}</span></div></div>
          <div class="stat-card"><div class="stat-icon orange"><i class="fas fa-tags"></i></div>
            <div class="stat-info"><h3>${fmtMoneda(r.descuentos || 0)}</h3><span>Descuentos${r.cancelados.cantidad ? ` · ${r.cancelados.cantidad} cancelados` : ''}</span></div></div>
        </div>

        <div class="grid grid-2 mb-20">
          ${tablaResumen('Por medio de pago', 'fa-credit-card', '<th>Medio</th><th class="text-right">Cobros</th><th class="text-right">Total</th><th class="text-right">%</th>', filasMetodo, 'Sin cobros en el período')}
          ${tablaResumen('Por tipo de pedido', 'fa-store', '<th>Tipo</th><th class="text-right">Ventas</th><th class="text-right">Total</th>', filasTipo, 'Sin ventas')}
          ${tablaResumen('Por persona', 'fa-user', '<th>Atendió</th><th class="text-right">Ventas</th><th class="text-right">Total</th>', filasUsuario, 'Sin ventas')}
          ${tablaResumen('Productos vendidos', 'fa-utensils', '<th>Producto</th><th class="text-right">Cant.</th><th class="text-right">Total</th>', filasProductos, 'Sin ventas')}
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-file-invoice-dollar"></i> Detalle de ventas${this.metodo ? ` cobradas con ${esc(this.nombreMetodo(this.metodo))} <button class="btn btn-outline btn-sm" onclick="Reportes.filtrarMetodo('${esc(this.metodo)}')">Ver todas</button>` : ''}</span>
            <span class="badge badge-blue">${this.ventas.cantidad} ventas · ${fmtMoneda(this.ventas.total)}</span>
          </div>
          ${
            this.ventas.pedidos.length > 0 ? `
            <div class="table-wrap">
              <table class="cierre-detalle">
                <thead><tr><th>N°</th><th>Fecha</th><th>Tipo / mesa</th><th>Atendió / cliente</th><th>Productos</th><th>Cobro</th><th class="text-right">Total</th></tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
            ` : `<div class="empty-state"><i class="fas fa-receipt"></i><p>Sin ventas en el período</p></div>`
          }
        </div>
        ${this.htmlTransferencias()}
      `;
    } else if (this.tab === 'rentabilidad') {
const rows = this.rentabilidad.map(r => `
        <tr>
          <td class="font-bold">${esc(r.nombre)}</td>
          <td>${fmtMoneda(r.precio_venta)}</td>
          <td>${fmtMoneda(r.costo)}</td>
          <td class="text-success font-bold">${fmtMoneda(r.ganancia)}</td>
          <td>${Number(r.vendidos || 0)}</td>
          <td>
            <span class="badge ${r.margen >= 50 ? 'badge-green' : (r.margen >= 30 ? 'badge-orange' : 'badge-red')}">
              ${Number(r.margen || 0).toFixed(1)}%
            </span>
          </td>
        </tr>
      `).join('');

      content = `
        <div class="card">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-chart-pie"></i> Rentabilidad por producto</span>
          </div>
          ${
            this.rentabilidad.length > 0 ? `
            <div class="table-wrap">
              <table>
                <thead><tr><th>Producto</th><th>Venta</th><th>Costo</th><th>Ganancia</th><th>Vendidos</th><th>Margen</th></tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
            ` : `<div class="empty-state"><i class="fas fa-chart-pie"></i><p>Sin datos de rentabilidad</p></div>`
          }
        </div>
      `;
    } else if (this.tab === 'auditoria') {
      const rows = this.auditoria.map(a => `
        <tr>
          <td>${fmtFechaHora(a.fecha)}</td>
          <td class="font-bold">${esc(a.usuario_nombre || '-')}</td>
          <td><span class="badge badge-gray">${esc(a.accion)}</span></td>
          <td>${esc(a.detalle || '-')}</td>
        </tr>
      `).join('');

      content = `
        <div class="card">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-clipboard-list"></i> Registro de auditoría</span>
          </div>
          ${
            this.auditoria.length > 0 ? `
            <div class="table-wrap">
              <table>
                <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Detalle</th></tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
            ` : `<div class="empty-state"><i class="fas fa-clipboard-list"></i><p>Sin registros</p></div>`
          }
        </div>
      `;
    }

    view.innerHTML = `
      <div class="page-header">
        <div>
          <h2><i class="fas fa-file-alt"></i> Reportes</h2>
          <p>Ventas, rentabilidad y auditoría</p>
        </div>
        <div>
          ${
            this.tab === 'ventas' ? `
              <button class="btn btn-outline" onclick="Reportes.exportarCSV()"><i class="fas fa-file-csv"></i> CSV</button>
              <button class="btn btn-outline" onclick="Reportes.exportarExcel()"><i class="fas fa-file-excel"></i> Excel</button>
              <button class="btn btn-outline" onclick="Reportes.exportarPDF()"><i class="fas fa-file-pdf"></i> PDF</button>
            ` : ''
          }
          <button class="btn btn-outline" onclick="Reportes.render()"><i class="fas fa-sync-alt"></i> Refrescar</button>
        </div>
      </div>
      ${tabs}
      ${content}
    `;
  },

  // ===== Exportación =====

  // Una fila por venta, con sus productos, y una columna por cada medio de pago usado en el período
  _lineasVentas() {
    const metodos = [...new Set(this.ventas.pedidos.flatMap(p => (p.pagos || []).map(pg => pg.metodo)))];
    return this.ventas.pedidos.map(p => {
      const fila = {
        'Numero': p.numero_pedido,
        'Fecha': fmtFechaHora(p.cerrado_en || p.creado_en),
        'Tipo': this.nombreTipo(p.tipo),
        'Mesa': p.mesa_nombre || p.lugar || '',
        'Atendio': p.usuario_nombre || (p.origen ? 'Online / QR' : ''),
        'Cliente': p.cliente || '',
        'Productos': this._textoItems(p).join(' | '),
        'Subtotal': p.subtotal,
        'Descuento': centavosJS((Number(p.descuento) || 0) + (Number(p.descuento_puntos) || 0) + (Number(p.descuento_cupon) || 0)),
        'Propina': Number(p.propina) || 0,
        'Total': p.total
      };
      for (const m of metodos) fila[this.nombreMetodo(m)] = centavosJS((p.pagos || []).filter(pg => pg.metodo === m).reduce((s, pg) => s + pg.monto, 0));
      fila['Referencias de pago'] = (p.pagos || []).map(pg => pg.referencia).filter(Boolean).join(' | ');
      return fila;
    });
  },

  _nombreArchivo() {
    const periodo = this.desde === this.hasta ? (this.desde || hoyLocal()) : `${this.desde || 'inicio'}_a_${this.hasta || hoyLocal()}`;
    return `reporte-ventas-${periodo}${this.metodo ? '-' + this.metodo : ''}.csv`;
  },

  _descargarContenido(contenido, nombreArchivo, mime) {
    const blob = new Blob([contenido], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombreArchivo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  _normalizarCSV(valor) {
    const s = (valor === null || valor === undefined) ? '' : String(valor);
    if (/[",;\n]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  },

  exportarCSV() {
    if (!this.ventas || this.ventas.pedidos.length === 0) {
      App.showToast('No hay datos para exportar', 'warning');
      return;
    }
    const filas = this._lineasVentas();
    const cabecera = Object.keys(filas[0]);
    const contenido = [cabecera.join(',')]
      .concat(filas.map(f => cabecera.map(c => this._normalizarCSV(f[c])).join(',')))
      .join('\n');
    this._descargarContenido(contenido, this._nombreArchivo(), 'text/csv;charset=utf-8;');
    App.showToast('Reporte CSV exportado', 'success');
  },

  exportarExcel() {
    if (!this.ventas || this.ventas.pedidos.length === 0) {
      App.showToast('No hay datos para exportar', 'warning');
      return;
    }
    // CSV con separador de punto y coma, coma decimal y BOM UTF-8 para abrir correctamente en Excel en español
    const filas = this._lineasVentas();
    const cabecera = Object.keys(filas[0]);
    const celda = v => typeof v === 'number' ? String(v).replace('.', ',') : this._normalizarCSV(v);
    const contenido = '﻿' + [cabecera.join(';')]
      .concat(filas.map(f => cabecera.map(c => celda(f[c])).join(';')))
      .join('\n');
    this._descargarContenido(contenido, this._nombreArchivo(), 'text/csv;charset=utf-8;');
    App.showToast('Reporte Excel exportado', 'success');
  },

  exportarPDF() {
    if (!this.ventas || this.ventas.pedidos.length === 0) {
      App.showToast('No hay datos para exportar', 'warning');
      return;
    }
    const r = this.ventas.resumen;
    const filas = this.ventas.pedidos.map(p => `
      <tr>
        <td>${esc(p.numero_pedido)}</td>
        <td>${fmtFechaHora(p.cerrado_en || p.creado_en)}</td>
        <td>${esc(this.nombreTipo(p.tipo))}${p.mesa_nombre ? ' · ' + esc(p.mesa_nombre) : ''}</td>
        <td>${esc(p.usuario_nombre || (p.origen ? 'Online / QR' : '-'))}${p.cliente ? '<br>' + esc(p.cliente) : ''}</td>
        <td>${this._textoItems(p).map(esc).join('<br>')}</td>
        <td>${this._textoPagos(p).map(esc).join('<br>')}</td>
        <td style="text-align:right">${Number(p.propina) ? 'Propina ' + fmtMoneda(p.propina) + '<br>' : ''}<strong>${fmtMoneda(p.total)}</strong></td>
      </tr>
    `).join('');
    const resumen = (titulo, filas) => filas ? `<div class="bloque"><h3>${titulo}</h3><table><tbody>${filas}</tbody></table></div>` : '';
    const fila3 = (a, b, c) => `<tr><td>${a}</td><td style="text-align:right">${b}</td><td style="text-align:right">${c}</td></tr>`;
    const negocio = (App && App.nombreNegocio) ? App.nombreNegocio : 'Fadido';
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) { App.showToast('Habilita las ventanas emergentes', 'warning'); return; }
    win.document.write(`
      <!DOCTYPE html><html><head><meta charset="UTF-8"><title>Reporte de ventas</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 30px; color:#222; }
        h1 { margin: 0; font-size: 20px; }
        h2 { font-size: 14px; color:#555; font-weight: normal; margin-top: 4px; }
        h3 { font-size: 13px; margin: 0 0 6px; }
        .resumen { margin: 20px 0; padding: 12px; background:#f5f5f5; border-radius: 6px; }
        .bloques { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 20px; }
        .bloque table { margin-top: 0; }
        table { width:100%; border-collapse: collapse; margin-top: 15px; }
        th, td { border: 1px solid #ccc; padding: 6px; font-size: 11px; vertical-align: top; }
        th { background:#eee; text-align:left; }
      </style></head><body>
      <h1>${esc(negocio)} - Reporte de Ventas</h1>
      <h2>Período: ${fmtFecha(this.desde) || 'Inicio'} a ${fmtFecha(this.hasta) || 'Hoy'}${this.metodo ? ` · solo ventas cobradas con ${esc(this.nombreMetodo(this.metodo))}` : ''} · ${this.ventas.cantidad} ventas · Total ${fmtMoneda(this.ventas.total)}</h2>
      <div class="resumen"><strong>Total del período:</strong> ${fmtMoneda(this.ventas.total)} · Ticket promedio ${fmtMoneda(r.ticket_promedio)} ·
        Propinas ${fmtMoneda(r.propinas)} · Descuentos ${fmtMoneda(r.descuentos)}${r.cancelados.cantidad ? ` · ${r.cancelados.cantidad} pedidos cancelados (${fmtMoneda(r.cancelados.total)})` : ''}</div>
      <div class="bloques">
        ${resumen('Por medio de pago', r.por_metodo.map(m => `<tr><td>${esc(this.nombreMetodo(m.metodo))} (${m.cantidad})</td><td style="text-align:right">${fmtMoneda(m.total)}</td><td style="text-align:right">${m.porcentaje}%</td></tr>`).join(''))}
        ${resumen('Por tipo de pedido', r.por_tipo.map(t => fila3(esc(this.nombreTipo(t.tipo)), t.cantidad, fmtMoneda(t.total))).join(''))}
        ${resumen('Por persona', r.por_usuario.map(u => fila3(esc(u.nombre), u.cantidad, fmtMoneda(u.total))).join(''))}
        ${resumen('Productos vendidos', r.productos.map(x => fila3(esc(x.nombre_producto), Number(x.cantidad), fmtMoneda(x.total))).join(''))}
      </div>
      <table>
        <thead><tr><th>N°</th><th>Fecha</th><th>Tipo / mesa</th><th>Atendió / cliente</th><th>Productos</th><th>Cobro</th><th style="text-align:right">Total</th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
      <script>window.onload = function(){ window.print(); };<\/script>
      </body></html>`);
    win.document.close();
    win.focus();
  }
};

// Redondeo a centavos para las columnas de la exportación
function centavosJS(n) { return Math.round((Number(n) || 0) * 100) / 100; }
