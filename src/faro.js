/* Widgets y final del caso «La última guardia de Punta do Cabo» (faro_cabo).
   Ninguno muestra la respuesta: ayudan a razonar (cielo y palmos, órdenes y mareas,
   óptica giratoria y carta para trazar rumbos). El estado vive en `estado`, un objeto
   por sala que main.js conserva mientras dure la visita. */

const e = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rad = g => g * Math.PI / 180;
const tres = n => String(((Math.round(n) % 360) + 360) % 360).padStart(3, '0');
const pal = n => (Number.isInteger(n) ? String(n) : String(n).replace('.', ','));

export const TIPOS_FARO = ['cielo', 'ordenes', 'optica', 'carta'];

/* ---------- Sala 1 · Cielo: localizar la Polar y medir con palmos ---------- */
const CIELO = {
  polar: [180, 54],
  osa: [[150, 164, 'Dubhe'], [144, 186, 'Merak'], [100, 194, ''], [104, 168, ''], [76, 156, ''], [52, 146, ''], [26, 126, '']],
  casiopea: [[246, 104], [264, 124], [284, 108], [302, 128], [322, 104]],
  sueltas: [[40, 40], [92, 74], [222, 34], [330, 56], [300, 176], [212, 150], [60, 206], [338, 200]],
  horizonte: 232, palmoPx: 28,
};
function estrellasCielo() {
  const lista = [{ id: 'polar', x: CIELO.polar[0], y: CIELO.polar[1], r: 3.4 }];
  CIELO.osa.forEach(([x, y], i) => lista.push({ id: 'osa' + i, x, y, r: i < 2 ? 3.2 : 2.8 }));
  CIELO.casiopea.forEach(([x, y], i) => lista.push({ id: 'cas' + i, x, y, r: 2.7 }));
  CIELO.sueltas.forEach(([x, y], i) => lista.push({ id: 'sue' + i, x, y, r: 1.6 }));
  return lista;
}
function cieloHtml(w, s) {
  const st = s[w.clave] || (s[w.clave] = { marcada: null, guia: false, proa: 0 });
  const H = CIELO.horizonte, P = CIELO.palmoPx;
  const marc = estrellasCielo().find(x => x.id === st.marcada);
  const pie = marc ? marc.x : null;
  const faroX = 180 + w.faro * P; // el faro está donde está, se marque la estrella que se marque
  const [dx, dy] = [CIELO.osa[0][0] - CIELO.osa[1][0], CIELO.osa[0][1] - CIELO.osa[1][1]];
  const guia = st.guia ? `<line x1="${CIELO.osa[1][0]}" y1="${CIELO.osa[1][1]}" x2="${CIELO.osa[0][0] + dx * 5.6}" y2="${CIELO.osa[0][1] + dy * 5.6}" stroke="#f6cd55" stroke-width="1.4" stroke-dasharray="4 5" opacity=".85"/>` : '';
  const estrellas = estrellasCielo().map(x => `<circle class="estrella${st.marcada === x.id ? ' sel' : ''}" data-estrella="${x.id}" cx="${x.x}" cy="${x.y}" r="${x.r}" tabindex="0" role="button" aria-label="Estrella" aria-pressed="${st.marcada === x.id}"/>
    <circle class="estrella-toque" data-estrella="${x.id}" cx="${x.x}" cy="${x.y}" r="13" aria-hidden="true"/>`).join('');
  let regla = '';
  if (pie !== null) {
    const marcas = [];
    for (let k = -6; k <= 6; k += 0.5) {
      const x = pie + k * P;
      if (x < 4 || x > 356) continue;
      marcas.push(`<line x1="${x}" y1="${H}" x2="${x}" y2="${H + (Number.isInteger(k) ? 12 : 6)}" stroke="#d3e0e5" stroke-width="1"/>`
        + (Number.isInteger(k) && k ? `<text x="${x}" y="${H + 24}" text-anchor="middle" font-size="9" fill="#9fb7c4">${Math.abs(k)}</text>` : ''));
    }
    regla = `<line x1="${pie}" y1="${marc.y + 8}" x2="${pie}" y2="${H}" stroke="#f6cd55" stroke-width="1" stroke-dasharray="2 4"/>
      <text x="${pie}" y="${H + 24}" text-anchor="middle" font-size="10" font-weight="700" fill="#f6cd55">0</text>${marcas.join('')}`;
  }
  const proaX = pie === null ? null : pie + st.proa * P;
  const proa = proaX === null ? '' : `<g aria-hidden="true"><path d="M${proaX - 9} ${H + 44} L${proaX} ${H + 30} L${proaX + 9} ${H + 44} Z" fill="#f6cd55"/>
    <text x="${proaX}" y="${H + 56}" text-anchor="middle" font-size="9" fill="#f6cd55">proa</text></g>`;
  const lect = pie === null ? 'Toca la estrella que tomarás como referencia.'
    : st.proa === 0 ? 'Proa: bajo la estrella marcada.'
    : `Proa: ${pal(Math.abs(st.proa))} palmo${Math.abs(st.proa) === 1 ? '' : 's'} a la ${st.proa < 0 ? 'izquierda' : 'derecha'} de la estrella marcada.`;
  return `<div class="engr faro-w" data-cielo="${e(w.clave)}" aria-label="Cielo sobre el muelle">
    <svg viewBox="0 0 360 300" role="img" aria-label="Cielo nocturno sobre el horizonte, con el faro a la derecha">
      <rect x="0" y="0" width="360" height="${H}" fill="#071826"/>
      <rect x="0" y="${H}" width="360" height="${300 - H}" fill="#0b2433"/>
      ${guia}${estrellas}
      <line x1="0" y1="${H}" x2="360" y2="${H}" stroke="#8aa6b3" stroke-width="1"/>
      <g aria-hidden="true"><rect x="${faroX - 4}" y="${H - 30}" width="8" height="30" fill="#d3e0e5"/>
        <rect x="${faroX - 6}" y="${H - 36}" width="12" height="7" fill="#f6cd55"/>
        <text x="${faroX}" y="${H - 42}" text-anchor="middle" font-size="9" fill="#d3e0e5">faro</text></g>
      ${regla}${proa}
    </svg>
    <p class="lect-faro" aria-live="polite">${e(lect)}</p>
    <div class="pasos">
      <button type="button" class="ghost" data-cielo-guia aria-pressed="${st.guia}">${st.guia ? 'Ocultar guía' : 'Guía de la Osa Mayor'}</button>
      <button type="button" class="ghost" data-proa="-0.5" ${pie === null ? 'disabled' : ''}>◀ Medio palmo</button>
      <button type="button" class="ghost" data-proa="0.5" ${pie === null ? 'disabled' : ''}>Medio palmo ▶</button>
    </div></div>`;
}
function conectarCielo(app, s, repintar) {
  const caja = app.querySelector('[data-cielo]');
  if (!caja) return;
  const st = s[caja.dataset.cielo];
  const marcar = id => { st.marcada = id; st.proa = 0; repintar(); };
  caja.querySelectorAll('[data-estrella]').forEach(el => {
    el.addEventListener('click', () => marcar(el.dataset.estrella));
    el.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); marcar(el.dataset.estrella); } });
  });
  caja.querySelector('[data-cielo-guia]').addEventListener('click', () => { st.guia = !st.guia; repintar(); });
  caja.querySelectorAll('[data-proa]').forEach(b => b.addEventListener('click', () => {
    st.proa = Math.max(-6, Math.min(6, st.proa + Number(b.dataset.proa)));
    repintar();
  }));
}

