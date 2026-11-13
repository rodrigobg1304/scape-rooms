/* Widgets y final del caso «Silencio en la órbita» (kepler_9).
   Ninguno muestra la respuesta: ayudan a razonar (contador binario de pruebas, plano para trazar
   rutas, circuito para anotar y registro de accesos con notas). El estado vive en `estado`, un objeto
   por sala que main.js conserva mientras dure la visita. */

const e = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const TIPOS_KEPLER = ['binario', 'cableado', 'circuito', 'accesos'];

/* ---------- Sala 1 · Puente: el registro de VERA y un contador binario de pruebas ---------- */
function luces(bits, grande) {
  const texto = [...bits].map(b => (b === '1' ? 'encendida' : 'apagada')).join(', ');
  return `<span class="bits${grande ? ' grande' : ''}" role="img" aria-label="Luces: ${texto}">${[...bits].map(b => `<i class="bit${b === '1' ? ' on' : ''}"></i>`).join('')}</span>`;
}
function binarioHtml(w, s) {
  const st = s[w.clave] || (s[w.clave] = { n: 0 });
  const ancho = w.bits || 6;
  const filas = w.registros.map(r => `<div class="fila-bits"><span class="etq">${e(r.n)}</span>${luces(r.bits)}</div>`).join('');
  const cont = st.n.toString(2).padStart(ancho, '0');
  return `<div class="engr kepler-w" data-binario="${e(w.clave)}" aria-label="Registro de emergencia de VERA">
    <p class="rot" style="margin:0">Registro de VERA · luz encendida = 1, apagada = 0</p>
    ${filas}
    <p class="rot" style="margin:14px 0 0">Contador de pruebas · no forma parte del registro</p>
    <div class="fila-bits" aria-live="polite">${luces(cont, true)}</div>
    <div class="pasos">
      <button type="button" data-suma="1">+1</button>
      <button type="button" class="ghost" data-suma="4">+4</button>
      <button type="button" class="ghost" data-suma="16">+16</button>
      <button type="button" class="ghost" data-suma="cero">A cero</button></div></div>`;
}
function conectarBinario(app, s, repintar, w) {
  const caja = app.querySelector('[data-binario]');
  if (!caja) return;
  const st = s[caja.dataset.binario];
  const tope = 2 ** (w.bits || 6);
  caja.querySelectorAll('[data-suma]').forEach(b => b.addEventListener('click', () => {
    st.n = b.dataset.suma === 'cero' ? 0 : (st.n + Number(b.dataset.suma)) % tope;
    repintar();
  }));
}

/* ---------- Plano de la estación: módulos, tramos y una ruta que se traza tocando ---------- */
function vecinos(mapa, a, b) { return mapa.tramos.some(([p, q]) => (p === a && q === b) || (p === b && q === a)); }
function planoSvg(mapa, ruta, etiqueta) {
  const pos = Object.fromEntries(mapa.nodos.map(n => [n.id, n]));
  const enRuta = (a, b) => ruta.some((id, i) => i && ((ruta[i - 1] === a && id === b) || (ruta[i - 1] === b && id === a)));
  const tramos = mapa.tramos.map(([a, b, v]) => {
    const A = pos[a], B = pos[b], mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
    return `<line class="tramo${enRuta(a, b) ? ' on' : ''}" x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}"/>
      <rect class="peso-f" x="${mx - 11}" y="${my - 10}" width="22" height="20" rx="5"/>
      <text class="peso" x="${mx}" y="${my + 4.5}" text-anchor="middle">${v}</text>`;
  }).join('');
  const nodos = mapa.nodos.map(n => {
    const i = ruta.indexOf(n.id);
    const cls = i === -1 ? '' : i === ruta.length - 1 ? ' fin' : ' on';
    const et = n.et || [0, 34, 'middle'];   // dónde va el nombre, para que no pise cables ni cifras
    return `<g class="modulo${cls}${n.destino ? ' destino' : ''}" data-modulo="${e(n.id)}" tabindex="0" role="button" aria-pressed="${i !== -1}" aria-label="${e(n.n)}">
      <circle cx="${n.x}" cy="${n.y}" r="19"/>
      <text class="cod" x="${n.x}" y="${n.y + 4.5}" text-anchor="middle">${e(n.id)}</text>
      <text class="nom" x="${n.x + et[0]}" y="${n.y + et[1]}" text-anchor="${et[2]}">${e(n.n)}</text></g>`;
  }).join('');
  return `<svg viewBox="0 0 360 ${mapa.alto || 320}" role="group" aria-label="${e(etiqueta)}">${tramos}${nodos}</svg>`;
}
function lecturaRuta(mapa, ruta) {
  if (!ruta.length) return 'Toca un módulo para empezar a trazar una ruta.';
  const nombre = id => mapa.nodos.find(n => n.id === id).n;
  const t = ruta.length - 1;
  // Suma de la ruta trazada: la cuenta no es el reto, el reto es dar con la ruta más rápida.
  const total = ruta.reduce((s, id, i) => (i ? s + mapa.tramos.find(([p, q]) => (p === ruta[i - 1] && q === id) || (q === ruta[i - 1] && p === id))[2] : 0), 0);
  return `Ruta: ${ruta.map(nombre).join(' → ')}${t ? ` · ${t} tramo${t === 1 ? '' : 's'} · ${total} ${mapa.unidad}` : ''}`;
}
function conectarPlano(caja, mapa, st, repintar) {
  const tocar = id => {
    const r = st.ruta, ult = r[r.length - 1];
    if (ult === id) r.pop();                                         // tocar el último lo deshace
    else if (r.length && !r.includes(id) && vecinos(mapa, ult, id)) r.push(id);
    else st.ruta = [id];                                             // cualquier otro módulo empieza una ruta nueva
    repintar();
  };
  caja.querySelectorAll('[data-modulo]').forEach(g => {
    g.addEventListener('click', () => tocar(g.dataset.modulo));
    g.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); tocar(g.dataset.modulo); } });
  });
  const b = caja.querySelector('[data-ruta-borrar]');
  if (b) b.addEventListener('click', () => { st.ruta = []; repintar(); });
}

