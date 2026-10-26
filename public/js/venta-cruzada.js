// =============================================
// MORFI - Venta cruzada (la usan la carta del QR y el punto de venta)
// - Acompañalo con: productos de las categorías que se sugieren con la del producto agregado
//   (primero los recomendados, los más pedidos y los nuevos).
// - ¿Lo querés grande?: la versión grande del producto.
// - Te conviene la promo: si el carrito arma un combo por separado y el combo sale más barato.
// Solo sugiere: los precios los calcula siempre el servidor.
// =============================================

const VentaCruzada = {
  // Horario { dias, desde, hasta } (o su JSON): se puede pedir ahora (hora del dispositivo)
  disponible(horario, ahora = new Date()) {
    let h = horario;
    if (typeof h === 'string') { try { h = h ? JSON.parse(h) : null; } catch (e) { h = null; } }
    if (!h) return true;
    const hora = String(ahora.getHours()).padStart(2, '0') + ':' + String(ahora.getMinutes()).padStart(2, '0');
    return h.dias.includes(ahora.getDay()) && h.desde <= hora && hora < h.hasta;
  },

  combo(p) {
    let c = p && p.combo;
    if (typeof c === 'string') { try { c = c ? JSON.parse(c) : null; } catch (e) { c = null; } }
    return c && Array.isArray(c.componentes) && c.componentes.length ? c : null;
  },

  // Hasta 3 productos para acompañar al que se agregó (de las categorías que sugiere la suya)
  acompanar(prod, productos, categorias, enCarrito = [], cantidad = 3) {
    const cat = categorias.find(c => c.id === prod.categoria_id);
    let sugerir = cat && cat.sugerir;
    if (typeof sugerir === 'string') sugerir = sugerir ? sugerir.split(',').map(Number) : [];
    if (!sugerir || !sugerir.length) return [];
    const ya = new Set(enCarrito);
    const puntaje = p => (p.recomendado ? 4 : 0) + (p.mas_pedido ? 3 : 0) + (p.nuevo ? 1 : 0);
    return productos
      .filter(p => sugerir.includes(p.categoria_id) && p.id !== prod.id && !ya.has(p.id) && !this.combo(p) && p.precio_venta > 0 &&
        (p.disponible === undefined ? this.disponible(p.horario) : p.disponible))
      .map((p, i) => ({ p, i, orden: sugerir.indexOf(p.categoria_id) }))
      .sort((a, b) => puntaje(b.p) - puntaje(a.p) || a.orden - b.orden || a.i - b.i)
      .slice(0, cantidad).map(x => x.p);
  },

  grande(prod, productos) {
    if (!prod || !prod.version_grande_id) return null;
    const g = productos.find(p => p.id === prod.version_grande_id);
    return g && g.precio_venta > prod.precio_venta ? g : null;
  },

  // El combo que más conviene con lo que hay en el carrito: { combo, ahorro, usar: [{ linea, cantidad }] }
  // carrito: [{ producto_id, cantidad }] (cada línea puede tener opciones; se cuentan por producto)
  comboConveniente(carrito, productos) {
    let mejor = null;
    for (const p of productos) {
      const c = this.combo(p);
      if (!c || !(p.disponible === undefined ? this.disponible(p.horario) : p.disponible)) continue;
      const libres = carrito.map(l => l.cantidad);
      const usar = [];
      let separado = 0;
      const arma = c.componentes.every(comp => {
        let falta = comp.cantidad;
        carrito.forEach((l, idx) => {
          if (!falta || !comp.productos.includes(l.producto_id) || !libres[idx]) return;
          const n = Math.min(falta, libres[idx]);
          libres[idx] -= n; falta -= n;
          usar.push({ linea: idx, cantidad: n });
          const prodLinea = productos.find(x => x.id === l.producto_id);
          separado += n * (prodLinea ? Number(prodLinea.precio_venta) || 0 : 0);
        });
        return falta === 0;
      });
      const ahorro = Math.round((separado - (Number(p.precio_venta) || 0)) * 100) / 100;
      if (arma && ahorro > 0 && (!mejor || ahorro > mejor.ahorro)) mejor = { combo: p, ahorro, usar };
    }
    return mejor;
  }
};