/* ---------- Sala 2 · Caseta: tres órdenes, una frase falsa y la regla de los doceavos ---------- */
const DOCEAVOS = [1, 2, 3, 3, 2, 1];
function ordenesHtml(w, s) {
  const st = s[w.clave] || (s[w.clave] = { autor: {}, fr: {}, horas: 0 });
  const notas = w.notas.map(n => `<label class="nota-orden"><input type="checkbox" data-autor="${e(n.de)}" ${st.autor[n.de] ? 'checked' : ''}>
    <span><b>${e(n.de)}</b> · ${e(n.oficio)}<br><small>Calado de la planeadora: ${e(n.calado)}</small></span></label>`).join('');
  const frases = w.frases.map((f, i) => `<div class="fila"><span>${e(f.de)}: «${e(f.texto)}»</span>
    <button type="button" class="ghost tf" data-orden-frase="${i}" aria-pressed="${!!st.fr[i]}">${st.fr[i] ? 'Falsa' : 'Verdadera'}</button></div>`).join('');
  const falsas = Object.values(st.fr).filter(Boolean).length;
  // Columnas de la regla de los doceavos: altura proporcional a los doceavos acumulados.
  const X0 = 34, AN = 46, BASE = 170, U = 12;
  let acum = 0;
  const cols = DOCEAVOS.map((d, i) => {
    const bloques = [];
    for (let k = 0; k < d; k++) {
      const y = BASE - (acum + k + 1) * U;
      bloques.push(`<rect x="${X0 + i * AN + 6}" y="${y}" width="${AN - 12}" height="${U - 2}" rx="2" data-h="${i}" class="${i < st.horas ? 'dz on' : 'dz'}"/>`);
    }
    acum += d;
    return bloques.join('') + `<text x="${X0 + i * AN + AN / 2}" y="${BASE + 14}" text-anchor="middle" font-size="9" class="t-suave">${i + 1}.ª h</text>`;
  }).join('');
  const subida = DOCEAVOS.slice(0, st.horas).reduce((a, b) => a + b, 0);
  return `<div class="engr faro-w" data-ordenes="${e(w.clave)}" aria-label="Órdenes y tabla de mareas">
    <p class="rot" style="margin:0">Las tres notas del pincho · marca quién pudo escribir la de verdad</p>
    <div class="cartas">${notas}</div>
    <p class="rot" style="margin:12px 0 0">Registro de visitas · solo una frase es falsa</p>
    <div class="cartas">${frases}</div>
    <p class="lect-faro" aria-live="polite">Frases marcadas como falsas: ${falsas}</p>
    <p class="rot" style="margin:12px 0 0">Subida de la marea desde la bajamar (${e(w.bajamar)})</p>
    <svg viewBox="0 0 340 190" role="img" aria-label="Regla de los doceavos: bloques de subida por hora">
      <line x1="${X0}" y1="${BASE}" x2="${X0 + 6 * AN}" y2="${BASE}" class="l-suave"/>${cols}</svg>
    <label for="horas-marea">Horas después de la bajamar: <span data-horas-txt>${st.horas}</span>
      <input id="horas-marea" type="range" min="0" max="6" step="1" value="${st.horas}"></label>
    <p class="lect-faro" aria-live="polite" data-subida-txt>Llevas ${subida} de 12 doceavos de la subida.</p></div>`;
}
function conectarOrdenes(app, s, repintar) {
  const caja = app.querySelector('[data-ordenes]');
  if (!caja) return;
  const st = s[caja.dataset.ordenes];
  caja.querySelectorAll('[data-autor]').forEach(c => c.addEventListener('change', () => { st.autor[c.dataset.autor] = c.checked; }));
  caja.querySelectorAll('[data-orden-frase]').forEach(b => b.addEventListener('click', () => {
    st.fr[b.dataset.ordenFrase] = !st.fr[b.dataset.ordenFrase];
    repintar();
  }));
  // El deslizador no se repinta: solo cambian los bloques y los textos, para no cortar el arrastre.
  const r = caja.querySelector('#horas-marea');
  r.addEventListener('input', () => {
    st.horas = Number(r.value);
    caja.querySelectorAll('[data-h]').forEach(b => b.classList.toggle('on', Number(b.dataset.h) < st.horas));
    caja.querySelector('[data-horas-txt]').textContent = st.horas;
    const sub = DOCEAVOS.slice(0, st.horas).reduce((a, b) => a + b, 0);
    caja.querySelector('[data-subida-txt]').textContent = `Llevas ${sub} de 12 doceavos de la subida.`;
  });
}

