import './styles.css';
import CASOS from './data/casos.json';
import { api, configurado, sesion, usuario, registrar, entrarCuenta, salirCuenta, reenviarConfirmacion, aliasDisponible } from './api.js';

/* Motor de Salas Secretas.
   El navegador solo conoce la portada de cada caso. El contenido de cada sala, las pistas,
   la validación de respuestas y el tiempo viven en Supabase (ver supabase/migrations). */

const APP = document.getElementById('app');
const NIVEL_TXT = ['Nota 1 · sutil', 'Nota 2 · directa', 'Nota 3 · solución'];
const ROMANOS = ['I', 'II', 'III', 'IV', 'V', 'VI'];
const ROMANOS_RELOJ = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const LETRAS = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','Ñ','O','P','Q','R','S','T','U','V','W','X','Y','Z'];
const UMBRALES = [10, 5, 0];

let actual = null;        // caso público (CASOS[i])
let estado = null;        // estado de la partida devuelto por el servidor
let desfase = 0;          // reloj del servidor − reloj local, en ms
let misCasos = [];        // progreso por caso (mis_casos)
let cuenta = null;        // usuario actual: { email, anonimo, alias }
let vistaCuenta = '';     // '', 'registro' o 'entrar'
let avisoCuenta = '';
let aviso = '';
let armado = false;
let midiendo = false;
let mapaAbierto = false;
let entrar = false;
let ocupado = false;
let fragSel = null;
let aprendido = '';
let relojEnMarcha = false;
const estadoW = {};       // estado de los widgets en esta visita
let widgetActivo = null;