/* ---------- Sala 2 · Laboratorio: la red de datos ---------- */
function cableadoHtml(w, s) {
  const st = s[w.clave] || (s[w.clave] = { ruta: [] });
  return `<div class="engr kepler-w" data-cableado="${e(w.clave)}" aria-label="Plano de la red de datos">
    <p class="rot" style="margin:0">Red de datos · cada cable marca su retardo en ${e(w.mapa.unidad)}</p>
    ${planoSvg(w.mapa, st.ruta, 'Plano de la red de datos de la estación, con el retardo de cada cable')}
    <p class="lect-kepler" aria-live="polite">${e(lecturaRuta(w.mapa, st.ruta))}</p>
    <div class="pasos"><button type="button" class="ghost" data-ruta-borrar ${st.ruta.length ? '' : 'disabled'}>Borrar ruta</button></div></div>`;
}

/* ---------- Sala 3 · Esclusa: circuito de puertas lógicas para anotar ---------- */
const CIRCUITO = {
  entradas: { A: [34, 40], B: [34, 100], C: [34, 170], D: [34, 240] },
  puertas: { X: [150, 70], N: [150, 150], Y: [150, 225], S1: [262, 50], S2: [262, 200] },
  cables: [
    'M48 40 H232 V40 H244',                    // A → O (despresurizar)
    'M92 40 V60 H132',                         // A → XOR
    'M48 100 H92 V80 H132',                    // B → XOR
    'M48 170 H92 V150 H132',                   // C → NO
    'M92 170 V215 H132',                       // C → Y
    'M48 240 H92 V235 H132',                   // D → Y
    'M168 150 H196 V60 H244',                  // NO → O
    'M168 70 H182 M210 70 H218 V190 H244',     // XOR → Y final (con puente sobre el cable de NO)
    'M168 225 H218 V210 H244',                 // Y → Y final
  ],
  puente: 'M182 70 Q196 54 210 70',
  nudos: [[92, 40], [92, 170]],
};
const SIG = { '': '1', 1: '0', 0: '' };
function circuitoHtml(w, s) {
  const st = s[w.clave] || (s[w.clave] = { nota: {} });
  const nota = id => (st.nota[id] === undefined ? '' : st.nota[id]);
  const voz = id => (nota(id) === '' ? 'sin anotar' : `anotado ${nota(id)}`);
  const ent = Object.entries(CIRCUITO.entradas).map(([id, [x, y]]) => `<g class="nodo-c ent v${nota(id)}" data-nodo="${id}" tabindex="0" role="button" aria-label="Interruptor ${id}, ${voz(id)}">
    <circle cx="${x}" cy="${y}" r="15"/><text x="${x}" y="${y - 20}" text-anchor="middle" class="cod">${id}</text>
    <text x="${x}" y="${y + 5}" text-anchor="middle" class="val">${nota(id) === '' ? '?' : nota(id)}</text></g>`).join('');
  const pu = w.puertas.map(p => {
    const [x, y] = CIRCUITO.puertas[p.id];
    return `<g class="nodo-c v${nota(p.id)}" data-nodo="${p.id}" tabindex="0" role="button" aria-label="Puerta ${e(p.voz)}, salida ${voz(p.id)}">
      <rect x="${x - 18}" y="${y - 20}" width="36" height="40" rx="8"/>
      <text x="${x}" y="${y - 4}" text-anchor="middle" class="cod">${e(p.op)}</text>
      <text x="${x}" y="${y + 13}" text-anchor="middle" class="val">${nota(p.id) === '' ? '?' : nota(p.id)}</text></g>
      ${p.salida ? `<text x="${x + 40}" y="${p.arriba ? y - 36 : y + 38}" text-anchor="end" class="sal">${e(p.salida)}</text>
      <text x="${x + 40}" y="${p.arriba ? y - 24 : y + 51}" text-anchor="end" class="sal obj">debe ser ${p.debe}</text>
      <path class="cable" d="M${x + 18} ${y} H${x + 40}"/>` : ''}`;
  }).join('');
  const leyenda = w.leyenda.map(l => `<li><b>${e(l.op)}</b><span>${e(l.texto)}</span></li>`).join('');
  return `<div class="engr kepler-w" data-circuito="${e(w.clave)}" aria-label="Circuito del panel de la esclusa">
    <p class="rot" style="margin:0">Panel sin corriente · toca un interruptor o una puerta para anotar 1, 0 o borrar</p>
    <svg viewBox="0 0 320 285" role="group" aria-label="Circuito: A y B entran en XOR. C entra en NO y, junto con D, en una puerta Y. XOR y esa puerta Y entran en otra Y, que da ABRIR. A y la salida de NO entran en una puerta O, que da DESPRESURIZAR.">
      ${CIRCUITO.cables.map(d => `<path class="cable" d="${d}"/>`).join('')}<path class="cable" d="${CIRCUITO.puente}"/>
      ${CIRCUITO.nudos.map(([x, y]) => `<circle class="nudo" cx="${x}" cy="${y}" r="3.5"/>`).join('')}
      ${ent}${pu}</svg>
    <p class="lect-kepler small-k">Los cables solo se unen donde hay un punto. Las anotaciones son tuyas: el panel no comprueba nada.</p>
    <ul class="leyenda">${leyenda}</ul>
    <div class="pasos"><button type="button" class="ghost" data-notas-borrar>Borrar anotaciones</button></div></div>`;
}
function conectarCircuito(app, s, repintar) {
  const caja = app.querySelector('[data-circuito]');
  if (!caja) return;
  const st = s[caja.dataset.circuito];
  const girar = id => {
    const sig = SIG[st.nota[id] === undefined ? '' : st.nota[id]];
    if (sig === '') delete st.nota[id]; else st.nota[id] = sig;
    repintar();
  };
  caja.querySelectorAll('[data-nodo]').forEach(g => {
    g.addEventListener('click', () => girar(g.dataset.nodo));
    g.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); girar(g.dataset.nodo); } });
  });
  caja.querySelector('[data-notas-borrar]').addEventListener('click', () => { st.nota = {}; repintar(); });
}