/* ---------- Sala 3 · Óptica: tres paneles, uno rojo, que giran ---------- */
function opticaHtml(w, s) {
  const st = s[w.clave] || (s[w.clave] = { ang: 0, seg: 0 });
  const C = 150, R = 58;
  const paneles = w.paneles.map((p, i) => {
    const a = st.ang + i * (360 / w.paneles.length);
    const rojo = p === 'rojo';
    return `<g transform="rotate(${a} ${C} ${C})"><rect x="${C - 15}" y="${C - R - 10}" width="30" height="20" rx="3" fill="${rojo ? '#c0392b' : '#f8fbfb'}" stroke="#0a2131" stroke-width="1.5"/>
      ${rojo ? `<line x1="${C}" y1="${C - R - 10}" x2="${C}" y2="${C - 142}" stroke="#e74c3c" stroke-width="5" stroke-linecap="round" opacity=".85"/>` : ''}</g>`;
  }).join('');
  const rosa = [['N', 0], ['E', 90], ['S', 180], ['O', 270]].map(([t, a]) => `<text x="${C + 132 * Math.sin(rad(a))}" y="${C - 132 * Math.cos(rad(a)) + 4}" text-anchor="middle" font-size="12" font-weight="700" class="t-fuerte">${t}</text>`).join('');
  const ticks = Array.from({ length: 36 }, (_, i) => {
    const a = rad(i * 10), r1 = i % 9 ? 116 : 108;
    return `<line x1="${C + r1 * Math.sin(a)}" y1="${C - r1 * Math.cos(a)}" x2="${C + 122 * Math.sin(a)}" y2="${C - 122 * Math.cos(a)}" class="l-suave"/>`;
  }).join('');
  const alNorte = w.paneles[((Math.round(-st.ang / 120) % 3) + 3) % 3];
  const crono = st.seg === null ? 'Cronómetro parado: has girado la óptica a mano.'
    : `Cronómetro: ${st.seg} s · mirando al norte, panel ${alNorte}.`;
  return `<div class="engr faro-w" data-optica="${e(w.clave)}" aria-label="Óptica del faro vista desde arriba">
    <svg viewBox="0 0 300 300" role="img" aria-label="Óptica con tres paneles, el rojo apuntando a ${tres(st.ang)} grados">
      <circle cx="${C}" cy="${C}" r="124" class="c-fondo"/>${ticks}${rosa}
      <text x="${C}" y="14" text-anchor="middle" font-size="11" class="t-acento">★ Polar</text>
      <g>${paneles}</g>
      <circle cx="${C}" cy="${C}" r="16" fill="#f6cd55" stroke="#0a2131" stroke-width="1.5"/></svg>
    <p class="lect-faro" aria-live="polite">Panel rojo apuntando a ${tres(st.ang)}°. ${e(crono)}</p>
    <div class="pasos">
      <button type="button" data-destello>Siguiente destello (+${w.intervalo} s)</button>
      <button type="button" class="ghost" data-giro-reset>Volver al encendido</button></div>
    <div class="pasos">
      <button type="button" class="ghost" data-giro="-10">−10°</button>
      <button type="button" class="ghost" data-giro="-1">−1°</button>
      <button type="button" class="ghost" data-giro="1">+1°</button>
      <button type="button" class="ghost" data-giro="10">+10°</button></div></div>`;
}
function conectarOptica(app, s, repintar, w) {
  const caja = app.querySelector('[data-optica]');
  if (!caja) return;
  const st = s[caja.dataset.optica];
  // Cada destello, el siguiente panel ocupa el sitio del anterior: la óptica gira un tercio de vuelta.
  caja.querySelector('[data-destello]').addEventListener('click', () => {
    if (st.seg === null) { st.ang = 0; st.seg = 0; }
    st.ang = (st.ang + 360 / w.paneles.length) % 360; st.seg += w.intervalo; repintar();
  });
  caja.querySelector('[data-giro-reset]').addEventListener('click', () => { st.ang = 0; st.seg = 0; repintar(); });
  caja.querySelectorAll('[data-giro]').forEach(b => b.addEventListener('click', () => {
    st.ang = ((st.ang + Number(b.dataset.giro)) % 360 + 360) % 360; st.seg = null; repintar();
  }));
}

