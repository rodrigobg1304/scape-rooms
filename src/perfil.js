// Pantalla "Mi expediente": perfil, estadísticas por categoría, ranking y trofeos.
// Solo lectura: usa el cliente de api.js para llamar a mis_estadisticas() y ranking().
import { supabase } from './api.js';

const CATEGORIAS = {
  matematica: 'Matemáticas', logica: 'Lógica', literatura: 'Literatura', arte: 'Arte',
  musica: 'Música', orientacion: 'Orientación', creatividad: 'Creatividad', narrativa: 'Narrativa',
};
const PESTANAS = [
  ['resumen', 'Resumen'], ['categorias', 'Categorías'], ['ranking', 'Ranking'], ['trofeos', 'Trofeos'],
];
const MARCAS = {
  reloj_praga: '#9c7d3e', faro_cabo: '#0d5b7c', monasterio_lorenzo: '#27449a', estudio_ruiz: '#a92d1a', kepler_9: '#1b6f93',
  teatro_provincias: '#8e1b2a', cabana_valdeiro: '#365f27', ultimo_plato: '#c0571f', rodaje_luna: '#6b6760', ajedrez_abuelo: '#6b4423',
};

let pestana = 'resumen';
let stats = null;          // respuesta de mis_estadisticas()
let errorStats = '';
let rankCat = '';          // '' = global
const rankCache = {};      // categoría → filas

async function rpc(nombre, args) {
  const { data, error } = await supabase.rpc(nombre, args);
  if (error) throw new Error(error.message || 'Error de conexión');
  return data;
}

function duracion(seg) {
  const s = Math.max(0, Math.round(seg || 0));
  if (!s) return '—';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h) return `${h} h ${String(m).padStart(2, '0')} min`;
  if (m) return `${m} min`;
  return `${s} s`;
}
function fecha(iso) {
  try { return new Date(iso).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }); } catch (x) { return ''; }
}

export async function pantallaPerfil(APP, ctx) {
  if (ctx.pestana) pestana = ctx.pestana;
  const { cuenta, esc, inicial } = ctx;
  const invitado = !cuenta || cuenta.anonimo;
  const nombre = invitado ? 'Invitado' : (cuenta.alias || cuenta.email);
  const sub = invitado
    ? 'Tu progreso vive solo en este navegador. Crea una cuenta más abajo para guardarlo y aparecer en el ranking.'
    : `${esc(cuenta.email || '')}${stats && stats.miembro_desde ? ` · desde ${esc(fecha(stats.miembro_desde))}` : ''}`;

  APP.innerHTML = `<div class="hoja">
    <nav class="barra" style="margin-top:0"><button class="ghost" id="volver" type="button">← Casos</button></nav>
    <section class="tarjeta perfil-cab" style="margin-top:14px" aria-label="Tu expediente">
      <span class="avatar" aria-hidden="true">${esc(inicial(nombre))}</span>
      <div style="min-width:0"><p class="rot">Expediente</p><h1 style="overflow-wrap:anywhere">${esc(nombre)}</h1>
        <p class="small">${sub}</p></div></section>
    ${ctx.cuentaHtml()}
    <div class="pestanas" role="tablist" aria-label="Secciones del expediente">
      ${PESTANAS.map(([id, t]) => `<button type="button" role="tab" id="tab-${id}" aria-controls="panel" aria-selected="${pestana === id}" tabindex="${pestana === id ? 0 : -1}" data-tab="${id}">${t}</button>`).join('')}
    </div>
    <section class="panel" id="panel" role="tabpanel" aria-labelledby="tab-${pestana}" aria-live="polite">
      ${stats || errorStats ? panel(ctx) : '<p class="cargando">Abriendo tu expediente…</p>'}
    </section></div>`;
  ctx.alEntrar();
  conectar(APP, ctx);
  ctx.conectarCuenta();

  if (!stats && !errorStats) {
    try { stats = await rpc('mis_estadisticas'); } catch (e) { errorStats = e.message; }
    pantallaPerfil(APP, { ...ctx, pestana });
  }
}

