// =============================================
// FADIDO - Barras que se deslizan de costado (categorías del POS y de la carta, momentos, destacados, sugerencias)
// Con el dedo ya andaban; con mouse costaba. Acá:
// - la rueda del mouse las mueve de costado (cuando llegan al final, sigue bajando la página),
// - se pueden arrastrar con el mouse (sin que el arrastre cuente como clic),
// - un degradé en el borde avisa que hay más para un lado o el otro,
// - cuando la pantalla se vuelve a dibujar (POS al elegir categoría) quedan donde estaban, con la elegida a la vista.
// Se engancha sola a las barras que aparecen en la página (MutationObserver).
// =============================================
(function () {
  const SELECTOR = '.pos-categories, .mobile-cat-scroll, .momentos-carta, .destacados-fila, .sugerencias-lista, [data-desliza]';
  const UMBRAL_ARRASTRE = 6;   // px: menos que esto es un clic
  const BORDE = 2;             // px de tolerancia para "llegó al final"
  const posiciones = new Map(); // dónde quedó cada barra, para cuando se vuelve a dibujar

  const clave = el => el.id || el.className.split(/\s+/).find(c => c && !c.startsWith('desliza')) || 'barra';
  const maximo = el => el.scrollWidth - el.clientWidth;

  function marcarBordes(el) {
    const max = maximo(el);
    el.classList.toggle('desliza-izq', max > BORDE && el.scrollLeft > BORDE);
    el.classList.toggle('desliza-der', max > BORDE && el.scrollLeft < max - BORDE);
  }

  // La opción elegida (botón .active o aria-selected) a la vista, sin mover la página
  function mostrarElegida(el) {
    const activa = el.querySelector('.active, [aria-selected="true"]');
    if (!activa) return;
    const izq = activa.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft;
    if (izq < el.scrollLeft) el.scrollLeft = Math.max(0, izq - 16);
    else if (izq + activa.offsetWidth > el.scrollLeft + el.clientWidth) el.scrollLeft = izq + activa.offsetWidth - el.clientWidth + 16;
  }

  function rueda(e) {
    const el = e.currentTarget;
    if (e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX) || maximo(el) <= BORDE) return;
    const paso = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    const puede = paso > 0 ? el.scrollLeft < maximo(el) - BORDE : el.scrollLeft > BORDE;
    if (!puede) return; // en el final: que siga bajando la página
    e.preventDefault();
    el.scrollLeft += paso;
  }

  function arrastre(e) {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    const el = e.currentTarget;
    if (maximo(el) <= BORDE) return;
    const inicioX = e.clientX, inicioScroll = el.scrollLeft;
    let arrastrando = false;
    const mover = ev => {
      const dx = ev.clientX - inicioX;
      if (!arrastrando && Math.abs(dx) < UMBRAL_ARRASTRE) return;
      if (!arrastrando) { arrastrando = true; el.classList.add('desliza-arrastrando'); }
      el.scrollLeft = inicioScroll - dx;
    };
    const soltar = () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      window.removeEventListener('pointercancel', soltar);
      if (!arrastrando) return;
      el.classList.remove('desliza-arrastrando');
      // El clic que viene después de soltar no es un clic: se descarta (antes de que llegue al botón)
      const anular = ev => { ev.stopPropagation(); ev.preventDefault(); };
      el.addEventListener('click', anular, { capture: true, once: true });
      setTimeout(() => el.removeEventListener('click', anular, { capture: true }), 0);
    };
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
    window.addEventListener('pointercancel', soltar);
  }

  function enganchar(el) {
    if (el.dataset.deslizaLista) return;
    el.dataset.deslizaLista = '1';
    el.classList.add('desliza');
    const k = clave(el);
    if (posiciones.has(k)) el.scrollLeft = posiciones.get(k);
    mostrarElegida(el);
    el.addEventListener('wheel', rueda, { passive: false });
    el.addEventListener('pointerdown', arrastre);
    el.addEventListener('scroll', () => { posiciones.set(k, el.scrollLeft); marcarBordes(el); }, { passive: true });
    el.addEventListener('dragstart', e => e.preventDefault()); // imágenes y enlaces: que no se "agarren" al arrastrar
    marcarBordes(el);
    setTimeout(() => marcarBordes(el), 300); // fotos que terminan de cargar
  }

  function buscar(raiz) {
    if (raiz.nodeType !== 1) return;
    if (raiz.matches(SELECTOR)) enganchar(raiz);
    raiz.querySelectorAll(SELECTOR).forEach(enganchar);
  }

  function iniciar() {
    buscar(document.body);
    new MutationObserver(cambios => {
      for (const c of cambios) for (const n of c.addedNodes) buscar(n);
    }).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', () => document.querySelectorAll('.desliza').forEach(marcarBordes));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