/* ---------- Sala 4 · Carta: trazar dos rumbos y ver dónde se cruzan ---------- */
const CARTA = { x0: -7, x1: 7, y0: -2, y1: 8.5, px: 26 };
const cx = x => ((x - CARTA.x0) * CARTA.px).toFixed(1);
const cy = y => ((CARTA.y1 - y) * CARTA.px).toFixed(1);
function cartaHtml(w, s) {
  const st = s[w.clave] || (s[w.clave] = { muelle: 0, faro: 0 });
  const ancho = (CARTA.x1 - CARTA.x0) * CARTA.px, alto = (CARTA.y1 - CARTA.y0) * CARTA.px;
  const tierra = w.costa.map(([x, y], i) => `${i ? 'L' : 'M'}${cx(x)} ${cy(y)}`).join(' ') + ' Z';
  const linea = (p, b, cls) => {
    const L = 30, x2 = p[0] + L * Math.sin(rad(b)), y2 = p[1] + L * Math.cos(rad(b));
    return `<line x1="${cx(p[0])}" y1="${cy(p[1])}" x2="${cx(x2)}" y2="${cy(y2)}" class="${cls}"/>`;
  };
  const boyas = w.boyas.map(b => `<g><circle cx="${cx(b.x)}" cy="${cy(b.y)}" r="6" class="boya"/>
    <text x="${cx(b.x)}" y="${(+cy(b.y) - 10).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="700" class="t-fuerte">${e(b.n)}</text></g>`).join('');
  const rocas = w.bajo.map(([x, y]) => `<circle cx="${cx(x)}" cy="${cy(y)}" r="2.2" class="roca"/>`).join('');
  const [mx, my] = w.muelle, [fx, fy] = w.faro;
  const ctrl = (id, nombre) => `<div class="fila-rumbo"><span>${nombre}: <b>${tres(st[id])}°</b></span>
    <div class="pasos">${[-10, -1, 1, 10].map(v => `<button type="button" class="ghost" data-rumbo="${id}" data-v="${v}" aria-label="${nombre} ${v > 0 ? '+' : '−'}${Math.abs(v)} grados">${v > 0 ? '+' : '−'}${Math.abs(v)}°</button>`).join('')}</div></div>`;
  return `<div class="engr faro-w" data-carta="${e(w.clave)}" aria-label="Carta náutica del cabo">
    <svg viewBox="0 0 ${ancho} ${alto}" role="img" aria-label="Carta con el muelle, el faro, el bajo de A Laxe y varias boyas numeradas">
      <rect x="0" y="0" width="${ancho}" height="${alto}" class="mar"/>
      <path d="${tierra}" class="tierra"/>
      <text x="${cx(-1.4)}" y="${cy(7.2)}" text-anchor="middle" font-size="10" font-style="italic" class="t-suave">Bajo de A Laxe</text>
      ${rocas}
      ${linea(w.muelle, st.muelle, 'traza traza-a')}${linea(w.faro, st.faro, 'traza traza-b')}
      ${boyas}
      <rect x="${(+cx(mx) - 5).toFixed(1)}" y="${(+cy(my) - 5).toFixed(1)}" width="10" height="10" class="muelle"/>
      <text x="${cx(mx)}" y="${(+cy(my) + 18).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" class="t-fuerte">Muelle</text>
      <circle cx="${cx(fx)}" cy="${cy(fy)}" r="7" class="faro-punto"/>
      <text x="${cx(fx)}" y="${(+cy(fy) + 20).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" class="t-fuerte">Faro</text>
      <g transform="translate(${ancho - 30} 30)" aria-hidden="true"><path d="M0 -20 L6 0 L0 -4 L-6 0 Z" class="norte"/>
        <text x="0" y="14" text-anchor="middle" font-size="11" font-weight="700" class="t-fuerte">N</text></g>
    </svg>
    ${ctrl('muelle', 'Rumbo desde el muelle')}${ctrl('faro', 'Rumbo desde el faro')}</div>`;
}
function conectarCarta(app, s, repintar) {
  const caja = app.querySelector('[data-carta]');
  if (!caja) return;
  const st = s[caja.dataset.carta];
  caja.querySelectorAll('[data-rumbo]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.rumbo;
    st[k] = ((st[k] + Number(b.dataset.v)) % 360 + 360) % 360;
    repintar();
  }));
}