function conectar(APP, ctx) {
  APP.querySelector('#volver').addEventListener('click', () => { stats = null; errorStats = ''; ctx.volver(); });
  const tabs = [...APP.querySelectorAll('[data-tab]')];
  const ir = id => { pestana = id; pantallaPerfil(APP, { ...ctx, pestana: id }); const t = APP.querySelector(`#tab-${id}`); if (t) t.focus(); };
  tabs.forEach((b, i) => {
    b.addEventListener('click', () => ir(b.dataset.tab));
    b.addEventListener('keydown', e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      ir(tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length].dataset.tab);
    });
  });
  const reint = APP.querySelector('#reintentar-perfil');
  if (reint) reint.addEventListener('click', () => { errorStats = ''; stats = null; pantallaPerfil(APP, ctx); });
  const elegir = APP.querySelector('#elegir-caso');
  if (elegir) elegir.addEventListener('click', () => { stats = null; ctx.volver(); });
  if (pestana === 'resumen' && stats) ctx.medicion.wire();
  if (pestana === 'ranking') conectarRanking(APP, ctx);
}

function panel(ctx) {
  const { esc } = ctx;
  if (errorStats) {
    return `<div class="error" role="alert"><p class="rot">No se ha podido cargar tu expediente</p><p class="texto">${esc(errorStats)}</p>
      <div class="barra"><button class="primario" id="reintentar-perfil" type="button">Reintentar</button></div></div>`;
  }
  if (pestana === 'categorias') return panelCategorias(ctx);
  if (pestana === 'ranking') return panelRanking(ctx);
  if (pestana === 'trofeos') return panelTrofeos(ctx);
  return panelResumen(ctx);
}

const pl = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const vacio = (titulo, texto, boton = true) => `<div class="vacio-estado"><b>${titulo}</b>${texto}
  ${boton ? '<div style="margin-top:14px"><button class="primario" id="elegir-caso" type="button">Elegir un caso</button></div>' : ''}</div>`;

/* ---------- Resumen ---------- */
function panelResumen(ctx) {
  const { esc, fmt } = ctx;
  const p = stats.partidas || {}, r = stats.respuestas || {};
  const casosRes = (stats.casos || []).filter(c => c.resueltas > 0).length;
  const jugables = ctx.misCasos.filter(m => m.validado).length || ctx.casos.length;
  const cifras = `<div class="cifras">
    <div class="cifra"><b>${p.jugadas || 0}</b><span>Partidas jugadas</span><small>${p.resueltas || 0} resueltas · ${p.en_curso || 0} en curso</small></div>
    <div class="cifra"><b>${casosRes}<small style="display:inline;font-size:.5em"> / ${jugables}</small></b><span>Casos cerrados</span><small>${p.a_tiempo || 0} a tiempo</small></div>
    <div class="cifra"><b>${duracion(stats.tiempo_total_seg)}</b><span>Tiempo jugado</span><small>solo tiempo dentro de las salas, sin penalizaciones</small></div>
    <div class="cifra"><b>${r.pct_acierto == null ? '—' : r.pct_acierto + '%'}</b><span>Acierto</span><small>${pl(r.aciertos || 0, 'acierto', 'aciertos')} · ${pl(r.fallos || 0, 'fallo', 'fallos')}</small></div></div>`;
  if (!p.jugadas) return cifras + vacio('Tu expediente está en blanco', 'Abre tu primer caso y aquí verás el tiempo de cada sala, tus aciertos y tus trofeos.');
  const casos = stats.casos.map(c => {
    const salas = (c.salas || []).map(s => `<tr><td>${esc(s.nombre)}</td><td>${s.veces || '—'}</td>
      <td>${s.mejor_seg == null ? '—' : fmt(s.mejor_seg * 1000)}</td><td>${s.medio_seg == null ? '—' : fmt(s.medio_seg * 1000)}</td>
      <td>${s.fallos}</td><td>${s.pistas}</td></tr>`).join('');
    const partes = [`${c.partidas} ${c.partidas === 1 ? 'partida' : 'partidas'}`, `${c.resueltas} ${c.resueltas === 1 ? 'resuelta' : 'resueltas'}`,
      c.mejor_seg != null ? `mejor ${fmt(c.mejor_seg * 1000)}` : '', `${duracion(c.segundos)} dentro`].filter(Boolean).join(' · ');
    return `<details class="caso-stats">
      <summary><b>${esc(c.titulo)}</b><span class="small">${partes}</span><span class="flecha" aria-hidden="true">›</span></summary>
      <div class="tabla-wrap"><table class="salas-t"><caption class="sr">Tiempo por sala en ${esc(c.titulo)}</caption>
        <thead><tr><th scope="col">Sala</th><th scope="col">Veces</th><th scope="col">Mejor</th><th scope="col">Media</th><th scope="col">Fallos</th><th scope="col">Notas</th></tr></thead>
        <tbody>${salas}</tbody></table></div></details>`;
  }).join('');
  return `${cifras}<div><h2>Tiempo por caso y sala</h2><p class="small" style="margin:4px 0 12px">Toca un caso para ver cuánto tardaste en cada sala.</p>
    <div class="lista">${casos}</div></div>
    <details class="caso-stats"><summary><b>Exportar progreso</b><span class="small">Copiar el resumen o descargarlo en JSON</span><span class="flecha" aria-hidden="true">›</span></summary>
      <div style="padding:0 14px 14px">${ctx.medicion.html()}</div></details>`;
}

