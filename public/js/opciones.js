// =============================================
// MORFI - Opciones y adicionales al agregar un producto
// ("¿Qué leche?", "Adicionales"): ventana para elegir, la usan el punto de venta y "Agregar ítem".
// El precio que se muestra es orientativo: el servidor lo vuelve a calcular con la base.
// =============================================

const Opciones = {
  grupos: [],

  async cargar() {
    try { this.grupos = await API.getGruposOpciones(); } catch (e) { this.grupos = []; }
    return this.grupos;
  },

  gruposDe(producto) {
    return (producto && producto.grupos || []).map(id => this.grupos.find(g => g.id === id)).filter(g => g && g.activo && g.opciones.length);
  },

  // Abre la ventana y llama a listo({ opciones: [ids], extra, sufijo }) al confirmar. Sin grupos, llama enseguida.
  elegir(producto, listo) {
    const grupos = this.gruposDe(producto);
    if (!grupos.length) return listo({ opciones: [], extra: 0, sufijo: '' });
    this._actual = { producto, grupos, listo };
    const html = grupos.map(g => {
      const una = g.tipo === 'una';
      const pista = una ? (g.obligatorio ? 'Elegí una' : 'Opcional') : (g.maximo ? `Hasta ${g.maximo}` : 'Elegí las que quieras');
      return `
        <div class="opciones-grupo" data-grupo="${Number(g.id)}" data-tipo="${esc(g.tipo)}" data-maximo="${Number(g.maximo) || 0}">
          <h4>${esc(g.nombre)} <small>${pista}</small></h4>
          <div class="opciones-lista">
            ${g.opciones.map((o, i) => `
              <label class="opcion-chip">
                <input type="${una ? 'radio' : 'checkbox'}" name="og${Number(g.id)}" value="${Number(o.id)}" data-precio="${Number(o.precio) || 0}"
                  data-nombre="${esc(o.nombre)}" ${una && g.obligatorio && i === 0 ? 'checked' : ''} onchange="Opciones.actualizar(this)">
                <span>${esc(o.nombre)}${o.precio ? ` <b>+${fmtMoneda(o.precio)}</b>` : ''}</span>
              </label>`).join('')}
          </div>
        </div>`;
    }).join('');
    App.showModal(`
      <div class="opciones-elegir">${html}</div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline" onclick="App.closeModal()">Cancelar</button>
        <button type="button" class="btn btn-success" id="opcionesOk" onclick="Opciones.confirmar()"></button>
      </div>`, { title: producto.nombre });
    this.actualizar();
  },

  // Respeta el tope de "varias" y muestra el precio con lo elegido
  actualizar(input) {
    if (input && input.type === 'checkbox') {
      const caja = input.closest('.opciones-grupo');
      const maximo = Number(caja.dataset.maximo) || 0;
      if (maximo && caja.querySelectorAll('input:checked').length > maximo) input.checked = false;
    }
    const { extra } = this.leer();
    const btn = document.getElementById('opcionesOk');
    if (btn) btn.innerHTML = `<i class="fas fa-plus"></i> Agregar ${fmtMoneda((Number(this._actual.producto.precio_venta) || 0) + extra)}`;
  },

  leer() {
    const elegidas = [...document.querySelectorAll('.opciones-elegir input:checked')];
    return {
      opciones: elegidas.map(i => Number(i.value)),
      extra: elegidas.reduce((s, i) => s + (Number(i.dataset.precio) || 0), 0),
      sufijo: elegidas.length ? ' · ' + elegidas.map(i => i.dataset.nombre).join(', ') : ''
    };
  },

  confirmar() {
    const faltan = this._actual.grupos.filter(g => g.tipo === 'una' && g.obligatorio &&
      !document.querySelector(`.opciones-grupo[data-grupo="${g.id}"] input:checked`));
    if (faltan.length) return App.showToast(`Elegí: ${faltan.map(g => g.nombre).join(', ')}`, 'warning');
    const r = this.leer();
    App.closeModal();
    this._actual.listo(r);
  }
};