/* ---------- Despacho ---------- */
export function widgetFaro(w, s) {
  if (w.tipo === 'cielo') return cieloHtml(w, s);
  if (w.tipo === 'ordenes') return ordenesHtml(w, s);
  if (w.tipo === 'optica') return opticaHtml(w, s);
  if (w.tipo === 'carta') return cartaHtml(w, s);
  return '';
}
/* Repinta solo el widget (no toda la sala), para no perder lo escrito en la respuesta ni el foco. */
export function conectarFaro(app, s, w) {
  if (!w || !TIPOS_FARO.includes(w.tipo)) return;
  const repintar = () => {
    const viejo = app.querySelector('.faro-w');
    if (!viejo) return;
    const foco = document.activeElement;
    const sel = foco && foco.closest('.faro-w') ? selector(foco) : null;
    const tmp = document.createElement('div');
    tmp.innerHTML = widgetFaro(w, s);
    viejo.replaceWith(tmp.firstElementChild);
    conectarFaro(app, s, w);
    if (sel) { const n = app.querySelector(sel); if (n) n.focus(); }
  };
  if (w.tipo === 'cielo') conectarCielo(app, s, repintar);
  if (w.tipo === 'ordenes') conectarOrdenes(app, s, repintar);
  if (w.tipo === 'optica') conectarOptica(app, s, repintar, w);
  if (w.tipo === 'carta') conectarCarta(app, s, repintar);
}
function selector(el) {
  for (const a of ['data-estrella', 'data-proa', 'data-cielo-guia', 'data-orden-frase', 'data-destello', 'data-giro-reset', 'data-giro', 'data-v']) {
    if (el.hasAttribute(a)) {
      const v = el.getAttribute(a);
      const extra = a === 'data-v' ? `[data-rumbo="${el.dataset.rumbo}"]` : '';
      return `.faro-w [${a}${v ? `="${v}"` : ''}]${extra}`;
    }
  }
  if (el.id) return '#' + el.id;
  return null;
}