/* ---------- Sala 4 · Núcleo: tarjetas, pulseras y el plano de pasillos ---------- */
const VEREDICTOS = ['Sin decidir', 'Pudo', 'No pudo'];
function accesosHtml(w, s) {
  const st = s[w.clave] || (s[w.clave] = { ruta: [], nota: {} });
  const tarjetas = w.tarjetas.map(t => `<li><b>${e(t.hora)}</b><span>${e(t.lugar)} · tarjeta de ${e(t.de)}</span></li>`).join('');
  const pulseras = w.pulseras.map(p => `<li><b>${e(p.de)}</b><span>${e(p.hora)} · ${e(p.lugar)}</span></li>`).join('');
  const notas = w.sospechosos.map(n => {
    const v = st.nota[n] || 0;
    return `<div class="fila"><span>${e(n)}</span>
      <button type="button" class="ghost tf v${v}" data-veredicto="${e(n)}" aria-label="${e(n)}: ${VEREDICTOS[v]}. Toca para cambiar">${VEREDICTOS[v]}</button></div>`;
  }).join('');
  return `<div class="engr kepler-w" data-accesos="${e(w.clave)}" aria-label="Registro de accesos del núcleo">
    <p class="rot" style="margin:0">Tarjetas usadas esta noche</p>
    <ul class="registro">${tarjetas}</ul>
    <p class="rot" style="margin:14px 0 0">Pulseras de pulso · dónde estaba cada uno</p>
    <ul class="registro">${pulseras}</ul>
    <p class="rot" style="margin:14px 0 0">Pasillos · minutos a pie por tramo</p>
    ${planoSvg(w.mapa, st.ruta, 'Plano de pasillos de la estación, con los minutos de cada tramo')}
    <p class="lect-kepler" aria-live="polite">${e(lecturaRuta(w.mapa, st.ruta))}</p>
    <div class="pasos"><button type="button" class="ghost" data-ruta-borrar ${st.ruta.length ? '' : 'disabled'}>Borrar ruta</button></div>
    <p class="rot" style="margin:14px 0 0">Tus notas · ¿pudo hacer el recorrido del saboteador?</p>
    <div class="cartas">${notas}</div></div>`;
}
function conectarAccesos(app, s, repintar, w) {
  const caja = app.querySelector('[data-accesos]');
  if (!caja) return;
  const st = s[caja.dataset.accesos];
  conectarPlano(caja, w.mapa, st, repintar);
  caja.querySelectorAll('[data-veredicto]').forEach(b => b.addEventListener('click', () => {
    st.nota[b.dataset.veredicto] = ((st.nota[b.dataset.veredicto] || 0) + 1) % VEREDICTOS.length;
    repintar();
  }));
}