/* ---------- Categorías ---------- */
function panelCategorias(ctx) {
  const { esc } = ctx;
  const cats = [...(stats.categorias || [])].sort((a, b) => (b.pct_acierto ?? -1) - (a.pct_acierto ?? -1));
  if (!cats.length) return vacio('Aún no hay categorías', 'Cada sala trabaja una o varias categorías (matemáticas, lógica, literatura…). Cuando respondas, verás aquí tu porcentaje de acierto en cada una.');
  const filas = cats.map(c => {
    const tot = c.aciertos + c.fallos, pa = tot ? c.aciertos / tot * 100 : 0;
    return `<li class="fila-cat">
      <div class="cab"><b>${esc(c.nombre)}</b><span class="pct">${c.pct_acierto == null ? '—' : c.pct_acierto + '%'}</span></div>
      <div class="medidor" role="img" aria-label="${c.aciertos} aciertos y ${c.fallos} fallos"><i class="ac" style="width:${pa}%"></i><i class="fa" style="width:${tot ? 100 - pa : 0}%"></i></div>
      <span class="small">${pl(c.aciertos, 'acierto', 'aciertos')} · ${pl(c.fallos, 'fallo', 'fallos')} · ${pl(c.pistas, 'nota', 'notas')} · ${pl(c.salas, 'sala', 'salas')} · ${duracion(c.segundos)}${c.puntuacion != null ? ` · velocidad ${c.puntuacion}/100` : ''}</span></li>`;
  }).join('');
  return `<div class="leyenda"><span style="--c:var(--accent)">Aciertos</span><span style="--c:color-mix(in srgb, var(--mal) 75%, var(--paper))">Fallos</span></div>
    <ul class="lista">${filas}</ul>
    <p class="small">El porcentaje es aciertos entre respuestas enviadas. La velocidad compara tu tiempo en cada sala con el resto de jugadores (100 = el más rápido). Una sala puede contar en varias categorías.</p>`;
}

/* ---------- Ranking ---------- */
function panelRanking(ctx) {
  const { esc, cuenta } = ctx;
  const invitado = !cuenta || cuenta.anonimo || !cuenta.alias;
  const opciones = [['', 'Global'], ...Object.entries(CATEGORIAS)]
    .map(([id, t]) => `<option value="${id}" ${rankCat === id ? 'selected' : ''}>${t}</option>`).join('');
  const filas = rankCache[rankCat];
  let cuerpo;
  if (filas === undefined) cuerpo = '<p class="cargando">Consultando el ranking…</p>';
  else if (filas instanceof Error) cuerpo = `<div class="error" role="alert"><p class="texto">${esc(filas.message)}</p></div>`;
  else if (!filas.length) cuerpo = vacio('Nadie en el ranking todavía', 'Aparecen los jugadores con alias que han resuelto al menos 3 salas en su primera partida.', false);
  else {
    const yo = filas.find(f => f.soy_yo);
    cuerpo = `<ol class="ranking">${filas.map(f => `<li class="${f.soy_yo ? 'yo' : ''}"><span class="pos">${f.posicion}</span>
      <span class="alias">${esc(f.alias)}</span><span class="pts">${f.puntuacion}<small>${f.salas} salas</small></span></li>`).join('')}</ol>
      ${yo ? '' : `<p class="small">${invitado ? 'Crea una cuenta con alias para aparecer aquí.' : 'Aún no apareces: necesitas al menos 3 salas resueltas en primera partida.'}</p>`}`;
  }
  return `<div class="filtro"><label for="rank-cat">Categoría</label><select id="rank-cat">${opciones}</select></div>
    ${cuerpo}
    <p class="small">Puntuación de 0 a 100 según lo rápido que resuelves cada sala frente al resto, contando penalizaciones. Solo puntúan las primeras partidas.</p>`;
}
function conectarRanking(APP, ctx) {
  const sel = APP.querySelector('#rank-cat');
  if (sel) sel.addEventListener('change', () => { rankCat = sel.value; pantallaPerfil(APP, ctx); });
  if (rankCache[rankCat] !== undefined) return;
  const cat = rankCat;
  rpc('ranking', { p_categoria: cat || null, p_min_salas: 3 })
    .then(f => { rankCache[cat] = f || []; }, e => { rankCache[cat] = e; })
    .then(() => { if (pestana === 'ranking' && rankCat === cat && APP.querySelector('#rank-cat')) pantallaPerfil(APP, ctx); });
}