function esc(t) { return String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function lsLeer(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (x) { return null; } }
function lsGuardar(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (x) { /* sin almacenamiento */ } }
function ahora() { return Date.now() + desfase; }
function ponerEstado(e) { estado = e; desfase = Date.parse(e.ahora) - Date.now(); }

/* ---------- Tiempo: lo cuenta el servidor (inicio, fin y penalizaciones) ---------- */
function consumido(e = estado) {
  if (!e) return 0;
  const fin = e.fin ? Date.parse(e.fin) : ahora();
  return fin - Date.parse(e.inicio) + (e.penal_seg || 0) * 1000;
}
function limite() { return ((estado && estado.limite_seg) || 1800) * 1000; }
function fmtCuenta(ms) {
  const s = Math.ceil(Math.abs(ms) / 1000);
  return (ms < 0 ? '+' : '') + String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}
function fmt(ms) {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const p = n => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(r)}` : `${p(m)}:${p(r)}`;
}
function cuentaHtml() {
  return `<div id="cuenta" class="cuenta-atras" role="timer" aria-live="off"><span>Tiempo restante</span><b>30:00</b></div>`;
}
function tic() {
  const el = document.getElementById('cuenta');
  if (!el || !estado || estado.estado !== 'en_curso') return;
  const rest = limite() - consumido();
  el.querySelector('b').textContent = fmtCuenta(rest);
  el.querySelector('span').textContent = rest < 0 ? 'Fuera de tiempo' : 'Tiempo restante';
  el.classList.toggle('aviso', rest <= 10 * 60000 && rest > 60000);
  el.classList.toggle('critico', rest <= 60000);
  const cruzados = UMBRALES.filter(m => rest <= m * 60000);
  if (!cruzados.length) return;
  const clave = 'salas-avisos-' + estado.partida;
  const vistos = lsLeer(clave) || {};
  const nuevos = cruzados.filter(m => !vistos[m]);
  if (!nuevos.length) return;
  cruzados.forEach(m => { vistos[m] = true; });
  lsGuardar(clave, vistos);
  mostrarAlarma(Math.min(...nuevos));
}
setInterval(tic, 250);
function cerrarAlarma() { const a = document.querySelector('.alarma'); if (a) a.remove(); }
function mostrarAlarma(min) {
  cerrarAlarma();
  const textos = (actual && actual.premisa.avisos) || {};
  const titulo = min === 0 ? 'Se acabó el tiempo' : `Quedan ${min} minutos`;
  const texto = textos[min] || (min === 0 ? 'El tiempo se ha agotado.' : `Quedan ${min} minutos para completar el caso.`);
  const extra = min === 0 ? '<p class="small">Puedes terminar el caso, pero contará como fuera de tiempo.</p>' : '';
  const a = document.createElement('div');
  a.className = 'alarma';
  a.innerHTML = `<div class="alarma-c" role="alertdialog" aria-modal="true" aria-labelledby="alarma-t" aria-describedby="alarma-d">
    <svg class="alarma-reloj" viewBox="0 0 120 120" aria-hidden="true">
      <circle cx="30" cy="22" r="14" fill="var(--accent)"/><circle cx="90" cy="22" r="14" fill="var(--accent)"/>
      <circle cx="60" cy="66" r="44" fill="var(--chip)" stroke="var(--accent)" stroke-width="6"/>
      <line x1="60" y1="66" x2="60" y2="38" stroke="var(--ink)" stroke-width="5" stroke-linecap="round"/>
      <line x1="60" y1="66" x2="80" y2="76" stroke="var(--ink)" stroke-width="5" stroke-linecap="round"/>
      <line x1="34" y1="106" x2="26" y2="116" stroke="var(--accent)" stroke-width="6" stroke-linecap="round"/>
      <line x1="86" y1="106" x2="94" y2="116" stroke="var(--accent)" stroke-width="6" stroke-linecap="round"/></svg>
    <p class="rot" id="alarma-t">${esc(titulo)}</p>
    <p class="texto" id="alarma-d">${esc(texto)}</p>${extra}
    <button class="primario" type="button">Seguir</button></div>`;
  document.body.appendChild(a);
  const b = a.querySelector('button');
  b.addEventListener('click', cerrarAlarma);
  a.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarAlarma(); });
  b.focus();
}

/* ---------- Medición: progreso guardado en el servidor ---------- */
function filaCaso(j, i) {
  const m = misCasos.find(x => x.caso === j.premisa.id) || {};
  const n = m.total_salas || j.salas.length;
  const enCurso = m.en_curso;
  const resueltas = m.resueltas || 0;
  const hechas = resueltas ? n : enCurso ? enCurso.salas_resueltas : 0;
  const msCurso = enCurso ? ahora() - Date.parse(enCurso.inicio) + enCurso.penal_seg * 1000 : 0;
  return { id: j.premisa.id, titulo: j.premisa.titulo, hoja: i + 1, salas: n, hechas, validado: m.validado === true, pct: Math.round(hechas / n * 100),
    resueltas, enCurso, msCurso, mejor: m.mejor_seg != null ? m.mejor_seg * 1000 : null };
}
function resumen() {
  const filas = CASOS.map(filaCaso);
  const jugables = filas.filter(f => f.validado);
  const totSalas = jugables.reduce((a, f) => a + f.salas, 0), totRes = jugables.reduce((a, f) => a + f.hechas, 0);
  return { filas, totSalas, totRes, pctGlobal: totSalas ? Math.round(totRes / totSalas * 100) : 0 };
}
function textoResumen() {
  const r = resumen();
  const lineas = [`Salas Secretas · medición (${new Date().toLocaleString('es-ES')})`,
    `Global: ${r.pctGlobal}% (${r.totRes}/${r.totSalas} salas)`];
  r.filas.forEach(f => lineas.push(`Hoja ${String(f.hoja).padStart(2, '0')} · ${f.titulo}: ${f.pct}% (${f.hechas}/${f.salas})`
    + (f.mejor !== null ? ` · mejor ${fmt(f.mejor)}` : '') + (f.enCurso ? ` · en curso ${fmt(f.msCurso)}` : '')));
  return lineas.join('\n');
}
function panelMedicion() {
  const r = resumen();
  const filas = r.filas.map(f => `<li><span class="rot">Hoja ${String(f.hoja).padStart(2, '0')} · ${esc(f.titulo)}</span>
    <div class="barra-medida" style="--p:${f.pct}%"><span></span></div>
    <span class="small">${f.pct}% · ${f.hechas}/${f.salas} salas${f.mejor !== null ? ` · mejor ${fmt(f.mejor)}` : ''}${f.enCurso ? ` · en curso ${fmt(f.msCurso)}` : ''}</span></li>`).join('');
  return `<section class="medicion" aria-label="Medición">
    <p class="rot">Medición</p>
    <dl><dt>Completado (global)</dt><dd>${r.pctGlobal}%</dd>
      <dt>Salas resueltas</dt><dd>${r.totRes} / ${r.totSalas}</dd></dl>
    <div class="barra-medida" style="--p:${r.pctGlobal}%"><span></span></div>
    <ul style="list-style:none;padding:0;margin:14px 0 0;display:grid;gap:12px">${filas}</ul>
    <div class="acciones" style="margin-top:14px">
      <button class="primario" id="copiar" type="button">Copiar resumen</button>
      <button class="ghost" id="descargar" type="button">Descargar JSON</button></div>
    <p id="msg-medicion" class="msg" aria-live="polite"></p></section>`;
}
function wireMedicion() {
  const c = document.getElementById('copiar');
  if (c) c.addEventListener('click', async () => {
    let ok = false;
    try { await navigator.clipboard.writeText(textoResumen()); ok = true; } catch (x) { ok = false; }
    document.getElementById('msg-medicion').textContent = ok ? 'Resumen copiado.' : 'No se ha podido copiar. Usa Descargar JSON.';
  });
  const d = document.getElementById('descargar');
  if (d) d.addEventListener('click', () => {
    const datos = { generado: new Date().toISOString(), resumen: resumen(), casos: misCasos };
    const url = URL.createObjectURL(new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'salas-medicion.json';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    document.getElementById('msg-medicion').textContent = 'Descarga iniciada.';
  });
}

/* ---------- Transiciones y plano ---------- */
function salir(fn) {
  const h = APP.firstElementChild;
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ir = () => { fn(); window.scrollTo(0, 0); }; // cada pantalla nueva empieza arriba
  if (!h || reduce) { ir(); return; }
  h.classList.add('sale');
  setTimeout(ir, 280);
}
function entradaHoja() {
  const h = APP.firstElementChild;
  if (entrar && h) h.classList.add('entra');
  entrar = false;
}
function panelMapa(j, res) {
  const n = j.salas.length, W = 170, x0 = 70;
  const nodos = j.salas.map((e, i) => {
    const x = x0 + i * W;
    const est = i < res ? 'hecha' : i === res ? 'actual' : 'pendiente';
    const pasillo = i < n - 1 ? `<line class="pasillo ${i < res ? 'abierto' : ''}" x1="${x + 24}" y1="46" x2="${x + W - 24}" y2="46"/>` : '';
    const marca = est === 'hecha'
      ? `<path d="M${x - 7} 46 l5 5 l10 -11"/>`
      : `<text class="num" x="${x}" y="51" text-anchor="middle">${i + 1}</text>`;
    const nombre = est === 'pendiente' ? 'Sala cerrada' : e.nombre;
    return `${pasillo}<g class="nodo ${est}"><circle cx="${x}" cy="46" r="22"/>${marca}</g>
      <text class="etq ${est === 'pendiente' ? 'oculta' : ''}" x="${x}" y="98" text-anchor="middle">${esc(nombre)}</text>`;
  }).join('');
  const ancho = x0 * 2 + (n - 1) * W;
  return `<section class="mapa" aria-label="Plano de la casa">
    <svg viewBox="0 0 ${ancho} 110" role="img" aria-label="${res} de ${n} salas abiertas">${nodos}</svg>
    <div class="barra" style="margin-top:8px"><button class="ghost" id="cerrar-plano" type="button">Cerrar plano</button></div></section>`;
}
function pantallaError(texto, reintentar) {
  APP.innerHTML = `<div class="hoja"><div class="error" role="alert"><p class="rot">Algo ha fallado</p>
    <p class="texto">${esc(texto)}</p>${reintentar ? '<div class="barra"><button class="primario" id="reintentar" type="button">Reintentar</button></div>' : ''}</div></div>`;
  const b = document.getElementById('reintentar');
  if (b) b.addEventListener('click', reintentar);
}

/* ---------- Cuenta ---------- */
function barraCuenta() {
  const nombre = cuenta && (cuenta.alias || cuenta.email);
  const quien = !cuenta ? ''
    : cuenta.anonimo
      ? '<b>Invitado</b> <span class="small">· tu progreso solo vive en este navegador</span>'
      : `<b>${esc(nombre)}</b>${cuenta.alias && cuenta.email ? ` <span class="small">· ${esc(cuenta.email)}</span>` : ''}`;
  const botones = !cuenta ? '' : cuenta.anonimo
    ? `<button class="primario" id="ir-registro" type="button">Crear cuenta</button><button class="ghost" id="ir-entrar" type="button">Entrar</button>`
    : '<button class="ghost" id="salir-cuenta" type="button">Salir</button>';
  return `<section class="cuenta" aria-label="Cuenta"><p class="quien" id="quien">${quien}</p><div class="acciones">${botones}</div></section>
    ${cuenta && cuenta.anonimo && vistaCuenta ? formCuenta() : ''}
    ${avisoCuenta ? `<p class="msg" role="status">${esc(avisoCuenta)}</p>` : ''}`;
}
function formCuenta() {
  const reg = vistaCuenta === 'registro';
  return `<form class="form-cuenta" id="form-cuenta" novalidate>
    <p class="rot">${reg ? 'Crear cuenta' : 'Entrar'}</p>
    <p class="small">${reg ? 'Conservas el progreso de este navegador. Te enviaremos un correo para confirmar la dirección.'
      : 'Si ya tienes cuenta. El progreso de invitado de este navegador no se mezcla con el de tu cuenta.'}</p>
    ${reg ? '<label>Alias (3–24 caracteres, sale en el ranking)<input name="alias" autocomplete="nickname" minlength="3" maxlength="24" required></label>' : ''}
    <label>Correo<input name="email" type="email" autocomplete="email" required></label>
    <label>Contraseña${reg ? ' (mínimo 8)' : ''}<input name="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" minlength="8" required></label>
    <div class="acciones"><button class="primario" type="submit">${reg ? 'Crear cuenta' : 'Entrar'}</button>
      <button class="ghost" type="button" id="cancelar-cuenta">Cancelar</button></div>
    <p class="msg" id="msg-cuenta" role="alert"></p></form>`;
}
function wireCuenta() {
  const clic = (id, fn) => { const e = document.getElementById(id); if (e) e.addEventListener('click', fn); };
  clic('ir-registro', () => { vistaCuenta = 'registro'; avisoCuenta = ''; menu(); });
  clic('ir-entrar', () => { vistaCuenta = 'entrar'; avisoCuenta = ''; menu(); });
  clic('cancelar-cuenta', () => { vistaCuenta = ''; menu(); });
  clic('salir-cuenta', async e => {
    e.target.disabled = true;
    try { await salirCuenta(); cuenta = null; avisoCuenta = ''; vistaCuenta = ''; menu(); }
    catch (x) { e.target.disabled = false; avisoCuenta = x.message; menu(); }
  });
  const f = document.getElementById('form-cuenta');
  if (!f) return;
  f.addEventListener('submit', async ev => {
    ev.preventDefault();
    const msg = document.getElementById('msg-cuenta'), enviar = f.querySelector('[type=submit]');
    const v = Object.fromEntries(new FormData(f).entries());
    const email = String(v.email || '').trim(), password = String(v.password || ''), alias = String(v.alias || '').trim();
    const reg = vistaCuenta === 'registro';
    if (reg && (alias.length < 3 || alias.length > 24)) { msg.textContent = 'El alias debe tener entre 3 y 24 caracteres.'; return; }
    if (!/^\S+@\S+\.\S+$/.test(email)) { msg.textContent = 'Escribe un correo válido.'; return; }
    if (password.length < 8) { msg.textContent = 'La contraseña necesita al menos 8 caracteres.'; return; }
    enviar.disabled = true; msg.textContent = 'Un momento…';
    try {
      if (reg) {
        if (!(await aliasDisponible(alias))) throw new Error('Ese alias ya está en uso.');
        const r = await registrar({ alias, email, password });
        avisoCuenta = r.pendiente ? `Te hemos enviado un correo a ${email}. Pulsa el enlace para confirmar la cuenta; hasta entonces sigues como invitado.` : 'Cuenta creada.';
      } else {
        await entrarCuenta({ email, password });
        avisoCuenta = '';
      }
      vistaCuenta = '';
      cuenta = await usuario();
      menu();
    } catch (x) { enviar.disabled = false; msg.textContent = x.message; }
  });
}

/* ---------- Índice ---------- */
async function menu() {
  cerrarAlarma();
  actual = null; estado = null; aviso = ''; armado = false; mapaAbierto = false;
  document.documentElement.removeAttribute('data-juego');
  document.title = 'Salas Secretas';
  try { misCasos = await api.misCasos(); cuenta = await usuario(); } catch (e) { pantallaError(e.message, menu); return; }
  const r = resumen();
  APP.innerHTML = `<div class="hoja">
    <div class="cajetin">
      <div><h1>Elige un caso</h1>
        <p class="texto" style="margin-top:8px;color:var(--ink-soft)">Cuatro salas por caso y 30 minutos para resolverlo. El avance y el tiempo se guardan en tu cuenta.</p></div>
      <div class="sello"><b>${r.pctGlobal}%</b>${r.totRes}/${r.totSalas} salas</div>
    </div>
    ${barraCuenta()}
    <div class="barra"><button class="ghost" id="medir" type="button">${midiendo ? 'Ocultar medición' : 'Ver medición'}</button></div>
    ${midiendo ? panelMedicion() : ''}
    <div class="indice">${CASOS.map((j, i) => {
      const f = r.filas[i];
      const hecho = f.resueltas > 0;
      if (!f.validado) {
        return `<button class="hoja-caso bloqueado" data-id="${esc(j.premisa.id)}" disabled aria-disabled="true">
        <span class="sello-ok bloq" aria-hidden="true">Bloqueado</span>
        <span class="rot est">Hoja ${String(i + 1).padStart(2, '0')} · Pendiente de validar</span>
        <span class="t">${esc(j.premisa.titulo)}</span>
        <span class="d">${esc(j.premisa.descripcion)}</span></button>`;
      }
      const est = hecho ? 'Resuelto' : f.enCurso ? `En curso · sala ${f.enCurso.salas_resueltas + 1} de ${f.salas} · ${fmt(f.msCurso)}` : 'Sin empezar';
      return `<button class="hoja-caso${hecho ? ' completo' : ''}" data-id="${esc(j.premisa.id)}">
        ${hecho ? '<span class="sello-ok" aria-hidden="true">Completado</span>' : ''}
        <span class="rot est">Hoja ${String(i + 1).padStart(2, '0')} · ${esc(est)}</span>
        <span class="t">${esc(j.premisa.titulo)}</span>
        <span class="d">${esc(j.premisa.descripcion)}</span>
        ${f.mejor !== null ? `<span class="rot" style="margin-top:4px">Mejor partida ${fmt(f.mejor)} · ${f.resueltas} ${f.resueltas === 1 ? 'resuelta' : 'resueltas'}</span>` : ''}</button>`;
    }).join('')}</div></div>`;
  entradaHoja();
  APP.querySelectorAll('.hoja-caso:not([disabled])').forEach(b => b.addEventListener('click', () => {
    midiendo = false;
    const jj = CASOS.find(j => j.premisa.id === b.dataset.id);
    salir(() => jugar(jj));
  }));
  document.getElementById('medir').addEventListener('click', () => { midiendo = !midiendo; menu(); });
  wireMedicion();
  wireCuenta();
}

/* ---------- Partida ---------- */
async function jugar(j) {
  actual = j;
  relojEnMarcha = false;
  document.documentElement.dataset.juego = j.premisa.tema || '01';
  document.documentElement.dataset.caso = j.premisa.id;
  APP.innerHTML = '<div class="hoja"><p class="cargando">Abriendo el caso…</p></div>';
  try { ponerEstado(await api.iniciar(j.premisa.id)); } catch (e) { pantallaError(e.message, () => jugar(j)); return; }
  entrar = true;
  pintar();
}

function barraHtml() {
  return `<nav class="barra">
    <button class="ghost" id="volver" type="button">← Índice</button>
    <span style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="ghost" id="plano" type="button">${mapaAbierto ? 'Ocultar plano' : 'Plano'}</button>
      <button class="ghost" id="reiniciar" type="button">${armado ? 'Confirmar reinicio' : 'Reiniciar caso'}</button></span></nav>`;
}

function pintar() {
  const j = actual, e = estado, n = e.total_salas, res = e.salas_resueltas;
  const extra = mapaAbierto ? panelMapa(j, res) : '';
  document.title = j.premisa.titulo;
  const pct = Math.round(Math.min(res, n) / n * 100);
  const descubierto = aprendido ? `<section class="descubre" aria-live="polite"><p class="rot">Lo que acabas de usar</p>
    <p class="texto">${esc(aprendido)}</p></section>` : '';
  aprendido = '';

  if (e.estado === 'resuelta') {
    const d = e.desenlace || {};
    const ms = consumido();
    const cuerpoFin = d.epilogo
      ? `<section class="dibujo epilogo" style="margin-top:14px"><span class="marca">${esc(d.objeto || '')}</span>
          ${d.epilogo.map(t => `<p class="escena">${esc(t)}</p>`).join('')}</section>
        ${d.hora ? relojFinal(d) : ''}`
      : `<section class="dibujo" style="margin-top:14px"><p class="escena">Has conseguido: <strong>${esc(d.objeto || '')}</strong>.</p>
        <p class="rot" style="margin-top:10px">${esc(j.premisa.objetivo)}</p></section>`;
    const aTiempo = ms <= limite();
    APP.innerHTML = `<div class="hoja">
      <div class="cajetin"><div class="final-cabecera" style="grid-column:1/-1">
        <div class="medalla" aria-hidden="true">${aTiempo ? '✓' : '⌛'}</div>
        <p class="rot">Caso cerrado${e.es_primera ? '' : ' · repetición, no puntúa'}</p>
        <h1>${esc(j.premisa.titulo)}</h1></div></div>
      <div class="datos-final">
        <div class="dato"><b>${fmt(ms)}</b><span>Tiempo total</span></div>
        <div class="dato"><b>${aTiempo ? 'A tiempo' : 'Fuera'}</b><span>Límite ${fmt(limite())}</span></div>
        <div class="dato"><b>+${fmt((e.penal_seg || 0) * 1000)}</b><span>Penalización</span></div>
        <div class="dato"><b>${n}/${n}</b><span>Salas abiertas</span></div></div>${descubierto}
      ${cuerpoFin}${barraHtml().replace('Reiniciar caso', 'Jugar de nuevo')}${extra}</div>`;
    wire(j);
    conectarReloj(d);
    return;
  }

  const sala = e.sala;
  const nivel = e.pistas.length;
  const notas = nivel > 0
    ? `<ol class="pistas">${e.pistas.map(p => `<li><p class="rot">${NIVEL_TXT[p.nivel - 1]}</p>${esc(p.texto)}</li>`).join('')}</ol>`
    : '';
  const piezas = e.objetos.map((o, i) => `<li><span>${String(i + 1).padStart(2, '0')}</span><span>${esc(o)}</span></li>`).join('');
  const numeral = ROMANOS[res] || String(res + 1);
  const penal = e.siguiente_penal_seg;

  APP.innerHTML = `<div class="hoja">${cuentaHtml()}
    <div class="cajetin">
      <div><h1>${esc(sala.nombre)}</h1><p class="texto" style="color:var(--ink-soft);margin-top:6px">${esc(j.premisa.titulo)} · sala ${res + 1} de ${n}</p></div>
      <div class="sello"><b>${pct}%</b>${res}/${n} salas</div>
    </div>${descubierto}
    <div class="cota">Escena</div>
    <div class="plano">
      <div>
        <section class="dibujo"><span class="marca">${esc(sala.nombre)}</span>
          <p class="numero" aria-hidden="true">${esc(numeral)}</p>
          <p class="entrada">${esc(sala.intro || '')}</p>
          <p class="escena">${esc(sala.descripcion)}</p></section>
        <details class="piezas" open><summary>Premisa</summary>
          <p class="vacio" style="color:var(--ink)">${esc(j.premisa.descripcion)}</p></details>
        <details class="piezas" open><summary>Objetos</summary>
          ${piezas ? `<ol>${piezas}</ol>` : '<p class="vacio">Aún no tienes nada.</p>'}</details>
      </div>
      <section class="anotacion" aria-label="Reto">
        <span class="n">${res + 1}</span>
        <p class="rot">${esc(sala.pista.nombre)}</p>
        <p class="texto">${esc(sala.pista.descripcion)}</p>
        <p class="rot" style="margin-top:12px">Reto</p>
        <p class="texto"><strong>${esc(sala.puzzle)}</strong></p>
        ${sala.widget ? widget({ ...sala.widget, clave: sala.id }) : ''}
        <div class="resp">
          <label for="r" class="sr">Respuesta</label>
          ${campoRespuesta(sala)}
          <button class="primario" id="comprobar" type="button">Comprobar</button>
        </div>
        <p id="msg" class="msg" aria-live="polite">${esc(aviso)}</p>
        <button class="ghost" id="pista" type="button" ${penal == null ? 'disabled' : ''}>
          ${penal == null ? 'Sin más notas' : `Pedir nota (${nivel}/3) · +${Math.round(penal / 60)} min`}</button>
        ${notas}
      </section>
    </div>${barraHtml()}${extra}</div>`;
  aviso = '';
  wire(j, sala);
  conectarWidgets();
  tic();
}

/* Final: el reloj se pone en marcha y marca la hora del desenlace. */
function relojFinal(d) {
  const [h, mi] = d.hora;
  const angM = mi * 6, angH = (h % 12) * 30 + mi * 0.5;
  const marcas = Array.from({ length: 60 }, (_, i) => {
    const a = i * 6 * Math.PI / 180, r1 = i % 5 ? 92 : 84;
    return `<line x1="${(120 + r1 * Math.sin(a)).toFixed(1)}" y1="${(120 - r1 * Math.cos(a)).toFixed(1)}" x2="${(120 + 98 * Math.sin(a)).toFixed(1)}" y2="${(120 - 98 * Math.cos(a)).toFixed(1)}" stroke="var(--ink-soft)" stroke-width="${i % 5 ? 1 : 2.5}"/>`;
  }).join('');
  const nums = ROMANOS_RELOJ.map((t, i) => {
    const a = (i + 1) * 30 * Math.PI / 180;
    return `<text x="${(120 + 70 * Math.sin(a)).toFixed(1)}" y="${(125 - 70 * Math.cos(a)).toFixed(1)}" text-anchor="middle" font-size="14" font-weight="700" fill="var(--ink)" font-family="var(--display)">${t}</text>`;
  }).join('');
  const final = relojEnMarcha;
  const hhmm = `${h}:${String(mi).padStart(2, '0')}`;
  return `<section class="reloj-final" aria-label="Reloj">
    <div class="reloj-escena">
      <svg viewBox="0 0 400 240" role="img" aria-label="${final ? `El reloj marca las ${hhmm}` : 'El reloj, parado a las doce'}">
        <g class="eng-a${final ? ' gira' : ''}" style="transform-origin:300px 70px"><path d="${dientesPath(300, 70, 34, 18)}" fill="var(--rule)"/><circle cx="300" cy="70" r="28" fill="var(--chip)" stroke="var(--rule)"/></g>
        <g class="eng-b${final ? ' gira' : ''}" style="transform-origin:345px 150px"><path d="${dientesPath(345, 150, 24, 12)}" fill="var(--rule)"/><circle cx="345" cy="150" r="18" fill="var(--chip)" stroke="var(--rule)"/></g>
        <circle cx="120" cy="120" r="104" fill="var(--chip)" stroke="var(--accent)" stroke-width="3"/>
        ${marcas}${nums}
        <line id="aguja-h" x1="120" y1="120" x2="120" y2="70" stroke="var(--ink)" stroke-width="6" stroke-linecap="round" transform="rotate(${final ? angH : 0} 120 120)"/>
        <line id="aguja-m" x1="120" y1="120" x2="120" y2="40" stroke="var(--accent)" stroke-width="3.5" stroke-linecap="round" transform="rotate(${final ? angM : 0} 120 120)"/>
        <circle cx="120" cy="120" r="6" fill="var(--accent)"/>
      </svg>
    </div>
    ${final ? '' : '<button class="primario" id="marcha" type="button">Poner el reloj en marcha</button>'}
    <div id="historia" class="historia" ${final ? '' : 'hidden'}>
      <p class="hora-final">${hhmm}</p>
      <p class="texto">${esc(d.historia || '')}</p></div>
  </section>`;
}
function conectarReloj(d) {
  const b = document.getElementById('marcha');
  if (!b || !d.hora) return;
  b.addEventListener('click', () => {
    b.remove();
    relojEnMarcha = true;
    const [h, mi] = d.hora;
    const finM = 4 * 360 + mi * 6, finH = (h % 12) * 30 + mi * 0.5;
    const hA = document.getElementById('aguja-h'), mA = document.getElementById('aguja-m');
    APP.querySelectorAll('.eng-a, .eng-b').forEach(g => g.classList.add('gira'));
    const mostrar = () => {
      const hist = document.getElementById('historia');
      hist.hidden = false; hist.classList.add('aparece');
      hist.closest('section').querySelector('svg').setAttribute('aria-label', `El reloj marca las ${h}:${String(mi).padStart(2, '0')}`);
    };
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      hA.setAttribute('transform', `rotate(${finH} 120 120)`); mA.setAttribute('transform', `rotate(${finM} 120 120)`); mostrar(); return;
    }
    const dur = 3600, t0 = performance.now();
    const paso = t => {
      const k = Math.min(1, (t - t0) / dur), ease = 1 - Math.pow(1 - k, 3);
      hA.setAttribute('transform', `rotate(${(finH * ease).toFixed(2)} 120 120)`);
      mA.setAttribute('transform', `rotate(${(finM * ease).toFixed(2)} 120 120)`);
      if (k < 1) requestAnimationFrame(paso); else mostrar();
    };
    requestAnimationFrame(paso);
  });
}

/* ---------- Widgets (sin cambios respecto al motor original) ---------- */
function dientesPath(x, y, r, n) {
  // Un polígono por diente: raíz, flanco, punta, flanco. El número de "M" es el número de dientes.
  const ro = r + 5, ri = r - 4, paso = 2 * Math.PI / n;
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = i * paso;
    const pts = [[ri, 0], [ro, 0.2], [ro, 0.42], [ri, 0.62]];
    d += pts.map(([rad, f], k) => {
      const t = a + f * paso;
      return (k === 0 ? 'M' : 'L') + (x + rad * Math.cos(t)).toFixed(2) + ' ' + (y + rad * Math.sin(t)).toFixed(2);
    }).join(' ') + ' Z ';
  }
  return d.trim();
}
function simulador(w) {
  const yc = 110, R = d => 20 + d * 0.85;
  const get = id => w.ruedas.find(r => r.id === id);
  const A = get('A'), B = get('B'), C = get('C'), D = get('D');
  const rA = R(A.dientes), rB = R(B.dientes), rC = R(C.dientes), rD = R(D.dientes);
  const xA = rA + 12, xB = xA + rA + rB, xC = xB + rB + rC + 44, xD = xC + rC + rD;
  const pos = { A: [xA, rA], B: [xB, rB], C: [xC, rC], D: [xD, rD] };
  const gear = g => {
    const [x, r] = pos[g.id];
    return `<g class="rueda" data-r="${g.id}" data-x="${x}" data-y="${yc}" data-d="${g.dientes}">
      <circle cx="${x}" cy="${yc}" r="${r - 4}" fill="var(--chip)" stroke="var(--ink-soft)" stroke-width="1.5"/>
      <path d="${dientesPath(x, yc, r, g.dientes)}" fill="var(--ink-soft)"/>
      <g class="gir"><line x1="${x}" y1="${yc}" x2="${x}" y2="${yc - r + 12}" stroke="var(--accent)" stroke-width="3" stroke-linecap="round"/>
      <circle cx="${x}" cy="${yc}" r="4" fill="var(--accent)"/></g>
      <text x="${x}" y="${yc - r - 10}" text-anchor="middle" font-size="15" font-weight="700" fill="var(--accent)">${g.id}</text></g>`;
  };
  const eje = `<line x1="${xB}" y1="${yc}" x2="${xC}" y2="${yc}" stroke="var(--accent)" stroke-width="6" stroke-linecap="round" opacity=".55"/>
    <text x="${(xB + xC) / 2}" y="${yc + Math.max(rB, rC) + 26}" text-anchor="middle" font-size="12" fill="var(--ink-soft)">eje común B y C</text>`;
  const ancho = Math.ceil(xD + rD + 14);
  return `<div class="engr" aria-label="Simulador de engranajes">
    <svg viewBox="0 0 ${ancho} 230" role="img" aria-label="Rueda A engrana con B. B y C están en el mismo eje. C engrana con D.">
      ${eje}${[A, B, C, D].map(gear).join('')}</svg>
    <label for="giro">Gira la rueda A
      <input id="giro" data-clave="${esc(w.clave)}" type="range" min="0" max="${w.vueltasA * 360}" step="1" value="${estadoW[w.clave] || 0}"></label>
  </div>`;
}
function conectarSimulador() {
  const r = document.getElementById('giro');
  if (!r) return;
  const act = () => {
    const th = +r.value;
    const ruedas = {};
    APP.querySelectorAll('.rueda').forEach(g => { ruedas[g.dataset.r] = g; });
    const dA = +ruedas.A.dataset.d, dB = +ruedas.B.dataset.d, dC = +ruedas.C.dataset.d, dD = +ruedas.D.dataset.d;
    const aA = th, aB = -aA * dA / dB, aC = aB, aD = -aC * dC / dD;
    const set = (g, a) => g.querySelector('.gir').setAttribute('transform', `rotate(${a.toFixed(2)} ${g.dataset.x} ${g.dataset.y})`);
    set(ruedas.A, aA); set(ruedas.B, aB); set(ruedas.C, aC); set(ruedas.D, aD);
    if (r.dataset.clave) estadoW[r.dataset.clave] = th;
  };
  r.addEventListener('input', act); act();
}
function widget(w) {
  if (w.tipo === 'engranajes') return simulador(w);
  if (w.tipo === 'ruedas') return ruedasHtml(w);
  if (w.tipo === 'cartas') return cartasHtml(w);
  if (w.tipo === 'fragmentos') return fragmentosHtml(w);
  return '';
}
function ruedasHtml(w) {
  const yc = 85, xs = [70, 180, 300], R = d => 8 + d * 0.9;
  const gs = w.ruedas.map((g, i) => {
    const r = R(g.dientes), x = xs[i];
    return `<g class="rueda" data-n="${g.dientes}" data-x="${x}" data-y="${yc}">
      <circle cx="${x}" cy="${yc}" r="${r - 4}" fill="var(--chip)" stroke="var(--ink-soft)" stroke-width="1.5"/>
      <path d="${dientesPath(x, yc, r, g.dientes)}" fill="var(--ink-soft)"/>
      <g class="gir"><line x1="${x}" y1="${yc}" x2="${x}" y2="${yc - r + 10}" stroke="var(--accent)" stroke-width="3" stroke-linecap="round"/>
      <circle cx="${x}" cy="${yc}" r="4" fill="var(--accent)"/></g></g>`;
  }).join('');
  const punteros = w.ruedas.map((g, i) => {
    const x = xs[i], top = yc - R(g.dientes);
    return `<polygon points="${x - 6},${top - 12} ${x + 6},${top - 12} ${x},${top - 2}" fill="var(--accent)"/>`;
  }).join('');
  return `<div class="engr" aria-label="Tres ruedas de la torre">
    <svg viewBox="0 0 370 170" role="img" aria-label="Tres ruedas que avanzan a la vez">${gs}${punteros}</svg>
    <div class="pasos" data-clave="${esc(w.clave)}">
      <button type="button" class="ghost" data-paso="-1">−1 diente</button>
      <button type="button" data-paso="1">+1 diente</button>
      <button type="button" class="ghost" data-paso="12">+12</button>
      <button type="button" class="ghost" data-paso="cero">Volver al inicio</button></div></div>`;
}
function cartasHtml(w) {
  const e = estadoW[w.clave] || (estadoW[w.clave] = { sos: {}, fr: {} });
  const sus = w.sospechosos.map(s => `<label><input type="checkbox" data-sos="${esc(s)}" ${e.sos[s] ? 'checked' : ''}> ${esc(s)}</label>`).join('');
  const fr = w.frases.map((s, i) => `<div class="fila"><span>Frase de ${esc(s)}</span>
    <button type="button" class="ghost tf" data-frase="${i}" aria-pressed="${!!e.fr[i]}">${e.fr[i] ? 'Falsa' : 'Verdadera'}</button></div>`).join('');
  return `<div class="engr" aria-label="Cuaderno de contraste" data-cartas="${esc(w.clave)}">
    <p class="rot" style="margin:0">Posibles culpables</p>
    <div class="cartas">${sus}</div>
    <p class="rot" style="margin:10px 0 0">Tu valoración de cada frase</p>
    <div class="cartas">${fr}</div></div>`;
}
/* Rompecabezas de fragmentos: el orden correcto de los bloques restablece la tabla del alfabeto. */
function estadoFrag(w) {
  const key = 'salas-frag-' + w.clave;
  const huecos = w.huecos || w.piezas.length;
  let d = lsLeer(key);
  const total = d && Array.isArray(d.pool) && Array.isArray(d.slots)
    ? d.pool.length + d.slots.filter(x => x !== null).length : -1;
  if (!d || d.slots.length !== huecos || total !== w.piezas.length) {
    const ids = w.piezas.map((_, i) => i);
    for (let i = ids.length - 1; i > 0; i--) { const k = Math.floor(Math.random() * (i + 1)); [ids[i], ids[k]] = [ids[k], ids[i]]; }
    d = { pool: ids, slots: Array.from({ length: huecos }, () => null) };
    lsGuardar(key, d);
  }
  return { key, d };
}
function moverFrag(w, id, destino) {
  const { key, d } = estadoFrag(w);
  d.pool = d.pool.filter(x => x !== id);
  d.slots = d.slots.map(x => (x === id ? null : x));
  if (destino === 'pool') d.pool.push(id);
  else {
    const previa = d.slots[destino];
    if (previa !== null && previa !== undefined) d.pool.push(previa);
    d.slots[destino] = id;
  }
  lsGuardar(key, d);
  fragSel = null;
  pintar();
}
function fragmentosHtml(w) {
  widgetActivo = w;
  const { d } = estadoFrag(w);
  if (d.slots.every((x, i) => x === i)) {
    return `<div class="engr" aria-label="Tabla del alfabeto restablecida">
      <p class="rot" style="margin:0">Tabla restablecida</p>
      <div class="alf">${LETRAS.map((l, i) => `<div>${esc(l)}<small>${i + 1}</small></div>`).join('')}</div>
      ${d.pool.length ? `<p class="rot" style="margin:12px 0 0">Piezas que no encajan</p>
      <div class="sobran">${[...d.pool].sort((a, b) => w.piezas[a].localeCompare(w.piezas[b])).map(i => `<span>${esc(w.piezas[i])}</span>`).join('')}</div>` : ''}</div>`;
  }
  const piezas = d.pool.map(i => `<button type="button" class="frag${fragSel === i ? ' sel' : ''}" draggable="true" data-pool="${i}" aria-pressed="${fragSel === i}">${esc(w.piezas[i])}</button>`).join('');
  const ranuras = d.slots.map((x, i) => `<div class="ranura" data-slot="${i}"><span>${i + 1}</span>${x === null ? '' :
    `<button type="button" class="frag${fragSel === x ? ' sel' : ''}" draggable="true" data-slot-frag="${x}" aria-pressed="${fragSel === x}">${esc(w.piezas[x])}</button>`}</div>`).join('');
  return `<div class="engr" aria-label="Piezas de la tabla del alfabeto">
    <p class="rot" style="margin:0">Piezas sueltas · arrastra, o toca una pieza y luego su hueco</p>
    <div class="frag-pool" data-pool-zone>${piezas || '<p class="vacio">No quedan piezas sueltas.</p>'}</div>
    <p class="rot" style="margin:12px 0 0">Orden de la tabla</p>
    <div class="frag-slots">${ranuras}</div></div>`;
}
function campoRespuesta(sala) {
  if (sala.widget && sala.widget.tipo === 'cartas') {
    return `<select id="r" name="r" aria-label="Culpable">
      <option value="">— Elige a la informante —</option>
      ${sala.widget.sospechosos.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}</select>`;
  }
  return `<input id="r" name="r" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Respuesta">`;
}
function conectarWidgets() {
  if (document.getElementById('giro')) conectarSimulador();
  /* Ruedas de la torre: avanzan sin mostrar nunca el número de pasos. */
  const caja = APP.querySelector('.pasos[data-clave]');
  if (caja) {
    const clave = caja.dataset.clave;
    let paso = estadoW[clave] || 0;
    const pinta = () => {
      estadoW[clave] = paso;
      APP.querySelectorAll('.rueda').forEach(g => {
        g.querySelector('.gir').setAttribute('transform', `rotate(${(paso * 360 / +g.dataset.n).toFixed(3)} ${g.dataset.x} ${g.dataset.y})`);
      });
    };
    APP.querySelectorAll('[data-paso]').forEach(b => b.addEventListener('click', () => {
      const v = b.dataset.paso;
      paso = v === 'cero' ? 0 : paso + Number(v);
      pinta();
    }));
    pinta();
  }
  /* Fragmentos de la tabla: arrastrar, o tocar pieza y luego hueco. */
  if (APP.querySelector('[data-pool-zone]') && widgetActivo) {
    const w = widgetActivo;
    APP.querySelectorAll('[data-pool],[data-slot-frag]').forEach(el => {
      const id = Number(el.dataset.pool ?? el.dataset.slotFrag);
      el.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', String(id)); e.dataTransfer.effectAllowed = 'move'; });
      el.addEventListener('click', e => { e.stopPropagation(); fragSel = fragSel === id ? null : id; pintar(); });
    });
    APP.querySelectorAll('[data-slot]').forEach(el => {
      const dest = Number(el.dataset.slot);
      el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('over'); });
      el.addEventListener('dragleave', () => el.classList.remove('over'));
      el.addEventListener('drop', e => { e.preventDefault(); moverFrag(w, Number(e.dataTransfer.getData('text/plain')), dest); });
      el.addEventListener('click', () => { if (fragSel !== null) moverFrag(w, fragSel, dest); });
    });
    const pool = APP.querySelector('[data-pool-zone]');
    pool.addEventListener('dragover', e => { e.preventDefault(); pool.classList.add('over'); });
    pool.addEventListener('dragleave', () => pool.classList.remove('over'));
    pool.addEventListener('drop', e => { e.preventDefault(); moverFrag(w, Number(e.dataTransfer.getData('text/plain')), 'pool'); });
    pool.addEventListener('click', () => { if (fragSel !== null) moverFrag(w, fragSel, 'pool'); });
  }
  const cuaderno = APP.querySelector('[data-cartas]');
  const ec = cuaderno ? estadoW[cuaderno.dataset.cartas] : null;
  APP.querySelectorAll('[data-frase]').forEach(b => b.addEventListener('click', () => {
    const f = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(f));
    b.textContent = f ? 'Falsa' : 'Verdadera';
    if (ec) ec.fr[b.dataset.frase] = f;
  }));
  APP.querySelectorAll('[data-sos]').forEach(c => c.addEventListener('change', () => {
    if (ec) ec.sos[c.dataset.sos] = c.checked;
  }));
}