/* ---------- Despacho ---------- */
export function widgetKepler(w, s) {
  if (w.tipo === 'binario') return binarioHtml(w, s);
  if (w.tipo === 'cableado') return cableadoHtml(w, s);
  if (w.tipo === 'circuito') return circuitoHtml(w, s);
  if (w.tipo === 'accesos') return accesosHtml(w, s);
  return '';
}
/* Repinta solo el widget (no toda la sala), para no perder lo escrito en la respuesta ni el foco. */
export function conectarKepler(app, s, w) {
  if (!w || !TIPOS_KEPLER.includes(w.tipo)) return;
  const repintar = () => {
    const viejo = app.querySelector('.kepler-w');
    if (!viejo) return;
    const foco = document.activeElement;
    const sel = foco && foco.closest('.kepler-w') ? selector(foco) : null;
    const tmp = document.createElement('div');
    tmp.innerHTML = widgetKepler(w, s);
    viejo.replaceWith(tmp.firstElementChild);
    conectarKepler(app, s, w);
    if (sel) { const n = app.querySelector(sel); if (n) n.focus(); }
  };
  if (w.tipo === 'binario') conectarBinario(app, s, repintar, w);
  if (w.tipo === 'cableado') {
    const caja = app.querySelector('[data-cableado]');
    if (caja) conectarPlano(caja, w.mapa, s[caja.dataset.cableado], repintar);
  }
  if (w.tipo === 'circuito') conectarCircuito(app, s, repintar);
  if (w.tipo === 'accesos') conectarAccesos(app, s, repintar, w);
}
function selector(el) {
  for (const a of ['data-suma', 'data-modulo', 'data-ruta-borrar', 'data-nodo', 'data-notas-borrar', 'data-veredicto']) {
    if (el.hasAttribute(a)) {
      const v = el.getAttribute(a);
      return `.kepler-w [${a}${v ? `="${v}"` : ''}]`;
    }
  }
  return null;
}