/* ---------- Trofeos ---------- */
function panelTrofeos(ctx) {
  const { esc } = ctx;
  const p = stats.partidas || {}, r = stats.respuestas || {};
  const casos = stats.casos || [];
  const cerrados = casos.filter(c => c.resueltas > 0);
  const jugables = ctx.misCasos.filter(m => m.validado).map(m => m.caso);
  const mejor = Math.min(...cerrados.map(c => c.mejor_seg ?? Infinity));
  const respuestas = (r.aciertos || 0) + (r.fallos || 0);
  const catsAcertadas = (stats.categorias || []).filter(c => c.aciertos > 0).length;
  const lista = [
    { emb: 'I', t: 'Primer caso cerrado', d: 'Resuelve tu primer caso.', v: cerrados.length, m: 1 },
    { emb: 'XXX', t: 'Contra reloj', d: 'Cierra un caso dentro de los 30 minutos.', v: p.a_tiempo || 0, m: 1 },
    { emb: 'XV', t: 'Mente rápida', d: 'Cierra un caso en menos de 15 minutos.', v: mejor <= 900 ? 1 : 0, m: 1 },
    { emb: '∅', t: 'Sin ayuda', d: 'Cierra un caso sin pedir ninguna nota.', v: cerrados.some(c => c.pistas === 0) ? 1 : 0, m: 1 },
    { emb: '◎', t: 'Buen ojo', d: 'Mantén un 80 % de acierto con al menos 10 respuestas.', v: respuestas >= 10 && (r.pct_acierto || 0) >= 80 ? 10 : Math.min(respuestas, 9), m: 10 },
    { emb: 'IV', t: 'Polímata', d: 'Acierta salas de 4 categorías distintas.', v: catsAcertadas, m: 4 },
    { emb: 'X', t: 'Veterano', d: 'Juega 10 partidas.', v: p.jugadas || 0, m: 10 },
    { emb: '★', t: 'Archivo completo', d: 'Cierra todos los casos disponibles.', v: cerrados.filter(c => jugables.includes(c.caso)).length, m: Math.max(jugables.length, 1) },
  ];
  const sellos = ctx.casos.map((j, i) => ({ j, hoja: String(i + 1).padStart(2, '0') })).filter(({ j }) => jugables.includes(j.premisa.id)).map(({ j, hoja }) => {
    const c = casos.find(x => x.caso === j.premisa.id);
    return { emb: hoja, t: j.premisa.titulo, d: 'Sello del caso: ciérralo una vez.', v: c && c.resueltas > 0 ? 1 : 0, m: 1, color: MARCAS[j.premisa.id] };
  });
  const html = (x) => {
    const ok = x.v >= x.m;
    return `<li class="trofeo${ok ? ' ganado' : ''}"${x.color ? ` style="--accent:${x.color}"` : ''}>
      <span class="emb" aria-hidden="true">${esc(x.emb)}</span>
      <div><b>${esc(x.t)}</b><p>${esc(x.d)}</p>
        ${ok ? '<p class="sr">Conseguido</p>' : `<div class="prog" role="img" aria-label="Progreso ${Math.min(x.v, x.m)} de ${x.m}"><i style="--p:${Math.min(100, x.v / x.m * 100)}%"></i></div>`}</div></li>`;
  };
  const ganLista = lista.filter(x => x.v >= x.m).length;
  const ganSellos = sellos.filter(x => x.v >= x.m).length;
  const grupo = (titulo, items, ganados, abierto) => `<details class="caso-stats grupo-trofeos"${abierto ? ' open' : ''}>
    <summary><b>${titulo}</b><span class="small">${ganados} de ${items.length} conseguidos</span><span class="flecha" aria-hidden="true">›</span></summary>
    <ul class="trofeos lista" style="padding:0 14px 14px">${items.map(html).join('')}</ul></details>`;
  return `<div class="lista" style="gap:12px">
    ${grupo('Logros', lista, ganLista, true)}
    ${sellos.length ? grupo('Sellos de caso', sellos, ganSellos, sellos.length <= 4) : ''}</div>`;
}