/* ---------- Final: volver a encender el faro ---------- */
let faroEncendido = false;
export function faroFinal(d) {
  return `<section class="faro-final" aria-label="El faro de Punta do Cabo">
    <svg viewBox="0 0 400 220" role="img" aria-label="${faroEncendido ? 'El faro vuelve a girar sobre el mar' : 'El faro, apagado, sobre el cabo'}">
      <rect width="400" height="220" fill="#06121c"/>
      <path d="M0 160 Q100 150 200 158 T400 154 L400 220 L0 220 Z" fill="#0b2433"/>
      <path d="M250 220 L262 150 L330 138 L400 150 L400 220 Z" fill="#0d2232"/>
      <g class="haz${faroEncendido ? ' encendido' : ''}" style="transform-origin:300px 70px">
        <path d="M300 70 L-40 40 L-40 100 Z" fill="url(#luz)"/></g>
      <defs><linearGradient id="luz" x1="1" x2="0"><stop offset="0" stop-color="#f6cd55" stop-opacity=".75"/><stop offset="1" stop-color="#f6cd55" stop-opacity="0"/></linearGradient></defs>
      <rect x="290" y="78" width="20" height="62" fill="#e9f1f4"/><rect x="290" y="94" width="20" height="8" fill="#c0392b"/><rect x="290" y="116" width="20" height="8" fill="#c0392b"/>
      <rect x="286" y="62" width="28" height="16" rx="2" fill="${faroEncendido ? '#f6cd55' : '#24465c'}"/>
      <path d="M284 62 L300 48 L316 62 Z" fill="#0a2131"/>
      <g transform="translate(118 160)"><path d="M-8 0 L8 0 L4 -14 L-4 -14 Z" fill="#c0392b"/><text x="0" y="-20" text-anchor="middle" font-size="11" font-weight="700" fill="#e9f1f4">48</text></g>
    </svg>
    ${faroEncendido ? '' : '<button class="primario" id="encender-faro" type="button">Volver a encender el faro</button>'}
    <div id="historia" class="historia" ${faroEncendido ? '' : 'hidden'}><p class="texto">${e(d.historia || '')}</p></div>
  </section>`;
}
export function conectarFaroFinal(d) {
  const b = document.getElementById('encender-faro');
  if (!b) return;
  b.addEventListener('click', () => {
    faroEncendido = true;
    const sec = b.closest('.faro-final');
    const tmp = document.createElement('div');
    tmp.innerHTML = faroFinal(d);
    sec.replaceWith(tmp.firstElementChild);
    const h = document.getElementById('historia');
    if (h) h.classList.add('aparece');
  });
}
export function reiniciarFaroFinal() { faroEncendido = false; }
