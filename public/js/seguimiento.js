// =============================================
// FADIDO - Seguimiento del pedido de la barra (seguimiento.html?p=<código>)
// El cliente ve si está en preparación o listo para retirar, y lo paga desde el celular:
// Mercado Pago (si el local lo tiene), transferencia al alias del local (avisa y la caja confirma) o en la caja.
// Se consulta cada 5 s mientras la página está a la vista; cuando pasa a "listo" vibra y suena.
// =============================================
'use strict';

const Seguimiento = {
  codigo: '',
  estado: null,
  etapaAnterior: '',
  verTransferencia: false,

  esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
  plata(n) { return '$ ' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); },

  async api(ruta, metodo = 'GET', body) {
    const r = await fetch('/api/publico/pedido-barra/' + this.codigo + ruta, {
      method: metodo, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'No se pudo conectar');
    return d;
  },

  async init() {
    const q = new URLSearchParams(location.search);
    this.codigo = /^[a-f0-9]{24}$/.test(q.get('p') || '') ? q.get('p') : '';
    if (!this.codigo) return this.error('No encontramos tu pedido. Preguntá en la caja.');
    try {
      // Vuelta de Mercado Pago: se verifica el pago (se acredita aunque la notificación tarde)
      const pago = q.get('payment_id') || q.get('collection_id');
      this.mostrar(pago ? await this.api('/verificar', 'POST', { payment_id: pago }) : await this.api(''));
      if (pago) history.replaceState(null, '', 'seguimiento.html?p=' + this.codigo);
    } catch (err) { return this.error(err.message); }
    setInterval(() => { if (!document.hidden) this.refrescar(); }, 5000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.refrescar(); });
  },

  async refrescar() {
    try { this.mostrar(await this.api('')); } catch (e) { /* sin conexión un momento: se reintenta */ }
  },

  error(msg) {
    document.getElementById('app').innerHTML = `<div class="error"><i class="fas fa-exclamation-triangle fa-2x"></i><p>${this.esc(msg)}</p></div>`;
  },

  avisarListo() {
    try { if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 600]); } catch (e) {}
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.35].forEach(t => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.25, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.3);
        o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.3);
      });
    } catch (e) {}
  },

  mostrar(e) {
    this.estado = e;
    if (e.negocio) document.title = 'Tu pedido | ' + e.negocio;
    if (e.etapa === 'listo' && this.etapaAnterior && this.etapaAnterior !== 'listo') this.avisarListo();
    this.etapaAnterior = e.etapa;
    const ETAPAS = {
      preparando: ['fa-fire-burner', 'Estamos preparando tu pedido', 'Te avisamos acá cuando esté listo. Podés dejar la página abierta.'],
      listo: ['fa-bell', '¡Listo! Retiralo en la barra', 'Decí tu número o tu nombre al retirar.'],
      retirado: ['fa-face-smile', '¡Que lo disfrutes!', 'Ya lo retiraste.'],
      cancelado: ['fa-circle-xmark', 'El pedido se canceló', 'Preguntá en la caja.']
    };
    const [icono, titulo, texto] = ETAPAS[e.etapa] || ETAPAS.preparando;
    const paso = { preparando: 1, listo: 2, retirado: 3 }[e.etapa] || 0;
    const pasos = ['Recibido', 'En preparación', 'Listo'].map((p, i) => `<span class="${i < paso || (i === 0) ? 'hecho' : ''}">${p}</span>`).join('');
    const items = e.cuenta.items.map(i => `<div class="fila"><span>${this.esc(i.cantidad)} × ${this.esc(i.nombre_producto)}</span><span>${this.plata(i.subtotal)}</span></div>`).join('');
    document.getElementById('app').innerHTML = `
      ${e.negocio ? `<div class="negocio">${this.esc(e.negocio)}</div>` : ''}
      <div class="tarjeta numero"><small>Tu pedido${e.cliente ? ', ' + this.esc(e.cliente) : ''}</small><strong>#${this.esc(e.numero_corto || e.numero_pedido)}</strong><small>${this.esc(e.numero_pedido)}</small></div>
      <div class="tarjeta etapa ${e.etapa}" aria-live="polite">
        <i class="fas ${icono}"></i><h2>${titulo}</h2><p>${texto}</p>
        ${e.etapa !== 'cancelado' ? `<div class="pasos">${pasos}</div>` : ''}
      </div>
      <div class="tarjeta">
        <h3>Tu cuenta</h3>
        ${items}
        <div class="fila total"><span>Total</span><span>${this.plata(e.cuenta.total)}</span></div>
      </div>
      <div class="tarjeta" id="pago">${this.htmlPago(e)}</div>`;
  },

  htmlPago(e) {
    if (e.etapa === 'cancelado') return '<p class="nota">Sin cobro.</p>';
    if (e.pagado) return '<div class="pagado"><i class="fas fa-circle-check"></i> Pagado</div>';
    if (e.aviso_pago === 'transferencia')
      return `<h3>Falta pagar ${this.plata(e.cuenta.saldo)}</h3><p class="nota"><i class="fas fa-clock"></i> Avisaste que transferiste: la caja lo confirma en un momento.</p>`;
    const t = e.pago.transferencia;
    return `<h3>Falta pagar ${this.plata(e.cuenta.saldo)}</h3>
      ${e.pago.mercadopago ? `<button class="boton mp" id="btnMP" onclick="Seguimiento.pagarMP()"><i class="fas fa-lock"></i> Pagar con Mercado Pago</button>` : ''}
      ${t ? (this.verTransferencia ? `
        <div class="alias"><div><small>Transferí a este alias</small><br><strong id="alias">${this.esc(t.alias)}</strong>${t.titular ? `<br><small>${this.esc(t.titular)}</small>` : ''}</div>
          <button class="boton secundario" style="width:auto;margin:0;padding:10px 14px" onclick="Seguimiento.copiar(this)"><i class="fas fa-copy"></i> Copiar</button></div>
        <button class="boton principal" onclick="Seguimiento.transferi(this)"><i class="fas fa-check"></i> Ya transferí</button>`
        : `<button class="boton secundario" onclick="Seguimiento.verTransferencia=true;Seguimiento.mostrar(Seguimiento.estado)"><i class="fas fa-building-columns"></i> Pagar por transferencia</button>`) : ''}
      <p class="nota">O pagá en la caja al retirar (efectivo, tarjeta${t ? ', transferencia' : ''}).</p>`;
  },

  async pagarMP() {
    const b = document.getElementById('btnMP');
    b.disabled = true; b.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Abriendo Mercado Pago...';
    try { location.href = (await this.api('/pagar', 'POST', {})).link; } catch (err) {
      alert(err.message); b.disabled = false; b.innerHTML = '<i class="fas fa-lock"></i> Pagar con Mercado Pago';
    }
  },

  async copiar(btn) {
    const alias = this.estado.pago.transferencia.alias;
    try { await navigator.clipboard.writeText(alias); } catch (e) {
      const r = document.createRange(); r.selectNodeContents(document.getElementById('alias'));
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    }
    btn.innerHTML = '<i class="fas fa-check"></i> Copiado';
  },

  async transferi(btn) {
    btn.disabled = true;
    try { this.mostrar(await this.api('/transferi', 'POST', {})); } catch (err) { alert(err.message); btn.disabled = false; }
  }
};

Seguimiento.init();