/* ---------- Acciones contra el servidor ---------- */
async function accion(boton, fn) {
  if (ocupado) return;
  ocupado = true;
  if (boton) boton.disabled = true;
  try { await fn(); } catch (e) {
    const msg = document.getElementById('msg');
    if (msg) msg.textContent = e.message; else pantallaError(e.message, () => jugar(actual));
  } finally {
    ocupado = false;
    if (boton && boton.isConnected) boton.disabled = false;
  }
}
function comprobar() {
  const campo = document.getElementById('r');
  const msg = document.getElementById('msg');
  armado = false;
  if (!campo.value.trim()) { msg.textContent = 'Escribe una respuesta.'; campo.focus(); return; }
  accion(document.getElementById('comprobar'), async () => {
    const r = await api.comprobar(estado.partida, campo.value);
    ponerEstado(r.estado);
    if (r.correcto) {
      aviso = 'Correcto. Se abre la siguiente sala.';
      aprendido = r.aprende || '';
      salir(() => { entrar = true; pintar(); });
    } else if (r.penal_seg > 0) {
      msg.textContent = `Acusación equivocada: +${Math.round(r.penal_seg / 60)} min. Revisa las frases.`;
    } else {
      msg.textContent = 'No es esa respuesta. Prueba otra vez o pide una nota.';
      if (campo.select) campo.select();
    }
  });
}

