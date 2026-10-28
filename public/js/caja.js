// =============================================
// FADIDO - Caja
// Apertura, cierre y arqueo de caja
// =============================================

const Caja = {
  estado: null,
  historial: [],
  cierres: [],
  cierreConfig: null,

  METODOS: { efectivo: 'Efectivo', tarjeta: 'Tarjeta', mercadopago: 'Mercado Pago', modo: 'MODO', cuentadni: 'Cuenta DNI', transferencia: 'Transferencia', otro: 'Otro' },

  async render() {
    const view = document.getElementById('view-caja');
    view.innerHTML = '<div class="text-center mt-20"><i class="fas fa-spinner fa-spin fa-3x"></i></div>';
    try {
      const admin = this.esAdmin();
      const [estado, historial, cierres, cierreConfig] = await Promise.all([
        API.getCajaEstado(),
        admin ? API.getHistorialCaja().catch(() => []) : Promise.resolve([]),
        admin ? API.getCierres().catch(() => []) : Promise.resolve([]),
        admin ? API.getCierreConfig().catch(() => null) : Promise.resolve(null)
      ]);
      this.estado = estado;
      this.historial = historial;
      this.cierres = cierres;
      this.cierreConfig = cierreConfig;
      this.paint(view);
    } catch (err) {
      view.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error: ${esc(err.message)}</p></div>`;
    }
  },

  esAdmin() {
    return App.puede('caja.historial');
  },

  nombreMetodo(m) {
    return this.METODOS[m] || m;
  },

  // Diferencia de arqueo: positiva = sobrante, negativa = faltante
  fmtDiferencia(d) {
    if (d === null || d === undefined) return '-';
    if (Math.abs(d) < 0.01) return '<span class="badge badge-green">Sin diferencia</span>';
    return d > 0
      ? `<span class="badge badge-blue">Sobrante ${fmtMoneda(d)}</span>`
      : `<span class="badge badge-red">Faltante ${fmtMoneda(-d)}</span>`;
  },

  // Tabla del arqueo (ventas por medio de pago, movimientos y efectivo esperado)
  htmlResumen(r) {
    if (r.ciego) return this.htmlResumenCiego(r);
    const metodos = r.por_metodo.length
      ? r.por_metodo.map(m => `<tr><td>${esc(this.nombreMetodo(m.metodo))}</td><td>${m.cantidad}</td><td class="text-right font-bold">${fmtMoneda(m.total)}</td></tr>`).join('')
      : '<tr><td colspan="3" class="text-muted">Todavía no hay cobros en este turno</td></tr>';
    const movs = r.movimientos.length
      ? `<table class="mt-10">
          <thead><tr><th>Hora</th><th>Tipo</th><th>Concepto</th><th class="text-right">Monto</th></tr></thead>
          <tbody>${r.movimientos.map(m => `<tr>
            <td>${fmtFechaHora(m.fecha)}</td>
            <td>${m.tipo === 'ingreso' ? '<span class="badge badge-green">Ingreso</span>' : '<span class="badge badge-red">Egreso</span>'}</td>
            <td>${esc(m.concepto)}</td>
            <td class="text-right">${m.tipo === 'egreso' ? '-' : ''}${fmtMoneda(m.monto)}</td>
          </tr>`).join('')}</tbody>
        </table>`
      : '';
    return `
      <div class="grid grid-2 mt-10">
        <div>
          <h4><i class="fas fa-credit-card"></i> Ventas por medio de pago</h4>
          <table>
            <thead><tr><th>Medio</th><th>Cobros</th><th class="text-right">Total</th></tr></thead>
            <tbody>${metodos}</tbody>
            <tfoot><tr><td class="font-bold">Total</td><td>${r.cobros}</td><td class="text-right font-bold">${fmtMoneda(r.total_ventas)}</td></tr></tfoot>
          </table>
        </div>
        <div>
          <h4><i class="fas fa-money-bill-wave"></i> Efectivo en caja</h4>
          <table>
            <tbody>
              <tr><td>Monto inicial</td><td class="text-right">${fmtMoneda(r.monto_inicial)}</td></tr>
              <tr><td>+ Ventas en efectivo</td><td class="text-right">${fmtMoneda(r.ventas_efectivo)}</td></tr>
              <tr><td>+ Ingresos</td><td class="text-right">${fmtMoneda(r.ingresos)}</td></tr>
              <tr><td>− Egresos</td><td class="text-right">${fmtMoneda(r.egresos)}</td></tr>
            </tbody>
            <tfoot><tr><td class="font-bold">Efectivo esperado</td><td class="text-right font-bold text-success">${fmtMoneda(r.efectivo_esperado)}</td></tr></tfoot>
          </table>
        </div>
      </div>
      ${movs}`;
  },

  // Arqueo ciego: sin ventas ni efectivo esperado; solo lo que el cajero hizo con la caja
  htmlResumenCiego(r) {
    const movs = r.movimientos.length
      ? `<table class="mt-10"><thead><tr><th>Hora</th><th>Tipo</th><th>Concepto</th><th class="text-right">Monto</th></tr></thead>
          <tbody>${r.movimientos.map(m => `<tr><td>${fmtFechaHora(m.fecha)}</td>
            <td>${m.tipo === 'ingreso' ? '<span class="badge badge-green">Ingreso</span>' : '<span class="badge badge-red">Egreso</span>'}</td>
            <td>${esc(m.concepto)}</td><td class="text-right">${m.tipo === 'egreso' ? '-' : ''}${fmtMoneda(m.monto)}</td></tr>`).join('')}</tbody></table>`
      : '';
    return `
      <div class="card-info mt-10"><i class="fas fa-eye-slash"></i>
        <div><strong>Arqueo ciego.</strong> Al cerrar, contá el efectivo y declaralo. El encargado ve la diferencia.</div>
      </div>
      <table class="mt-10"><tbody>
        <tr><td>Monto inicial</td><td class="text-right">${fmtMoneda(r.monto_inicial)}</td></tr>
        <tr><td>Cobros del turno</td><td class="text-right">${r.cobros}</td></tr>
        <tr><td>+ Ingresos</td><td class="text-right">${fmtMoneda(r.ingresos)}</td></tr>
        <tr><td>− Egresos</td><td class="text-right">${fmtMoneda(r.egresos)}</td></tr>
      </tbody></table>
      ${movs}`;
  },

  paint(view) {
    const esAdmin = this.esAdmin();
    const caja = this.estado;

    const cajaCard = caja ? `
      <div class="card caja-abierta">
        <div class="card-header">
          <span class="card-title"><i class="fas fa-door-open"></i> Caja abierta</span>
          <span class="badge badge-green">Abierta</span>
        </div>
        <div class="grid grid-4">
          <div class="stat-card">
            <div class="stat-icon green"><i class="fas fa-dollar-sign"></i></div>
            <div class="stat-info">
              <h3>${caja.resumen.ciego ? caja.resumen.cobros : fmtMoneda(caja.resumen.total_ventas)}</h3>
              <span>${caja.resumen.ciego ? 'Cobros del turno' : 'Ventas del turno'}</span>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon blue"><i class="fas fa-cash-register"></i></div>
            <div class="stat-info">
              <h3>${caja.resumen.ciego ? '<i class="fas fa-eye-slash"></i>' : fmtMoneda(caja.resumen.efectivo_esperado)}</h3>
              <span>${caja.resumen.ciego ? 'Arqueo ciego' : 'Efectivo esperado'}</span>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon orange"><i class="fas fa-clock"></i></div>
            <div class="stat-info">
              <h3 class="small-h3">${fmtFechaHora(caja.fecha_apertura)}</h3>
              <span>Apertura</span>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon purple"><i class="fas fa-user"></i></div>
            <div class="stat-info">
              <h3 class="small-h3">${esc(caja.usuario_nombre || '-')}</h3>
              <span>Abierta por</span>
            </div>
          </div>
        </div>
        ${caja.observaciones ? `<p class="text-muted mt-10"><i class="fas fa-sticky-note"></i> ${esc(caja.observaciones)}</p>` : ''}
        ${this.htmlResumen(caja.resumen)}
        <div class="text-right mt-10">
          <button class="btn btn-outline" onclick="Caja.mostrarMovimiento('ingreso')"><i class="fas fa-plus-circle"></i> Ingreso</button>
          <button class="btn btn-outline" onclick="Caja.mostrarMovimiento('egreso')"><i class="fas fa-minus-circle"></i> Egreso / retiro</button>
          <button class="btn btn-danger" onclick="Caja.mostrarCierre()"><i class="fas fa-door-closed"></i> Cerrar caja</button>
        </div>
      </div>
    ` : `
      <div class="card">
        <div class="empty-state">
          <i class="fas fa-money-bill-wave"></i>
          <p>No hay caja abierta</p>
        </div>
        <div class="text-center mb-20">
          <button class="btn btn-success" onclick="Caja.mostrarApertura()">
            <i class="fas fa-door-open"></i> Abrir caja
          </button>
        </div>
      </div>
    `;

    const histRows = this.historial.map(h => `
      <tr class="clickable" onclick="Caja.verArqueo(${Number(h.id)})">
        <td>${fmtFechaHora(h.fecha_apertura)}</td>
        <td>${h.fecha_cierre ? fmtFechaHora(h.fecha_cierre) : '<span class="badge badge-green">Abierta</span>'}</td>
        <td>${esc(h.usuario_nombre || '-')}</td>
        <td class="font-bold">${fmtMoneda(h.ventas)}</td>
        <td>${h.monto_esperado !== null && h.monto_esperado !== undefined ? fmtMoneda(h.monto_esperado) : '-'}</td>
        <td>${h.pendiente_arqueo ? '<span class="badge badge-orange">Falta contar</span>' : h.fecha_cierre ? fmtMoneda(h.monto_final_real) : '-'}</td>
        <td>${h.fecha_cierre && !h.pendiente_arqueo ? this.fmtDiferencia(h.diferencia) : '-'}</td>
      </tr>
    `).join('');

    // Cajas que cerró el cierre del día sin que nadie contara: el encargado carga lo que había
    const sinContar = this.historial.filter(h => h.pendiente_arqueo);
    const avisoSinContar = esAdmin && sinContar.length ? sinContar.map(h => `
      <div class="card-info mb-20 caja-sin-contar"><i class="fas fa-exclamation-triangle"></i>
        <div><strong>La caja del ${fmtFechaHora(h.fecha_apertura)} se cerró sin contar el efectivo.</strong>
          Contá lo que había y cargalo para ver si faltó o sobró plata.</div>
        <button class="btn btn-warning btn-sm" onclick="Caja.mostrarArqueoPendiente(${Number(h.id)}, ${Number(h.monto_esperado) || 0})">
          <i class="fas fa-calculator"></i> Cargar lo contado</button>
      </div>`).join('') : '';

    view.innerHTML = `
      <div class="page-header">
        <div>
          <h2><i class="fas fa-money-bill-wave"></i> Caja</h2>
          <p>Apertura, movimientos, cierre y arqueo de caja</p>
        </div>
      </div>

      ${avisoSinContar}

      ${cajaCard}

      ${esAdmin ? this.htmlCardCierre() : ''}

      ${
        esAdmin ? `
        <div class="card mt-20">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-history"></i> Historial de cajas</span>
          </div>
          ${
            this.historial.length > 0 ? `
            <div class="table-wrap">
              <table>
                <thead>
                  <tr><th>Apertura</th><th>Cierre</th><th>Responsable</th><th>Ventas</th><th>Efectivo esperado</th><th>Contado</th><th>Diferencia</th></tr>
                </thead>
                <tbody>${histRows}</tbody>
              </table>
            </div>
            ` : `<div class="empty-state"><i class="fas fa-history"></i><p>Sin historial</p></div>`
          }
        </div>
        ` : ''
      }
    `;
  },

  mostrarApertura() {
    App.showModal(`
      <form onsubmit="Caja.abrir(event)">
        <div class="form-group">
          <label>Monto inicial en efectivo ($)</label>
          <input type="number" id="cajaInicial" min="0" step="0.01" value="0" required>
        </div>
        <div class="form-group">
          <label>Observaciones</label>
          <textarea id="cajaObservaciones" placeholder="Notas de apertura"></textarea>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-danger" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-success"><i class="fas fa-door-open"></i> Abrir caja</button>
        </div>
      </form>
    `, { title: 'Abrir caja' });
  },

  async abrir(e) {
    e.preventDefault();
    try {
      await API.abrirCaja({
        monto_inicial: parseFloat(document.getElementById('cajaInicial').value || 0),
        observaciones: document.getElementById('cajaObservaciones').value
      });
      App.closeModal();
      App.showToast('Caja abierta', 'success');
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  mostrarMovimiento(tipo) {
    const ingreso = tipo === 'ingreso';
    App.showModal(`
      <form onsubmit="Caja.guardarMovimiento(event, ${jsArg(tipo)})">
        <p class="text-muted">${ingreso
          ? 'Efectivo que entra a la caja sin ser una venta (por ejemplo, cambio).'
          : 'Efectivo que sale de la caja (retiro, pago a proveedor, gastos).'}</p>
        <div class="form-group">
          <label>Monto ($)</label>
          <input type="number" id="movMonto" min="0.01" step="0.01" required>
        </div>
        <div class="form-group">
          <label>Concepto</label>
          <input type="text" id="movConcepto" maxlength="120" placeholder="${ingreso ? 'Ej.: cambio del banco' : 'Ej.: pago a proveedor de bebidas'}" required>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-danger" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-success"><i class="fas fa-save"></i> Registrar</button>
        </div>
      </form>
    `, { title: ingreso ? 'Ingreso de efectivo' : 'Egreso de efectivo' });
  },

  guardarMovimiento(e, tipo) {
    e.preventDefault();
    return App.sinDobleEnvio('caja.movimiento', () => this._guardarMovimiento(e, tipo));
  },

  async _guardarMovimiento(e, tipo) {
    e.preventDefault();
    try {
      await API.registrarMovimientoCaja({
        tipo,
        monto: parseFloat(document.getElementById('movMonto').value),
        concepto: document.getElementById('movConcepto').value
      });
      App.closeModal();
      App.showToast('Movimiento registrado', 'success');
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  mostrarCierre() {
    const ciego = !!(this.estado && this.estado.resumen.ciego);
    const esperado = this.estado && !ciego ? this.estado.resumen.efectivo_esperado : 0;
    App.showModal(`
      <form onsubmit="Caja.cerrar(event)">
        ${ciego
          ? '<p><i class="fas fa-eye-slash"></i> Arqueo ciego: contá todo el efectivo de la caja (incluido el monto inicial) y escribí el total.</p>'
          : `<p>Efectivo esperado en caja: <strong>${fmtMoneda(esperado)}</strong></p>`}
        <div class="form-group">
          <label>Efectivo contado ($)</label>
          <input type="number" id="cajaFinal" min="0" step="0.01" required
                 ${ciego ? '' : `oninput="Caja.actualizarDiferencia(${Number(esperado) || 0})"`} autofocus>
        </div>
        <p id="cajaDiferencia" class="mt-10"></p>
        <div class="form-group">
          <label>Observaciones</label>
          <textarea id="cajaObservacionesCierre" placeholder="Explicá cualquier diferencia"></textarea>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-danger"><i class="fas fa-door-closed"></i> Cerrar caja</button>
        </div>
      </form>
    `, { title: 'Cerrar caja — Arqueo' });
  },

  actualizarDiferencia(esperado) {
    const valor = document.getElementById('cajaFinal').value;
    const el = document.getElementById('cajaDiferencia');
    if (!el) return;
    el.innerHTML = valor === '' ? '' : 'Diferencia: ' + this.fmtDiferencia(Math.round((parseFloat(valor) - esperado) * 100) / 100);
  },

  async cerrar(e) {
    e.preventDefault();
    try {
      const res = await API.cerrarCaja({
        monto_final_real: parseFloat(document.getElementById('cajaFinal').value),
        observaciones: document.getElementById('cajaObservacionesCierre').value
      });
      App.closeModal();
      App.showToast(res.message || 'Caja cerrada', 'success');
      this.mostrarResultado(res);
      this.render();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  mostrarResultado(res) {
    if (res.ciego) {
      return App.showModal(`
        <div class="cobro-ok"><i class="fas fa-check-circle"></i>
          <h3>Caja cerrada</h3>
          <p>Declaraste <strong>${fmtMoneda(res.efectivo_contado)}</strong> en efectivo. El encargado revisa el arqueo.</p>
        </div>
        <div class="modal-footer"><button class="btn btn-primary" onclick="App.closeModal()">Aceptar</button></div>
      `, { title: 'Arqueo de caja' });
    }
    App.showModal(`
      ${this.htmlResumen(res.resumen)}
      <div class="card sub-card mt-10">
        <p>Efectivo esperado: <strong>${fmtMoneda(res.efectivo_esperado)}</strong></p>
        <p>Efectivo contado: <strong>${fmtMoneda(res.efectivo_contado)}</strong></p>
        <p>Resultado: ${this.fmtDiferencia(res.diferencia)}</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-primary" onclick="App.closeModal()">Aceptar</button>
      </div>
    `, { title: 'Arqueo de caja', large: true });
  },

  async verArqueo(id) {
    try {
      const c = await API.getArqueoCaja(id);
      App.showModal(`
        <p><strong>Apertura:</strong> ${fmtFechaHora(c.fecha_apertura)} &mdash; <strong>Cierre:</strong> ${c.fecha_cierre ? fmtFechaHora(c.fecha_cierre) : 'abierta'}</p>
        <p><strong>Responsable:</strong> ${esc(c.usuario_nombre || '-')}</p>
        ${this.htmlResumen(c.resumen)}
        ${c.fecha_cierre ? `
          <div class="card sub-card mt-10">
            <p>Efectivo esperado: <strong>${c.monto_esperado !== null ? fmtMoneda(c.monto_esperado) : '-'}</strong></p>
            <p>Efectivo contado: <strong>${fmtMoneda(c.monto_final_real)}</strong></p>
            <p>Resultado: ${this.fmtDiferencia(c.diferencia)}</p>
            ${c.observaciones_cierre ? `<p><strong>Observaciones:</strong> ${esc(c.observaciones_cierre)}</p>` : ''}
          </div>` : ''}
        <div class="modal-footer">
          <button class="btn btn-primary" onclick="App.closeModal()">Cerrar</button>
        </div>
      `, { title: `Arqueo de caja #${c.id}`, large: true });
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  // ===== Cierre del día =====
  DIAS: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'],
  TIPOS: { salon: 'Salón', mostrador: 'Mostrador', takeaway: 'Para llevar', delivery: 'Delivery' },

  textoAutomatico(c) {
    if (!c || !c.activo) return 'El cierre automático está apagado.';
    const dias = c.dias.length === 7 ? 'todos los días' : c.dias.map(d => this.DIAS[d]).join(', ');
    return `Se cierra solo a las <strong>${esc(c.hora)}</strong>, ${dias}. 15 minutos antes avisa para contar el efectivo.`;
  },

  htmlCardCierre() {
    const filas = this.cierres.map(c => `
      <tr class="clickable" onclick="Caja.verCierre(${jsArg(c.fecha)})">
        <td>${fmtFecha(c.fecha)}</td>
        <td class="font-bold">${fmtMoneda(c.ventas)}</td>
        <td>${c.tickets}</td>
        <td>${c.automatico ? '<span class="badge badge-gray">Automático</span>' : `<span class="badge badge-blue">${esc(c.usuario_nombre || 'A mano')}</span>`}</td>
        <td>${c.falta_contar ? '<span class="badge badge-orange">Falta contar</span>' : '<span class="badge badge-green">Completo</span>'}</td>
      </tr>`).join('');
    return `
      <div class="card mt-20">
        <div class="card-header">
          <span class="card-title"><i class="fas fa-moon"></i> Cierre del día</span>
          ${App.puede('admin') ? '<button class="btn btn-outline btn-sm" onclick="Caja.configurarCierre()"><i class="fas fa-cog"></i> Configurar</button>' : ''}
        </div>
        <p class="text-muted">${this.textoAutomatico(this.cierreConfig)}
          El cierre junta todo lo del día: ventas, caja, gastos, propinas, personal, stock y lo que quedó pendiente.</p>
        <div class="mt-10">
          <button class="btn btn-outline" onclick="Caja.verCierreHoy()"><i class="fas fa-chart-line"></i> Ver cómo va hoy</button>
          <button class="btn btn-primary" onclick="Caja.cerrarDiaAhora()"><i class="fas fa-moon"></i> Cerrar el día ahora</button>
        </div>
        ${filas ? `<div class="table-wrap mt-10"><table>
          <thead><tr><th>Día</th><th>Ventas</th><th>Tickets</th><th>Cierre</th><th>Arqueo</th></tr></thead>
          <tbody>${filas}</tbody></table></div>` : ''}
      </div>`;
  },

  // Todo lo del día en una vista (también se imprime)
  htmlCierre(r) {
    const v = r.ventas;
    const fila = (a, b, extra = '') => `<tr${extra}><td>${a}</td><td class="text-right">${b}</td></tr>`;
    const tabla = (titulo, icono, filas, vacio) => `
      <div class="cierre-bloque"><h4><i class="fas ${icono}"></i> ${titulo}</h4>
        ${filas ? `<table><tbody>${filas}</tbody></table>` : `<p class="text-muted">${vacio}</p>`}</div>`;
    const comp = r.comparacion && r.comparacion.variacion !== null
      ? `<span class="badge ${r.comparacion.variacion >= 0 ? 'badge-green' : 'badge-red'}">${r.comparacion.variacion >= 0 ? '+' : ''}${r.comparacion.variacion}% vs. el ${fmtFecha(r.comparacion.fecha)}</span>` : '';
    const hora = f => f ? parseFecha(f).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '';
    const sangria = '&nbsp;&nbsp;';
    // Los cierres guardados antes de que el resumen trajera el detalle no tienen ventas_efectivo ni movimientos
    const cajas = r.cajas.map(c => `
      ${fila(`<strong>Caja de ${esc(c.usuario || '-')}</strong> (${c.estado === 'abierta' ? 'abierta' : 'cerrada'}${c.apertura ? ', desde las ' + hora(c.apertura) : ''})`, '')}
      ${c.ventas_efectivo !== undefined ? `
        ${fila(sangria + 'Inicial', fmtMoneda(c.monto_inicial))}
        ${fila(sangria + '+ Ventas en efectivo', fmtMoneda(c.ventas_efectivo))}
        ${fila(sangria + '+ Ingresos', fmtMoneda(c.ingresos))}
        ${fila(sangria + '− Egresos', fmtMoneda(c.egresos))}
        ${fila(sangria + '<strong>= Efectivo esperado</strong>', `<strong>${fmtMoneda(c.efectivo_esperado)}</strong>`)}`
      : fila(sangria + 'Inicial + ventas en efectivo + ingresos − egresos', fmtMoneda(c.efectivo_esperado))}
      ${fila(sangria + 'Contado', c.pendiente_arqueo ? '<span class="badge badge-orange">Falta contar</span>' : c.contado !== null ? fmtMoneda(c.contado) : '-')}
      ${c.diferencia !== null ? fila(sangria + 'Resultado', this.fmtDiferencia(c.diferencia)) : ''}
      ${(c.por_metodo || []).filter(m => m.metodo !== 'efectivo').map(m => fila(`${sangria}Cobrado con ${esc(this.nombreMetodo(m.metodo))} (${m.cantidad})`, fmtMoneda(m.total))).join('')}`).join('');
    const movimientos = r.cajas.flatMap(c => (c.movimientos || []).map(m => ({ ...m, caja: c.usuario })));
    const filasMov = movimientos.map(m => `<tr>
      <td>${hora(m.fecha)}</td>
      <td>${m.tipo === 'ingreso' ? '<span class="badge badge-green">Ingreso</span>' : '<span class="badge badge-red">Egreso</span>'}</td>
      <td>${esc(m.concepto)}${m.usuario ? `<br><small class="text-muted">${esc(m.usuario)}</small>` : ''}</td>
      <td class="text-right">${m.tipo === 'egreso' ? '− ' : ''}${fmtMoneda(m.monto)}</td></tr>`).join('');
    const cobros = r.cobros || [];
    const filasCobros = cobros.map(p => `<tr>
      <td>${hora(p.fecha)}</td>
      <td>${esc(p.numero_pedido)}<br><small class="text-muted">${esc(p.mesa || this.TIPOS[p.tipo] || p.tipo || '')}${p.usuario ? ' · ' + esc(p.usuario) : ''}</small></td>
      <td>${esc(this.nombreMetodo(p.metodo))}${p.referencia ? `<br><small class="text-muted">${esc(p.referencia)}</small>` : ''}</td>
      <td class="text-right">${fmtMoneda(p.monto)}</td></tr>`).join('');
    const detalle = (titulo, icono, cab, filas, vacio) => `
      <div class="cierre-bloque mt-10"><h4><i class="fas ${icono}"></i> ${titulo}</h4>
        ${filas ? `<div class="table-wrap"><table class="cierre-detalle"><thead><tr>${cab}</tr></thead><tbody>${filas}</tbody></table></div>`
          : `<p class="text-muted">${vacio}</p>`}</div>`;
    const pend = r.pendientes;
    const pendientes = [
      ...pend.pedidos_abiertos.map(p => fila(`Pedido ${esc(p.numero_pedido)} abierto${p.mesa ? ' (' + esc(p.mesa) + ')' : ''}`, fmtMoneda(p.total))),
      pend.facturas_en_espera ? fila('Facturas de ARCA en espera', pend.facturas_en_espera) : '',
      ...r.personal.sin_salida.map(n => fila(`${esc(n)} no fichó la salida`, ''))
    ].join('');
    return `
      <div class="cierre-dia">
        <div class="grid grid-4">
          <div class="stat-card"><div class="stat-icon green"><i class="fas fa-dollar-sign"></i></div>
            <div class="stat-info"><h3>${fmtMoneda(v.total)}</h3><span>Ventas ${comp}</span></div></div>
          <div class="stat-card"><div class="stat-icon blue"><i class="fas fa-receipt"></i></div>
            <div class="stat-info"><h3>${v.tickets}</h3><span>Tickets</span></div></div>
          <div class="stat-card"><div class="stat-icon orange"><i class="fas fa-ticket-alt"></i></div>
            <div class="stat-info"><h3>${fmtMoneda(v.ticket_promedio)}</h3><span>Ticket promedio</span></div></div>
          <div class="stat-card"><div class="stat-icon purple"><i class="fas fa-hand-holding-usd"></i></div>
            <div class="stat-info"><h3>${fmtMoneda(r.propinas.total)}</h3><span>Propinas</span></div></div>
        </div>
        <div class="grid grid-2 mt-10">
          ${tabla('Ventas por medio de pago', 'fa-credit-card', v.por_metodo.map(m => fila(`${esc(this.nombreMetodo(m.metodo))} (${m.cobros})`, fmtMoneda(m.total))).join(''), 'Sin ventas')}
          ${tabla('Por tipo de pedido', 'fa-store', v.por_tipo.map(t => fila(`${esc(this.TIPOS[t.tipo] || t.tipo)} (${t.tickets})`, fmtMoneda(t.total))).join(''), 'Sin ventas')}
          ${tabla('Caja', 'fa-cash-register', cajas, 'No se abrió la caja')}
          ${tabla('Propinas (en efectivo, partes iguales)', 'fa-hand-holding-usd', r.propinas.reparto.map(p => fila(esc(p.nombre), fmtMoneda(p.monto))).join(''), r.propinas.total ? 'Elegí quiénes se reparten las propinas en Configurar' : 'Sin propinas')}
          ${tabla('Compras y gastos', 'fa-file-invoice-dollar', r.gastos.items.map(g => fila(`${esc(g.proveedor || g.descripcion)}${g.estado === 'pendiente' ? ' <span class="badge badge-orange">A pagar</span>' : ''}`, fmtMoneda(g.total))).join('') + (r.gastos.items.length ? fila('<strong>Total</strong>', `<strong>${fmtMoneda(r.gastos.total)}</strong>`) : ''), 'Sin gastos cargados')}
          ${tabla('Por persona', 'fa-user', v.por_mozo.map(m => fila(`${esc(m.nombre)} (${m.tickets})`, fmtMoneda(m.total))).join(''), 'Sin ventas')}
          ${tabla('Lo más vendido', 'fa-star', v.mas_vendidos.map(p => fila(esc(p.nombre), `${p.cantidad} u.`)).join(''), 'Sin ventas')}
          ${tabla('Personal', 'fa-user-clock', r.personal.horas.map(h => fila(esc(h.nombre), `${h.horas} h`)).join(''), 'Nadie fichó')}
          ${tabla('Descuentos y cancelaciones', 'fa-tags',
            fila(`Descuentos (${v.descuentos.pedidos} pedidos)`, fmtMoneda(v.descuentos.total)) + fila(`Cancelados (${v.cancelados.cantidad})`, fmtMoneda(v.cancelados.total)), '')}
          ${tabla('Stock para reponer', 'fa-boxes', r.stock_bajo.map(p => fila(esc(p.nombre), `${p.stock_actual} ${esc(p.unidad || '')} (mín. ${p.stock_minimo})`)).join(''), 'Todo con stock')}
          ${tabla('Quedó pendiente', 'fa-exclamation-circle', pendientes, 'Nada pendiente')}
        </div>
        ${detalle(`Movimientos de caja (${movimientos.length})`, 'fa-right-left',
          '<th>Hora</th><th>Tipo</th><th>Concepto</th><th class="text-right">Monto</th>', filasMov, 'Sin ingresos ni egresos de caja')}
        ${r.cobros ? detalle(`Todos los cobros (${cobros.length})`, 'fa-list',
          '<th>Hora</th><th>Pedido</th><th>Medio de pago</th><th class="text-right">Monto</th>', filasCobros, 'Sin cobros') : ''}
        <p class="text-muted mt-10"><i class="fas fa-database"></i> ${r.copia ? `Copia de seguridad del día: ${esc(r.copia.nombre)}` : 'Todavía no hay copia de seguridad de este día'}</p>
      </div>`;
  },

  mostrarCierreModal(r, titulo, pie = '') {
    this._cierreVisto = { r, titulo };
    App.showModal(`
      ${this.htmlCierre(r)}
      ${pie}
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="Caja.imprimirCierre()"><i class="fas fa-print"></i> Imprimir</button>
        <button class="btn btn-primary" onclick="App.closeModal()">Cerrar</button>
      </div>`, { title: titulo, large: true });
  },

  async verCierreHoy() {
    try {
      this.mostrarCierreModal(await API.getCierreHoy(), 'Cómo va el día (todavía sin cerrar)');
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  async verCierre(fecha) {
    try {
      const c = await API.getCierre(fecha);
      this.mostrarCierreModal(c.resumen, `Cierre del ${fmtFecha(c.fecha)}`,
        `<p class="text-muted mt-10">${c.automatico ? 'Cierre automático' : `Cerrado por ${esc(c.usuario_nombre || '-')}`} — ${fmtFechaHora(c.actualizado_en || c.creado_en)}</p>`);
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  cerrarDiaAhora() {
    const abierta = !!this.estado;
    App.showModal(`
      <p>Se guarda el resumen de todo lo del día.</p>
      ${abierta ? `<div class="card-info mt-10"><i class="fas fa-exclamation-triangle"></i>
        <div>La caja está abierta. Lo mejor es <strong>cerrar la caja primero</strong> contando el efectivo.
        Si seguís, la caja se cierra <strong>sin contar</strong> y después un encargado carga lo que había.</div></div>` : ''}
      <p class="text-muted mt-10">Si después hay más ventas, podés volver a cerrar el día y el resumen se actualiza.</p>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="App.closeModal()">Cancelar</button>
        ${abierta ? '<button class="btn btn-outline" onclick="App.closeModal(); Caja.mostrarCierre()"><i class="fas fa-door-closed"></i> Cerrar la caja primero</button>' : ''}
        <button class="btn btn-primary" onclick="Caja.confirmarCierreDia()"><i class="fas fa-moon"></i> Cerrar el día</button>
      </div>`, { title: 'Cerrar el día' });
  },

  confirmarCierreDia() {
    return App.sinDobleEnvio('caja.cierre_dia', async () => {
      try {
        const r = await API.cerrarDia();
        App.closeModal();
        App.showToast('Día cerrado', 'success');
        await this.render();
        this.mostrarCierreModal(r.resumen, `Cierre del ${fmtFecha(r.fecha)}`);
      } catch (err) { App.showToast(err.message, 'error'); }
    });
  },

  imprimirCierre() {
    if (!this._cierreVisto) return;
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) return App.showToast('Habilitá las ventanas emergentes para imprimir', 'warning');
    const estilos = [...document.querySelectorAll('link[rel="stylesheet"]')].map(l => `<link rel="stylesheet" href="${l.href}">`).join('');
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(this._cierreVisto.titulo)}</title>${estilos}
      <style>body{background:#fff;padding:20px}.cierre-bloque{break-inside:avoid}</style></head>
      <body><h2>${esc(App.config && App.config.nombre_negocio || 'Fadido')} — ${esc(this._cierreVisto.titulo)}</h2>${this.htmlCierre(this._cierreVisto.r)}</body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 500);
  },

  async configurarCierre() {
    try {
      const [c, usuarios] = await Promise.all([API.getCierreConfig(), API.getUsuarios().catch(() => [])]);
      const activos = usuarios.filter(u => u.activo);
      App.showModal(`
        <form onsubmit="Caja.guardarConfigCierre(event)">
          <div class="form-group">
            <label class="checkbox-label"><input type="checkbox" id="cierreActivo" ${c.activo ? 'checked' : ''}> Cerrar el día automáticamente</label>
          </div>
          <div class="form-group">
            <label>Hora del cierre</label>
            <input type="time" id="cierreHora" value="${esc(c.hora)}" required>
            <small class="form-hint">15 minutos antes avisa en el sistema para contar el efectivo. Si la caja sigue abierta a esa hora, se cierra sin contar y un encargado carga lo que había.</small>
          </div>
          <div class="form-group">
            <label>Días que abre el local</label>
            <div class="cierre-dias">${this.DIAS.map((d, i) => `<label class="checkbox-label"><input type="checkbox" class="cierreDia" value="${i}" ${c.dias.includes(i) ? 'checked' : ''}> ${d}</label>`).join('')}</div>
          </div>
          <div class="form-group">
            <label>Las propinas se reparten entre</label>
            <div class="cierre-dias">${activos.map(u => `<label class="checkbox-label"><input type="checkbox" class="cierreProp" value="${Number(u.id)}" ${c.propinas_usuarios.includes(u.id) ? 'checked' : ''}> ${esc(u.nombre)}</label>`).join('')}</div>
            <small class="form-hint">En partes iguales. Si no elegís a nadie, se reparten entre los que ficharon ese día.</small>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline" onclick="App.closeModal()">Cancelar</button>
            <button type="submit" class="btn btn-success"><i class="fas fa-save"></i> Guardar</button>
          </div>
        </form>`, { title: 'Cierre del día' });
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  async guardarConfigCierre(e) {
    e.preventDefault();
    const marcados = sel => [...document.querySelectorAll(sel)].filter(x => x.checked).map(x => Number(x.value));
    try {
      await API.updateConfig({
        cierre_auto_activo: document.getElementById('cierreActivo').checked ? 1 : 0,
        cierre_hora: document.getElementById('cierreHora').value,
        cierre_dias: marcados('.cierreDia'),
        cierre_propinas_usuarios: marcados('.cierreProp')
      });
      App.closeModal();
      App.showToast('Cierre del día guardado', 'success');
      this.render();
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  mostrarArqueoPendiente(id, esperado) {
    App.showModal(`
      <form onsubmit="Caja.guardarArqueoPendiente(event, ${Number(id)})">
        <p>Efectivo esperado en esa caja: <strong>${fmtMoneda(esperado)}</strong></p>
        <div class="form-group">
          <label>Efectivo contado ($)</label>
          <input type="number" id="arqueoContado" min="0" step="0.01" required oninput="Caja.actualizarDiferenciaPendiente(${Number(esperado) || 0})" autofocus>
        </div>
        <p id="arqueoDiferencia"></p>
        <div class="form-group">
          <label>Observaciones</label>
          <textarea id="arqueoObs" placeholder="Explicá cualquier diferencia"></textarea>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-success"><i class="fas fa-save"></i> Guardar arqueo</button>
        </div>
      </form>`, { title: 'Cargar el efectivo contado' });
  },

  actualizarDiferenciaPendiente(esperado) {
    const valor = document.getElementById('arqueoContado').value;
    document.getElementById('arqueoDiferencia').innerHTML = valor === '' ? '' : 'Diferencia: ' + this.fmtDiferencia(Math.round((parseFloat(valor) - esperado) * 100) / 100);
  },

  guardarArqueoPendiente(e, id) {
    e.preventDefault();
    return App.sinDobleEnvio('caja.arqueo_pendiente', async () => {
      try {
        const r = await API.completarArqueo(id, {
          monto_final_real: parseFloat(document.getElementById('arqueoContado').value),
          observaciones: document.getElementById('arqueoObs').value
        });
        App.closeModal();
        App.showToast(`Arqueo guardado: ${Math.abs(r.diferencia) < 0.01 ? 'sin diferencia' : r.diferencia > 0 ? 'sobrante ' + fmtMoneda(r.diferencia) : 'faltante ' + fmtMoneda(-r.diferencia)}`, 'success');
        this.render();
      } catch (err) { App.showToast(err.message, 'error'); }
    });
  }
};