/* ---------- Final: encender los motores y romper el silencio ---------- */
let motores = false;
const RADIO = {
  a_tiempo: ['Kepler-9, aquí Tierra. Os dábamos por perdidos.', 'Órbita estable. Buen trabajo, técnico de guardia.'],
  tarde: ['Cápsula de Kepler-9, aquí Tierra. Os tenemos en pantalla.', 'Seis a bordo y el registro a salvo. Venid a casa.'],
};
export function keplerFinal(d, aTiempo = true) {
  const estrellas = [[30, 24], [84, 60], [150, 18], [212, 44], [268, 22], [330, 58], [372, 30], [120, 96], [300, 104], [52, 118]]
    .map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 3 ? 1 : 1.6}" fill="#e3ecf7" opacity="${i % 2 ? 0.6 : 0.9}"/>`).join('');
  const radio = RADIO[aTiempo ? 'a_tiempo' : 'tarde'];
  const boton = aTiempo ? 'Encender los motores' : 'Lanzar la cápsula de escape';
  const voz = !motores ? 'La estación Kepler-9, a oscuras, cae hacia la Luna'
    : aTiempo ? 'Kepler-9 enciende los motores y recupera altura' : 'La cápsula de escape se aleja de la estación';
  return `<section class="kepler-final${motores ? ' en-marcha' : ''}${aTiempo ? '' : ' tarde'}" aria-label="La estación Kepler-9">
    <svg viewBox="0 0 400 230" role="img" aria-label="${voz}">
      <rect width="400" height="230" fill="#04060c"/>${estrellas}
      <path d="M-20 230 Q200 150 420 230 Z" fill="#8f97a3"/>
      <circle cx="96" cy="212" r="15" fill="#767e8a"/><circle cx="238" cy="204" r="9" fill="#767e8a"/><circle cx="322" cy="218" r="12" fill="#767e8a"/>
      <line class="k-limite" x1="0" y1="150" x2="400" y2="150"/>
      <text x="8" y="144" font-size="9" fill="#ff7a6b">altura de no retorno</text>
      <g class="k-estacion">
        <path class="k-llama" d="M172 108 L160 132 L172 124 L184 132 Z" fill="#ffb54d"/>
        <rect x="150" y="84" width="100" height="24" rx="12" fill="#c9d4e3"/>
        <rect x="112" y="78" width="34" height="36" fill="#1b6f93" stroke="#61d5ff"/><rect x="254" y="78" width="34" height="36" fill="#1b6f93" stroke="#61d5ff"/>
        <line x1="146" y1="96" x2="150" y2="96" stroke="#c9d4e3" stroke-width="3"/><line x1="250" y1="96" x2="254" y2="96" stroke="#c9d4e3" stroke-width="3"/>
        <circle cx="176" cy="96" r="5" class="k-ventana"/><circle cx="200" cy="96" r="5" class="k-ventana"/><circle cx="224" cy="96" r="5" class="k-ventana"/>
        <line x1="200" y1="84" x2="200" y2="66" stroke="#c9d4e3" stroke-width="2"/><path class="k-antena" d="M190 62 Q200 72 210 62" fill="none" stroke="#c9d4e3" stroke-width="2"/>
        <g class="k-ondas" fill="none" stroke="#61d5ff" stroke-width="1.5"><path d="M188 54 Q200 44 212 54"/><path d="M182 46 Q200 30 218 46"/></g>
      </g>
      <g class="k-capsula"><path d="M214 108 h16 l5 10 h-26 Z" fill="#e3ecf7"/><path d="M216 118 l6 12 l6 -12 Z" fill="#ffb54d"/></g>
    </svg>
    ${motores ? '' : `<button class="primario" id="encender-motores" type="button">${boton}</button>`}
    <div id="historia" class="historia" ${motores ? '' : 'hidden'}>
      <p class="rot k-radio-t">Radio · canal de emergencia</p>
      ${radio.map(t => `<p class="k-radio">«${e(t)}»</p>`).join('')}
      <p class="texto" style="margin-top:12px">${e(d.historia || '')}</p></div>
  </section>`;
}
export function conectarKeplerFinal(d, aTiempo = true) {
  const b = document.getElementById('encender-motores');
  if (!b) return;
  b.addEventListener('click', () => {
    motores = true;
    const sec = b.closest('.kepler-final');
    const tmp = document.createElement('div');
    tmp.innerHTML = keplerFinal(d, aTiempo);
    const nuevo = tmp.firstElementChild;
    nuevo.classList.remove('en-marcha');          // primero quieta, luego en marcha: así se ve el movimiento
    sec.replaceWith(nuevo);
    requestAnimationFrame(() => requestAnimationFrame(() => nuevo.classList.add('en-marcha')));
    const h = document.getElementById('historia');
    if (h) h.classList.add('aparece');
  });
}
export function reiniciarKeplerFinal() { motores = false; }