function wire(j, sala) {
  document.getElementById('volver').addEventListener('click', () => salir(() => { entrar = true; mapaAbierto = false; menu(); }));
  const pl = document.getElementById('plano');
  if (pl) pl.addEventListener('click', () => { mapaAbierto = !mapaAbierto; pintar(); });
  const cp = document.getElementById('cerrar-plano');
  if (cp) cp.addEventListener('click', () => { mapaAbierto = false; pintar(); });
  const rein = document.getElementById('reiniciar');
  rein.addEventListener('click', () => {
    if (!armado) { armado = true; pintar(); return; }
    armado = false;
    accion(rein, async () => {
      ponerEstado(await api.reiniciar(estado.partida));
      relojEnMarcha = false;
      Object.keys(estadoW).forEach(k => delete estadoW[k]);
      try { Object.keys(localStorage).filter(k => k.startsWith('salas-frag-' + j.premisa.id + '/')).forEach(k => localStorage.removeItem(k)); } catch (x) { /* sin almacenamiento */ }
      aviso = 'Caso reiniciado. Las repeticiones no cuentan para el ranking.';
      pintar();
    });
  });
  entradaHoja();
  if (!sala) return;
  document.getElementById('comprobar').addEventListener('click', comprobar);
  document.getElementById('r').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); comprobar(); }
  });
  const bp = document.getElementById('pista');
  bp.addEventListener('click', () => {
    armado = false;
    accion(bp, async () => { ponerEstado(await api.pista(estado.partida)); pintar(); });
  });
}

/* ---------- Arranque ---------- */
async function arrancar() {
  if (!configurado) {
    pantallaError('Falta configurar Supabase: define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY (ver README).');
    return;
  }
  try { await sesion(); } catch (e) { pantallaError(e.message, arrancar); return; }
  menu();
}
arrancar();
