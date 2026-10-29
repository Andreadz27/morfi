// =============================================
// FADIDO - Seguimiento del pedido de la barra o del autoservicio desde la mesa (seguimiento.html?p=<código>)
// El cliente ve si está en preparación o listo para retirar, y lo paga desde el celular:
// Mercado Pago (si el local lo tiene), transferencia al alias del local (avisa y la caja confirma) o en la caja.
// Cómo se entera de que está listo (de más a menos confiable):
// - WhatsApp: toca "Avisame por WhatsApp" y manda un mensaje ya escrito al local; Fadido le contesta cuando está listo
//   (anda con el celular bloqueado y no le cuesta nada al local: el cliente escribió primero).
// - Esta página: suena y vibra hasta que toca "¡Voy!". Los navegadores no dejan sonar sin un toque previo, por eso
//   el botón "Activar sonido" (cualquier toque en la página también sirve). Con https además muestra una notificación.
// - La caja puede "Llamar de nuevo": vuelve a sonar acá, en la TV de retiro y por WhatsApp.
// Se consulta cada 5 s a la vista y cada 15 s en segundo plano (el navegador puede espaciarlo más).
// =============================================
'use strict';

const Seguimiento = {
  codigo: '',
  estado: null,
  etapaAnterior: '',
  llamadoAnterior: null,
  verTransferencia: false,
  ctx: null,
  sonidoActivo: false,
  alarma: null,
  tituloOriginal: document.title,
  wakeLock: null,

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
    // Cualquier toque habilita el sonido (el navegador lo exige)
    document.addEventListener('pointerdown', () => this.desbloquearAudio(), { once: true });
    try {
      // Vuelta de Mercado Pago: se verifica el pago (se acredita aunque la notificación tarde)
      const pago = q.get('payment_id') || q.get('collection_id');
      this.mostrar(pago ? await this.api('/verificar', 'POST', { payment_id: pago }) : await this.api(''));
      if (pago) history.replaceState(null, '', 'seguimiento.html?p=' + this.codigo);
    } catch (err) { return this.error(err.message); }
    let ultima = Date.now();
    setInterval(() => {
      if (document.hidden && Date.now() - ultima < 15000) return;
      ultima = Date.now();
      this.refrescar();
    }, 5000);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      this.refrescar();
      // La pantalla se apaga sola de nuevo al volver: se pide otra vez que quede prendida
      if (this.sonidoActivo) this.mantenerPantalla();
    });
  },

  async refrescar() {
    try { this.mostrar(await this.api('')); } catch (e) { /* sin conexión un momento: se reintenta */ }
  },

  error(msg) {
    document.getElementById('app').innerHTML = `<div class="error"><i class="fas fa-exclamation-triangle fa-2x"></i><p>${this.esc(msg)}</p></div>`;
  },

  // ----- Avisos en el celular -----
  desbloquearAudio() {
    try {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch (e) {}
  },

  // Botón "Activar sonido": sonido de prueba, pantalla prendida y (con https) permiso de notificaciones
  async activarAvisos() {
    this.desbloquearAudio();
    this.beep(1);
    this.sonidoActivo = true;
    this.mantenerPantalla();
    if (window.isSecureContext && 'Notification' in window && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch (e) {}
    }
    if (window.isSecureContext && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    this.mostrar(this.estado);
  },

  async mantenerPantalla() {
    try { if ('wakeLock' in navigator && !document.hidden) this.wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
  },

  beep(veces = 2) {
    if (!this.ctx) return;
    for (let i = 0; i < veces; i++) {
      const t = i * 0.35, o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.frequency.value = i % 2 ? 1100 : 880; o.connect(g); g.connect(this.ctx.destination);
      g.gain.setValueAtTime(0.3, this.ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + t + 0.3);
      o.start(this.ctx.currentTime + t); o.stop(this.ctx.currentTime + t + 0.3);
    }
  },

  // Suena y vibra cada 3 s (hasta 2 minutos) hasta que el cliente toca "¡Voy!"; el título de la pestaña parpadea
  avisarListo(otraVez) {
    this.callarAlarma();
    const titulo = otraVez ? '🔔 ¡Te están llamando!' : '🔔 ¡Tu pedido está listo!';
    const cuerpo = `Pedido #${this.estado.numero_corto}: retiralo en el ${this.estado.lugar ? 'mostrador' : 'mostrador de la barra'}.`;
    let n = 0;
    const sonar = () => {
      try { if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 800]); } catch (e) {}
      this.beep(3);
      document.title = n % 2 ? this.tituloOriginal : titulo;
      if (++n >= 40) this.callarAlarma();
    };
    sonar();
    this.alarma = setInterval(sonar, 3000);
    if (window.isSecureContext && 'Notification' in window && Notification.permission === 'granted' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then(reg => reg && reg.showNotification(titulo, {
        body: cuerpo, tag: 'pedido-' + this.codigo, renotify: true, requireInteraction: true, icon: '/favicon.svg',
        vibrate: [400, 150, 400, 150, 800], data: { url: location.href }
      })).catch(() => {});
    }
    const v = document.getElementById('voy');
    if (v) v.hidden = false;
  },

  callarAlarma() {
    if (this.alarma) clearInterval(this.alarma);
    this.alarma = null;
    document.title = this.estado && this.estado.negocio ? 'Tu pedido | ' + this.estado.negocio : this.tituloOriginal;
    try { if (navigator.vibrate) navigator.vibrate(0); } catch (e) {}
    const v = document.getElementById('voy');
    if (v) v.hidden = true;
  },

  mostrar(e) {
    this.estado = e;
    if (e.negocio && !this.alarma) document.title = 'Tu pedido | ' + e.negocio;
    this.tituloOriginal = e.negocio ? 'Tu pedido | ' + e.negocio : this.tituloOriginal;
    const pasaAListo = e.etapa === 'listo' && this.etapaAnterior && this.etapaAnterior !== 'listo';
    const llamadoNuevo = e.etapa === 'listo' && e.llamado_en && this.llamadoAnterior !== null && e.llamado_en !== this.llamadoAnterior;
    if (e.etapa !== 'listo' && this.alarma) this.callarAlarma();
    const donde = e.lugar ? 'el mostrador' : 'la barra';
    const ETAPAS = {
      preparando: ['fa-fire-burner', 'Estamos preparando tu pedido', 'Te avisamos cuando esté listo.'],
      listo: ['fa-bell', `¡Listo! Retiralo en ${donde}`, 'Decí tu número o tu nombre al retirar.'],
      retirado: ['fa-face-smile', '¡Que lo disfrutes!', 'Ya lo retiraste.'],
      cancelado: ['fa-circle-xmark', 'El pedido se canceló', 'Preguntá en la caja.']
    };
    const [icono, titulo, texto] = ETAPAS[e.etapa] || ETAPAS.preparando;
    const paso = { preparando: 1, listo: 2, retirado: 3 }[e.etapa] || 0;
    const pasos = ['Recibido', 'En preparación', 'Listo'].map((p, i) => `<span class="${i < paso || (i === 0) ? 'hecho' : ''}">${p}</span>`).join('');
    const items = e.cuenta.items.map(i => `<div class="fila"><span>${this.esc(i.cantidad)} × ${this.esc(i.nombre_producto)}</span><span>${this.plata(i.subtotal)}</span></div>`).join('');
    document.getElementById('app').innerHTML = `
      ${e.negocio ? `<div class="negocio">${this.esc(e.negocio)}</div>` : ''}
      <div class="tarjeta numero"><small>Tu pedido${e.cliente ? ', ' + this.esc(e.cliente) : ''}</small><strong>#${this.esc(e.numero_corto || e.numero_pedido)}</strong><small>${this.esc(e.numero_pedido)}${e.lugar ? ' · ' + this.esc(e.lugar) : ''}</small></div>
      <div class="tarjeta etapa ${e.etapa}" aria-live="assertive">
        <i class="fas ${icono}"></i><h2>${titulo}</h2><p>${texto}</p>
        ${e.etapa !== 'cancelado' ? `<div class="pasos">${pasos}</div>` : ''}
        <button class="boton voy" id="voy" ${this.alarma ? '' : 'hidden'} onclick="Seguimiento.callarAlarma()"><i class="fas fa-person-walking"></i> ¡Voy!</button>
      </div>
      ${this.htmlAvisos(e)}
      <div class="tarjeta">
        <h3>Tu cuenta</h3>
        ${items}
        <div class="fila total"><span>Total</span><span>${this.plata(e.cuenta.total)}</span></div>
      </div>
      <div class="tarjeta" id="pago">${this.htmlPago(e)}</div>`;
    if (pasaAListo || llamadoNuevo) this.avisarListo(llamadoNuevo && !pasaAListo);
    this.etapaAnterior = e.etapa;
    this.llamadoAnterior = e.llamado_en || '';
  },

  // ¿Cómo te avisamos? Solo mientras se prepara (o listo y sin retirar)
  htmlAvisos(e) {
    if (!['preparando', 'listo'].includes(e.etapa)) return '';
    const wa = e.aviso_whatsapp;
    const whatsapp = !wa ? '' : wa.anotado
      ? '<div class="aviso-ok"><i class="fab fa-whatsapp"></i> Te avisamos por WhatsApp</div>'
      : `<a class="boton wa" href="${this.esc(wa.link)}" target="_blank" rel="noopener"><i class="fab fa-whatsapp"></i> Avisame por WhatsApp</a>
         <p class="nota">Se abre tu WhatsApp con el mensaje escrito: solo tocá enviar. Así te llega aunque bloquees el celular.</p>`;
    const sonido = this.sonidoActivo
      ? '<div class="aviso-ok"><i class="fas fa-volume-high"></i> Sonido y vibración activados: dejá esta pantalla abierta</div>'
      : `<button class="boton principal" onclick="Seguimiento.activarAvisos()"><i class="fas fa-bell"></i> Activar sonido y vibración</button>`;
    return `<div class="tarjeta"><h3>¿Cómo te avisamos?</h3>${sonido}${whatsapp}
      ${!wa ? '<p class="nota">Dejá esta pantalla abierta. Si la cerrás, mirá la pantalla de retiro o preguntá con tu número.</p>' : ''}</div>`;
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
