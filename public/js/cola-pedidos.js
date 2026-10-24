// =============================================
// MORFI - Pedidos sin WiFi
// Si el celular del mozo pierde el WiFi del local al mandar un pedido o un agregado, queda guardado en el celular
// y se manda solo cuando vuelve la conexión (al volver el WiFi, cada 15 segundos y al abrir Morfi).
// Cada envío lleva una clave (X-Idempotencia): si el pedido había llegado y se perdió la respuesta, el servidor no
// lo duplica (src/idempotencia.js). Un pedido de mesa que choca con un pedido ya abierto en esa mesa se suma a él.
// =============================================

const ColaPedidos = {
  CLAVE: 'morfi_cola_pedidos',
  enviando: false,

  leer() {
    try { return JSON.parse(localStorage.getItem(this.CLAVE) || '[]'); } catch (e) { return []; }
  },

  escribir(lista) {
    try { localStorage.setItem(this.CLAVE, JSON.stringify(lista)); } catch (e) { /* sin espacio: queda lo anterior */ }
    this.pintar();
  },

  // Clave al azar. crypto.randomUUID no existe en http://192.168... (no es contexto seguro); getRandomValues sí
  nuevaClave() {
    const b = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  },

  async enviarOGuardar(method, url, data, descripcion) {
    const clave = this.nuevaClave();
    try {
      return await API.request(method, url, data, null, { 'X-Idempotencia': clave });
    } catch (err) {
      if (!err.sinConexion) throw err;
      // Se guarda con el token de quien lo tomó: el pedido sale a su nombre aunque después entre otro
      this.escribir([...this.leer(), { method, url, data, clave, descripcion, token: API.getToken(), creado: Date.now() }]);
      return { encolado: true };
    }
  },

  async enviarPendientes() {
    if (this.enviando || !this.leer().length) return;
    this.enviando = true;
    try {
      for (const op of this.leer()) {
        // Pedido nuevo de mesa: si la mesa se abrió mientras tanto, se suma a ese pedido (no se pierde)
        const data = op.url === '/pedidos' && op.data && op.data.mesa_id ? { ...op.data, sumar_si_mesa_abierta: true } : op.data;
        let r;
        try {
          r = await fetch('/api' + op.url, { method: op.method, body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + op.token, 'X-Idempotencia': op.clave } });
        } catch (e) { break; } // sigue sin conexión: se reintenta más tarde, en el mismo orden
        const body = await r.json().catch(() => ({}));
        if (r.status === 409 && body.en_proceso) break;
        this.escribir(this.leer().filter(x => x.clave !== op.clave));
        if (r.ok) {
          App.showToast(`${op.descripcion}: enviado${body.numero_pedido ? ` (${body.numero_pedido}${body.agregado_a_mesa ? ', sumado a la mesa' : ''})` : ''}`, 'success');
        } else {
          App.showToast(`${op.descripcion}: no se pudo enviar (${body.error || 'error ' + r.status}). Cargalo de nuevo.`, 'error', 15000);
        }
      }
    } finally {
      this.enviando = false;
      this.pintar();
    }
  },

  // Aviso fijo mientras haya algo sin enviar
  pintar() {
    const n = this.leer().length;
    let el = document.getElementById('colaPedidos');
    if (!n) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'colaPedidos';
      el.className = 'cola-pedidos';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.innerHTML = `<i class="fas fa-wifi"></i> ${n === 1 ? '1 pedido guardado' : n + ' pedidos guardados'} en este celular: se envían solos al volver el WiFi.
      <button type="button" class="btn btn-sm btn-outline" onclick="ColaPedidos.enviarPendientes()">Reintentar</button>`;
  },

  iniciar() {
    window.addEventListener('online', () => this.enviarPendientes());
    setInterval(() => this.enviarPendientes(), 15000);
    this.pintar();
    this.enviarPendientes();
  }
};

document.addEventListener('DOMContentLoaded', () => ColaPedidos.iniciar());
