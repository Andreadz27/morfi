// Video de lanzamiento de Fadido (~1 minuto, 1920x1080): textos animados, capturas reales del sistema en marco de
// navegador y de celular, voz en off y música suave. No es una grabación de pantalla: cada cuadro se dibuja con
// su tiempo exacto (render(t)) y se le pasa a ffmpeg, así las animaciones salen perfectas.
// Requiere las capturas de la demo (npm run demo:video), ffmpeg y edge-tts (pip install edge-tts).
//
// Uso: npm run demo:promo
// Salida: demo/salida/promo/fadido-promo.mp4 (voz y música), fadido-promo-solo-voz.mp4 y portada-promo.jpg
'use strict';
const { spawn, spawnSync, execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { generar, wav } = require('./musica-promo');

const RAIZ = path.join(__dirname, '..', '..');
const SALIDA = path.join(RAIZ, 'demo', 'salida');
const DESTINO = path.join(SALIDA, 'promo');
const TRABAJO = path.join(DESTINO, '.trabajo');
const CACHE_VOZ = path.join(SALIDA, '.voz');
const FPS = 30, ANCHO = 1920, ALTO = 1080;
const VOZ = process.env.GM_DEMO_VOZ || 'es-AR-ElenaNeural';
const CANAL = process.env.GM_E2E_NAVEGADOR || (process.platform === 'win32' ? 'msedge' : 'chrome');
// Contacto del cierre: el mismo WhatsApp de la landing
const WHATSAPP = process.env.GM_PROMO_WHATSAPP || '11 2390-0155';

// ---------- Guion ----------
// voz: lo que dice la locutora; min: segundos mínimos de la escena (si la voz es más larga, la escena se estira)
const ESCENAS = [
  { tipo: 'texto', min: 4.2, lineas: ['¿Mesas esperando?', '¿Comandas que se pierden?', '¿Una caja que <em>no cierra</em>?'],
    voz: '¿Mesas esperando, comandas que se pierden... y una caja que nunca cierra?' },
  { tipo: 'logo', min: 4.2, insignia: 'Lanzamiento', voz: 'Llegó Fadido: el sistema que pone tu negocio a punto.' },
  { tipo: 'pantalla', min: 4.2, kicker: 'Punto de venta', titulo: 'Tomás el pedido<br>en <em>segundos</em>', captura: '04-punto-de-venta',
    voz: 'Tomás el pedido en segundos, y la comanda vuela a la cocina.' },
  { tipo: 'pantalla', min: 3.6, kicker: 'Cocina', titulo: 'La cocina lo ve<br><em>al instante</em>', captura: '05-cocina', extra: '14-pantalla-cocina',
    voz: 'La cocina lo ve al instante, con cada nota.', lado: 'izq' },
  { tipo: 'celular', min: 4.2, kicker: 'Carta QR', titulo: 'Tus clientes piden<br><em>desde la mesa</em>', captura: '15-carta-celular',
    voz: 'Tus clientes piden desde el QR, sin pagarle comisión a nadie.' },
  { tipo: 'pantalla', min: 4.2, kicker: 'Cobro y caja', titulo: 'Cobrás fácil.<br>La caja <em>cierra sola</em>', captura: '06b-cobro', extra: '08-caja',
    voz: 'Cobrás con efectivo, tarjeta o Mercado Pago, y la caja cierra sola.' },
  { tipo: 'pantalla', min: 4.2, kicker: 'Recetas y costos', titulo: 'Sabés cuánto te deja<br><em>cada plato</em>', captura: '09b-sub-receta', extra: '09-rentabilidad',
    voz: 'Sabés cuánto te cuesta cada plato... y cuánto te deja.', lado: 'izq' },
  { tipo: 'pantalla', min: 4.2, kicker: 'Dashboard y contabilidad', titulo: 'Tus números,<br><em>en tiempo real</em>', captura: '02-dashboard', extra: '16-contabilidad-resultados',
    voz: 'Y todos tus números, en tiempo real, desde donde estés.' },
  { tipo: 'grilla', min: 4.6, titulo: 'Todo tu local, <em>en un solo sistema</em>',
    chips: ['Punto de venta', 'Mesas y reservas', 'Cocina en pantalla', 'Delivery y WhatsApp', 'Carta QR', 'Caja y arqueo', 'Recetas y stock', 'Facturación ARCA'],
    voz: 'Para restaurantes, bares, cafés y heladerías. Todo, en un solo sistema.' },
  { tipo: 'cierre', min: 5.5, insignia: 'Ya disponible', voz: 'Fadido ya está disponible. Pedí tu demo gratis... y poné tu negocio a punto.' }
];
const FUNDIDO = 0.38; // cada escena entra y sale fundiéndose con el fondo

// ---------- Herramientas ----------
function buscarFfmpeg() {
  const candidatos = [process.env.FFMPEG, 'ffmpeg'];
  const winget = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
  if (fs.existsSync(winget)) {
    for (const pkg of fs.readdirSync(winget).filter(d => /ffmpeg/i.test(d))) {
      for (const sub of fs.readdirSync(path.join(winget, pkg))) candidatos.push(path.join(winget, pkg, sub, 'bin', 'ffmpeg.exe'));
    }
  }
  for (const c of candidatos.filter(Boolean)) { try { execFileSync(c, ['-version'], { stdio: 'ignore' }); return c; } catch (e) {} }
  return null;
}
function buscarEdgeTts() {
  for (const c of [process.env.EDGE_TTS, 'edge-tts'].filter(Boolean)) {
    if (spawnSync(c, ['--help'], { stdio: 'ignore' }).status === 0) return [c];
  }
  for (const py of ['python', 'python3', 'py']) {
    if (spawnSync(py, ['-m', 'edge_tts', '--help'], { stdio: 'ignore' }).status === 0) return [py, '-m', 'edge_tts'];
  }
  return null;
}
const duracionMs = (ffmpeg, archivo) => {
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(spawnSync(ffmpeg, ['-hide_banner', '-i', archivo], { encoding: 'utf8' }).stderr);
  return m ? Math.round(((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000) : 0;
};
// Voz de una frase (con caché, como el recorrido): tono de publicidad, apenas más ágil que la charla
function voz(edgeTts, ffmpeg, texto) {
  const archivo = path.join(CACHE_VOZ, 'promo-' + crypto.createHash('sha1').update(VOZ + '|+4%|' + texto).digest('hex').slice(0, 16) + '.mp3');
  let dur = fs.existsSync(archivo) ? duracionMs(ffmpeg, archivo) : 0;
  for (let i = 1; !dur && i <= 4; i++) {
    fs.rmSync(archivo, { force: true });
    try {
      execFileSync(edgeTts[0], [...edgeTts.slice(1), '--voice', VOZ, '--rate=+4%', '--text', texto, '--write-media', archivo], { stdio: 'ignore' });
      dur = duracionMs(ffmpeg, archivo);
    } catch (e) { if (i === 4) throw e; }
  }
  if (!dur) throw new Error(`edge-tts no generó el audio de: ${texto}`);
  return { archivo, ms: dur };
}

// ---------- Página que dibuja el video ----------
// Cada logo con su propio degradado: si dos comparten id y el primero está oculto, el segundo sale sin fondo
const LOGO = id => `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fb923c"/>
  <stop offset=".55" stop-color="#f97316"/><stop offset="1" stop-color="#e11d48"/></linearGradient></defs><rect width="64" height="64" rx="15" fill="url(#${id})"/>
  <g fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round"><path d="M15 46V32a8.5 8.5 0 0 1 17 0v14M32 32a8.5 8.5 0 0 1 17 0v14" stroke-width="6.5"/>
  <path d="M10 50.5h44" stroke-width="4"/><path class="vapor" d="M23.5 17c-2-2 2-3.5 0-5.5M40.5 17c-2-2 2-3.5 0-5.5" stroke-width="2.6"/></g></svg>`;

function htmlEscena(e, i) {
  const a = (t, anim, extra = '') => `data-t="${t}" data-a="${anim}" ${extra}`;
  const texto = (kicker, titulo) => `<div class="texto">
      <div class="kicker" ${a(0.25, 'sube')}>${kicker}</div>
      <h2 ${a(0.4, 'sube')}>${titulo}</h2>
      <div class="raya" ${a(0.7, 'ancho')}></div></div>`;
  const navegador = (captura, clase, t) => `<div class="navegador ${clase}" ${a(t, clase === 'principal' ? 'entra' : 'flota')}>
      <div class="barra"><i></i><i></i><i></i><span>fadido</span></div><div class="vista"><img src="capturas/${captura}.png" data-kb></div></div>`;
  let cuerpo = '';
  if (e.tipo === 'texto') {
    cuerpo = `<div class="pregunta">${e.lineas.map((l, k) => `<div ${a(0.2 + k * 0.85, 'sube')}>${l}</div>`).join('')}</div>`;
  } else if (e.tipo === 'logo') {
    cuerpo = `<div class="marca"><div class="insignia" ${a(1.4, 'pop')}>${e.insignia}</div><div class="logo" ${a(0.1, 'logo')}>${LOGO('logo' + i)}</div>
      <div class="nombre" ${a(0.55, 'sube')}>fadido</div><div class="lema" ${a(0.95, 'sube')}>Tu negocio, <em>a punto.</em></div></div>`;
  } else if (e.tipo === 'pantalla') {
    cuerpo = `<div class="pantalla ${e.lado === 'izq' ? 'invertida' : ''}">${texto(e.kicker, e.titulo)}
      <div class="escenario">${navegador(e.captura, 'principal', 0.15)}${e.extra ? navegador(e.extra, 'secundaria', 1.6) : ''}</div></div>`;
  } else if (e.tipo === 'celular') {
    cuerpo = `<div class="pantalla">${texto(e.kicker, e.titulo)}
      <div class="escenario"><div class="telefono" ${a(0.15, 'entra')}><div class="isla"></div><img src="capturas/${e.captura}.png" data-kb></div></div></div>`;
  } else if (e.tipo === 'grilla') {
    cuerpo = `<div class="grilla"><h2 ${a(0.15, 'sube')}>${e.titulo}</h2>
      <div class="chips">${e.chips.map((c, k) => `<span ${a(0.6 + k * 0.16, 'pop')}>${c}</span>`).join('')}</div></div>`;
  } else if (e.tipo === 'cierre') {
    cuerpo = `<div class="marca cierre"><div class="insignia" ${a(0.3, 'pop')}>${e.insignia}</div><div class="logo" ${a(0.1, 'logo')}>${LOGO('logo' + i)}</div>
      <div class="nombre" ${a(0.45, 'sube')}>fadido</div><div class="lema" ${a(0.8, 'sube')}>Tu negocio, <em>a punto.</em></div>
      <div class="cta" ${a(1.5, 'pop')}>Pedí tu demo gratis</div>
      <div class="contacto" ${a(2.1, 'sube')}><b>WhatsApp</b> ${WHATSAPP}</div></div>`;
  }
  return `<section class="escena escena-${e.tipo}" data-i="${i}">${cuerpo}</section>`;
}

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${ANCHO}px;height:${ALTO}px;overflow:hidden;background:#0b0f19;font-family:Inter,'Segoe UI',system-ui,sans-serif;color:#fff;
  -webkit-font-smoothing:antialiased}
#fondo{position:absolute;inset:0;background:
  radial-gradient(900px 700px at var(--fx,20%) var(--fy,15%),rgba(249,115,22,.30),transparent 60%),
  radial-gradient(800px 650px at var(--gx,85%) var(--gy,90%),rgba(225,29,72,.22),transparent 60%),
  linear-gradient(160deg,#0b0f19,#111827 55%,#0b0f19)}
#grano{position:absolute;inset:0;opacity:.05;background-image:radial-gradient(#fff 1px,transparent 1px);background-size:4px 4px}
.escena{position:absolute;inset:0;display:none;align-items:center;justify-content:center}
em{font-style:normal;background:linear-gradient(90deg,#fb923c,#f97316 45%,#f43f5e);-webkit-background-clip:text;background-clip:text;color:transparent}
[data-a]{will-change:transform,opacity}
.pregunta{display:grid;gap:18px;text-align:center;font-weight:900;font-size:96px;letter-spacing:-3px;line-height:1.05}
.pregunta div:nth-child(2){color:#cbd5e1}
.marca{display:grid;justify-items:center;gap:6px;text-align:center}
.marca .logo svg{width:220px;height:220px;filter:drop-shadow(0 30px 60px rgba(249,115,22,.45))}
.marca .nombre{font-weight:900;font-size:150px;letter-spacing:-7px;line-height:1;margin-top:18px}
.marca .lema{font-weight:700;font-size:54px;letter-spacing:-1.5px;color:#e2e8f0}
.insignia{order:-1;margin-bottom:34px;padding:12px 30px;border-radius:999px;border:2px solid rgba(251,146,60,.7);color:#fdba74;
  background:rgba(249,115,22,.12);font-size:24px;font-weight:800;letter-spacing:6px;text-transform:uppercase}
.cierre .logo svg{width:170px;height:170px}.cierre .nombre{font-size:120px}
.cta{margin-top:44px;padding:24px 56px;border-radius:999px;font-weight:800;font-size:42px;letter-spacing:-.5px;
  background:linear-gradient(90deg,#f97316,#e11d48);box-shadow:0 20px 60px rgba(249,115,22,.45)}
.contacto{margin-top:26px;font-size:36px;font-weight:600;color:#cbd5e1}.contacto b{color:#fff;margin-right:10px}
.pantalla{width:100%;height:100%;display:grid;grid-template-columns:560px 1fr;align-items:center;gap:70px;padding:0 110px 0 130px}
.pantalla.invertida{grid-template-columns:1fr 560px;padding:0 130px 0 110px}
.pantalla.invertida .texto{order:2}
.texto{display:grid;gap:22px;position:relative;z-index:3}
.kicker{font-size:26px;font-weight:700;letter-spacing:5px;text-transform:uppercase;color:#fb923c}
.texto h2{font-size:84px;font-weight:900;letter-spacing:-3.5px;line-height:1.02}
.raya{height:6px;width:120px;border-radius:6px;background:linear-gradient(90deg,#f97316,#e11d48);transform-origin:left}
.escenario{position:relative;height:100%;display:flex;align-items:center;justify-content:center;perspective:2200px}
.navegador{position:absolute;width:960px;border-radius:18px;overflow:hidden;background:#1e293b;
  box-shadow:0 50px 120px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.08)}
.navegador .barra{height:44px;display:flex;align-items:center;gap:9px;padding:0 18px;background:#1e293b}
.navegador .barra i{width:13px;height:13px;border-radius:50%;background:#475569}
.navegador .barra i:nth-child(1){background:#f87171}.navegador .barra i:nth-child(2){background:#fbbf24}.navegador .barra i:nth-child(3){background:#34d399}
.navegador .barra span{margin-left:18px;padding:6px 18px;border-radius:8px;background:#0f172a;color:#94a3b8;font-size:16px;font-weight:600;flex:1;max-width:420px}
.navegador .vista{height:600px;overflow:hidden;background:#fff}
.navegador img{display:block;width:100%;transform-origin:50% 0}
.navegador.secundaria{width:520px;right:0;bottom:90px;transform-origin:right bottom}
.navegador.secundaria .vista{height:325px}
.invertida .navegador.secundaria{right:auto;left:0;transform-origin:left bottom}
.telefono{position:relative;width:410px;height:840px;border-radius:64px;padding:16px;background:#0f172a;
  box-shadow:0 60px 140px rgba(0,0,0,.6),0 0 0 3px #334155,inset 0 0 0 2px #1e293b;overflow:hidden}
.telefono img{width:100%;border-radius:48px;display:block;transform-origin:50% 0}
.telefono .isla{position:absolute;top:28px;left:50%;width:120px;height:34px;margin-left:-60px;border-radius:20px;background:#0f172a;z-index:2}
.grilla{display:grid;justify-items:center;gap:64px;padding:0 120px}
.grilla h2{font-size:88px;font-weight:900;letter-spacing:-3.5px;text-align:center}
.chips{display:grid;grid-template-columns:repeat(4,1fr);gap:22px;width:1560px}
.chips span{padding:30px 16px;white-space:nowrap;border-radius:22px;text-align:center;font-size:30px;font-weight:700;
  background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);box-shadow:0 20px 40px rgba(0,0,0,.25)}
.chips span::before{content:"✓";color:#fb923c;margin-right:14px}
`;

// render(t): estado exacto de cada elemento en el segundo t (sin animaciones CSS: el video sale igual siempre)
const MOTOR = `
const sale = x => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const rebote = x => { x = Math.min(1, Math.max(0, x)); const c = 1.70158; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
function render(t) {
  const fondo = document.getElementById('fondo');
  fondo.style.setProperty('--fx', (20 + 8 * Math.sin(t / 5)) + '%'); fondo.style.setProperty('--fy', (15 + 6 * Math.cos(t / 6)) + '%');
  fondo.style.setProperty('--gx', (85 - 8 * Math.sin(t / 7)) + '%'); fondo.style.setProperty('--gy', (90 - 6 * Math.cos(t / 4)) + '%');
  for (const s of document.querySelectorAll('.escena')) {
    const e = TIEMPOS[s.dataset.i];
    const local = t - e.desde;
    if (t < e.desde || t >= e.hasta) { s.style.display = 'none'; continue; }
    s.style.display = 'flex';
    const entrada = sale(local / ${FUNDIDO}), salida = e.ultima ? 1 : sale((e.hasta - t) / ${FUNDIDO});
    s.style.opacity = Math.min(entrada, salida);
    s.style.transform = 'scale(' + (1.015 - 0.015 * entrada + 0.02 * (1 - salida)) + ')';
    for (const el of s.querySelectorAll('[data-a]')) {
      const p = (local - Number(el.dataset.t)) / 0.75;
      const k = sale(p), op = Math.min(1, Math.max(0, p * 1.6));
      switch (el.dataset.a) {
        case 'sube': el.style.opacity = op; el.style.transform = 'translateY(' + (40 * (1 - k)) + 'px)'; break;
        case 'ancho': el.style.opacity = op; el.style.transform = 'scaleX(' + k + ')'; break;
        case 'pop': el.style.opacity = op; el.style.transform = 'scale(' + (0.6 + 0.4 * rebote(p)) + ')'; break;
        case 'logo': el.style.opacity = op; el.style.transform = 'scale(' + (0.4 + 0.6 * rebote(p * 0.9)) + ') rotate(' + (-12 * (1 - k)) + 'deg)'; break;
        case 'entra': { const g = s.querySelector('.invertida') ? -1 : 1; const q = sale((local - Number(el.dataset.t)) / 1.1);
          el.style.opacity = Math.min(1, q * 2);
          el.style.transform = 'translateX(' + (g * 140 * (1 - q)) + 'px) rotateY(' + (g * (-10 + 6 * q)) + 'deg) rotateX(2deg)'; break; }
        case 'flota': el.style.opacity = op; el.style.transform = 'translateY(' + (90 * (1 - k) - 6 * Math.sin(local * 1.4)) + 'px) scale(' + (0.92 + 0.08 * k) + ')'; break;
      }
    }
    // Ken Burns: las capturas se acercan despacio
    const dur = e.hasta - e.desde;
    for (const img of s.querySelectorAll('[data-kb]')) img.style.transform = 'scale(' + (1.02 + 0.07 * local / dur) + ')';
  }
}`;

(async () => {
  const ffmpeg = buscarFfmpeg();
  const edgeTts = buscarEdgeTts();
  if (!ffmpeg || !edgeTts) throw new Error('Hacen falta ffmpeg y edge-tts (pip install edge-tts)');
  const capturas = path.join(SALIDA, 'capturas');
  for (const e of ESCENAS) for (const c of [e.captura, e.extra].filter(Boolean)) {
    if (!fs.existsSync(path.join(capturas, c + '.png'))) throw new Error(`Falta la captura ${c}: corré primero "npm run demo:video"`);
  }
  fs.rmSync(DESTINO, { recursive: true, force: true });
  fs.mkdirSync(TRABAJO, { recursive: true });
  fs.mkdirSync(CACHE_VOZ, { recursive: true });
  fs.cpSync(capturas, path.join(TRABAJO, 'capturas'), { recursive: true });

  console.log('1/4 Voz en off...');
  // Cada escena dura lo que pide el guion o lo que dura su frase (más un respiro); la voz entra apenas empieza
  const tiempos = [];
  let t = 0;
  for (const [i, e] of ESCENAS.entries()) {
    const v = voz(edgeTts, ffmpeg, e.voz);
    const dur = Math.max(e.min, v.ms / 1000 + 1.0) + (i === ESCENAS.length - 1 ? 1.2 : 0);
    tiempos.push({ desde: t, hasta: t + dur, voz: v, entraVoz: t + 0.3, ultima: i === ESCENAS.length - 1 });
    t += dur;
  }
  const total = tiempos[tiempos.length - 1].hasta;

  console.log(`2/4 Dibujando ${Math.ceil(total * FPS)} cuadros (${total.toFixed(1)} s)...`);
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@600;700;800;900&display=swap" rel="stylesheet"><style>${CSS}</style></head>
    <body><div id="fondo"></div><div id="grano"></div>${ESCENAS.map(htmlEscena).join('')}
    <script>const TIEMPOS = ${JSON.stringify(tiempos.map(({ desde, hasta, ultima }) => ({ desde, hasta, ultima })))};${MOTOR}</script></body></html>`;
  fs.writeFileSync(path.join(TRABAJO, 'promo.html'), html);
  const navegador = await chromium.launch({ channel: CANAL, headless: true });
  const page = await navegador.newPage({ viewport: { width: ANCHO, height: ALTO } });
  page.on('pageerror', e => console.error('  error en la página:', e.message));
  await page.goto('file:///' + path.join(TRABAJO, 'promo.html').replace(/\\/g, '/'));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every(i => i.complete));

  const mudo = path.join(TRABAJO, 'video.mp4');
  const codificador = spawn(ffmpeg, ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
    // Las capturas JPEG vienen en rango completo: se pasan al rango de video estándar (colores fieles en redes y celulares)
    '-vf', 'scale=in_range=pc:out_range=tv,format=yuv420p', '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-movflags', '+faststart', mudo], { stdio: ['pipe', 'inherit', 'inherit'] });
  const cuadros = Math.ceil(total * FPS);
  for (let f = 0; f < cuadros; f++) {
    await page.evaluate(s => window.render(s), f / FPS);
    const jpg = await page.screenshot({ type: 'jpeg', quality: 95 });
    if (!codificador.stdin.write(jpg)) await new Promise(r => codificador.stdin.once('drain', r));
    if (f === Math.round(tiempos[ESCENAS.length - 1].desde * FPS + 2.6 * FPS)) fs.writeFileSync(path.join(DESTINO, 'portada-promo.jpg'), jpg);
    if (f % (FPS * 10) === 0) console.log(`   ${Math.round(f / FPS)} s`);
  }
  codificador.stdin.end();
  await new Promise((ok, mal) => codificador.on('exit', c => c ? mal(new Error('ffmpeg falló al codificar')) : ok()));
  await navegador.close();

  console.log('3/4 Música...');
  const musica = path.join(TRABAJO, 'musica.wav');
  fs.writeFileSync(musica, wav(generar(total)));

  console.log('4/4 Mezcla...');
  const voces = tiempos.map(x => ({ archivo: x.voz.archivo, ms: Math.round(x.entraVoz * 1000) }));
  const entradas = voces.flatMap(v => ['-i', v.archivo]);
  const filtroVoz = voces.map((v, i) => `[${i + 1}:a]aresample=44100,adelay=${v.ms}:all=1[v${i}]`).join(';') + ';' +
    voces.map((v, i) => `[v${i}]`).join('') + `amix=inputs=${voces.length}:normalize=0,volume=1.6,apad[voz]`;
  // Volumen de redes sociales: -14 LUFS, picos por debajo de -1,5 dB
  const NORMA = 'loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000';
  // Solo voz
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-i', mudo, ...entradas, '-filter_complex', filtroVoz + `;[voz]${NORMA}[final]`,
    '-map', '0:v', '-map', '[final]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', path.join(DESTINO, 'fadido-promo-solo-voz.mp4')]);
  // Voz y música: la música baja sola mientras habla la locutora (sidechain)
  const m = voces.length + 1;
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-i', mudo, ...entradas, '-i', musica, '-filter_complex',
    filtroVoz.replace('[voz]', '[vozpre]') + `;[vozpre]asplit=2[voz][llave];[${m}:a]volume=0.32[mus];` +
    '[mus][llave]sidechaincompress=threshold=0.03:ratio=6:attack=40:release=450[musduck];' +
    `[voz][musduck]amix=inputs=2:normalize=0,${NORMA}[mezcla]`,
    '-map', '0:v', '-map', '[mezcla]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', path.join(DESTINO, 'fadido-promo.mp4')]);
  fs.rmSync(TRABAJO, { recursive: true, force: true });
  const mb = f => (fs.statSync(path.join(DESTINO, f)).size / 1048576).toFixed(1) + ' MB';
  console.log(`Listo en demo/salida/promo: fadido-promo.mp4 (${mb('fadido-promo.mp4')}, ${total.toFixed(1)} s), fadido-promo-solo-voz.mp4 y portada-promo.jpg`);
})().catch(e => { console.error('Error armando el promo:', e.message); process.exit(1); });
